import { NextResponse } from "next/server";
import { anthropic } from "@/lib/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { buildQuestionSpecs } from "@/lib/pipeline/questions";
import { CLAUDE_TIMEOUT_MS, withClaudeGuard } from "@/lib/pipeline/claudeGuard";
import {
  QUOTE_ENDING_COMPLETION_SYSTEM,
  quoteEndingCompletionPrompt,
  TYPO_SPACING_COMPLETION_SYSTEM,
  typoSpacingCorrectionPrompt,
} from "@/lib/report/prompts";
import {
  boundedDiff,
  correctionDiff,
  deterministicEndingCompletion,
  needsReportQuoteEndingReview,
  reportQuoteFillerCleanup,
  reportQuoteFlaggedWord,
} from "@/lib/report/quoteEnding";

export const runtime = "nodejs";

const MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";
// 최대 변경 글자 수 — 끝맺음/오탈자 모두 "최소 보완"만 허용하는 동일한 가드레일.
const MAX_DIFF_CHARS = 5;
// 한 번의 LLM 호출에 담을 인용문 수 상한. ponytail: 임의 상수, 배치가 훨씬 커지면(문항당
// 수백 건) 청크 수를 늘리는 대신 이 값 자체를 조정할 것.
const TYPO_CHUNK_SIZE = 40;

const BodySchema = z.object({
  source: z.string().url(),
  questionKey: z.string().min(1),
  quotes: z.array(z.string().min(1)).min(1).max(500),
});

const TypoCorrectionSchema = z.object({
  corrections: z.array(z.object({ index: z.number().int(), correctedQuote: z.string() })),
});

function normalized(value: string) {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[​\s]+/g, "");
}

type CorrectionItem = {
  quote: string;
  suggestion: string;
  changedFrom: string;
  changedTo: string;
  kind: "ending" | "typo" | "tone";
  risk: "low" | "review";
};

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "인용문 정보가 올바르지 않습니다." }, { status: 400 });

  const loaded = await loadWallaFromUrl(parsed.data.source);
  if (!loaded.ok || !loaded.parsed) return NextResponse.json({ ok: false, error: "원본 데이터를 읽지 못했습니다." }, { status: 404 });
  const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
  const spec = buildQuestionSpecs(records).find((question) => question.id === parsed.data.questionKey);
  if (!spec) return NextResponse.json({ ok: false, error: "인용문이 사용된 문항을 찾지 못했습니다." }, { status: 404 });

  const quotes = [...new Set(parsed.data.quotes)];
  const endingQuotes = quotes.filter((quote) => needsReportQuoteEndingReview(quote));
  const typoQuotes = quotes.filter((quote) => !needsReportQuoteEndingReview(quote));

  const limit = pLimit(4);
  const items: CorrectionItem[] = [];

  // (a) 끝맺음 판정에 걸린 인용문: 결정론적 우선, 안 되면 원본 응답 문맥으로 LLM 폴백.
  await Promise.all(endingQuotes.map((quote) => limit(async () => {
    const deterministic = deterministicEndingCompletion(quote);
    if (deterministic) {
      const diff = boundedDiff(quote, deterministic, MAX_DIFF_CHARS);
      if (diff) items.push({ quote, suggestion: deterministic, ...diff, kind: "ending", risk: "low" });
      return;
    }
    const source = spec.inputs.find((candidate) => normalized(candidate.reason).includes(normalized(quote)));
    if (!source) return;
    try {
      const { output } = await withClaudeGuard("text-correction-ending", () => generateText({
        model: anthropic(MODEL),
        instructions: { role: "system", content: QUOTE_ENDING_COMPLETION_SYSTEM },
        prompt: quoteEndingCompletionPrompt(quote, source.reason),
        output: Output.object({ schema: z.object({ revisedQuote: z.string() }) }),
        maxOutputTokens: 300,
        reasoning: "none",
        timeout: CLAUDE_TIMEOUT_MS,
      }));
      const revised = output.revisedQuote.trim();
      if (!revised || !/[.!?。]$/.test(revised)) return;
      const diff = boundedDiff(quote, revised, MAX_DIFF_CHARS);
      if (diff) items.push({ quote, suggestion: revised, ...diff, kind: "ending", risk: "review" });
    } catch (error) {
      console.error("[text-corrections] ending fallback failed", error);
    }
  })));

  // (b) 나머지 인용문: 오탈자·띄어쓰기만 배치로 검사(원본 대조 불필요, 문항당 최대 몇 번의
  // LLM 호출로 끝내기 위해 청크 단위로 묶는다).
  const chunks: string[][] = [];
  for (let i = 0; i < typoQuotes.length; i += TYPO_CHUNK_SIZE) chunks.push(typoQuotes.slice(i, i + TYPO_CHUNK_SIZE));

  await Promise.all(chunks.map((chunk) => limit(async () => {
    try {
      const { output } = await withClaudeGuard("text-correction-typo", () => generateText({
        model: anthropic(MODEL),
        instructions: { role: "system", content: TYPO_SPACING_COMPLETION_SYSTEM },
        prompt: typoSpacingCorrectionPrompt(chunk),
        output: Output.object({ schema: TypoCorrectionSchema }),
        maxOutputTokens: 6000,
        reasoning: "none",
        timeout: CLAUDE_TIMEOUT_MS,
      }));
      for (const correction of output.corrections) {
        const quote = chunk[correction.index];
        if (!quote || correction.correctedQuote === quote) continue;
        const diff = correctionDiff(quote, correction.correctedQuote, MAX_DIFF_CHARS);
        if (diff) items.push({ quote, suggestion: correction.correctedQuote, ...diff, kind: "typo", risk: "review" });
      }
    } catch (error) {
      console.error("[text-corrections] typo batch failed", error);
    }
  })));

  // (c) 말투 검토(LLM 없음). 한 인용문에 항목이 두 개 뜨면 검토 패널이 같은 인용문을 키로
  // 쓰므로, 앞 단계에서 이미 잡힌 인용문은 건너뛴다 — 그 교정을 적용하고 다시 검토하면 걸린다.
  const covered = new Set(items.map((item) => item.quote));
  for (const quote of quotes) {
    if (covered.has(quote)) continue;
    const flagged = reportQuoteFlaggedWord(quote);
    if (flagged) {
      // 강조어·욕설은 지우면 응답자 의도가 바뀌므로 제안 없이 노출만 한다(패널에서 직접 수정).
      items.push({ quote, suggestion: quote, changedFrom: flagged, changedTo: flagged, kind: "tone", risk: "review" });
      continue;
    }
    const cleaned = reportQuoteFillerCleanup(quote);
    if (cleaned) items.push({ quote, suggestion: cleaned, changedFrom: quote, changedTo: cleaned, kind: "tone", risk: "low" });
  }

  return NextResponse.json({ ok: true, questionKey: spec.id, questionLabel: spec.label, items });
}
