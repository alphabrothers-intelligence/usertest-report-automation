import { NextResponse } from "next/server";
import { z } from "zod";
import { loadQuestionSpecs } from "@/lib/pipeline/questionSource";
import { needsReportQuoteEndingReview } from "@/lib/report/quoteEnding";

export const runtime = "nodejs";

const QuerySchema = z.object({
  source: z.string().url(),
  questionKey: z.string().min(1),
  quote: z.string().min(1),
});

const BodySchema = z.object({
  source: z.string().url(),
  questionKey: z.string().min(1),
  quotes: z.array(z.string().min(1)).min(1),
});

function normalized(value: string) {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[\u200B\s]+/g, "");
}

/**
 * 문항 키를 찾는다. **띄어쓰기 차이는 무시한다.**
 *
 * 저장된 보고서의 키와 지금 raw data에서 만든 키가 공백 하나로 어긋나는 일이 있다(2026-09-15
 * 케어클 실측: 보고서에는 `feature: LED 컬러 변경`, 지금 스펙은 `feature:LED 컬러 변경` — 기능명
 * 앞 공백을 예전엔 안 다듬었다). 그러면 원문 대조가 통째로 실패하면서 패널에 "원본 응답에서
 * 인용문을 찾지 못했습니다"만 뜬다. 다시 분석을 돌리지 않고도 옛 보고서가 열리도록 여기서 맞춘다.
 */
function findSpec<T extends { id: string }>(specs: T[], questionKey: string): T | undefined {
  return specs.find((spec) => spec.id === questionKey)
    ?? specs.find((spec) => normalized(spec.id) === normalized(questionKey));
}

function findNormalizedRange(source: string, quote: string) {
  const directStart = source.indexOf(quote);
  if (directStart >= 0) return { matchStart: directStart, matchEnd: directStart + quote.length };
  const normalizedChars: string[] = [];
  const sourceIndexes: number[] = [];
  for (let sourceIndex = 0; sourceIndex < source.length;) {
    const codePoint = source.codePointAt(sourceIndex);
    const character = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
    const next = normalized(character);
    for (const normalizedCharacter of next) {
      normalizedChars.push(normalizedCharacter);
      sourceIndexes.push(sourceIndex);
    }
    sourceIndex += character.length || 1;
  }
  const start = normalizedChars.join("").indexOf(normalized(quote));
  if (start < 0) return { matchStart: -1, matchEnd: -1 };
  const endIndex = start + normalized(quote).length - 1;
  const lastCharacter = source.codePointAt(sourceIndexes[endIndex]);
  const lastLength = lastCharacter !== undefined && lastCharacter > 0xffff ? 2 : 1;
  return { matchStart: sourceIndexes[start], matchEnd: sourceIndexes[endIndex] + lastLength };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    source: url.searchParams.get("source"),
    questionKey: url.searchParams.get("questionKey"),
    quote: url.searchParams.get("quote"),
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "인용문 출처 정보가 올바르지 않습니다." }, { status: 400 });

  // 문항 추출은 분석 때와 **같은 자리**를 쓴다(lib/pipeline/questionSource.ts) — 여기만 고정
  // 스키마로 읽으면 리바랩스가 아닌 raw data에서 원문 대조가 통째로 안 된다(2026-09-09 실측).
  const source = await loadQuestionSpecs(parsed.data.source, null);
  if (!source.ok) return NextResponse.json({ ok: false, error: source.error }, { status: 404 });
  const spec = findSpec(source.specs, parsed.data.questionKey);
  if (!spec) return NextResponse.json({ ok: false, error: "인용문이 사용된 문항을 찾지 못했습니다." }, { status: 404 });

  const quoteKey = normalized(parsed.data.quote);
  const input = spec.inputs.find((candidate) => normalized(candidate.reason).includes(quoteKey));
  if (!input) return NextResponse.json({ ok: false, error: "원본 응답에서 해당 인용문을 찾지 못했습니다." }, { status: 404 });
  const range = findNormalizedRange(input.reason, parsed.data.quote);

  return NextResponse.json({
    ok: true,
    questionKey: spec.id,
    questionLabel: spec.label,
    respondentId: input.respondent_id,
    originalResponse: input.reason,
    quote: parsed.data.quote,
    ...range,
    needsReview: needsReportQuoteEndingReview(parsed.data.quote),
  });
}

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "인용문 출처 정보가 올바르지 않습니다." }, { status: 400 });

  // 문항 추출은 분석 때와 **같은 자리**를 쓴다(lib/pipeline/questionSource.ts) — 여기만 고정
  // 스키마로 읽으면 리바랩스가 아닌 raw data에서 원문 대조가 통째로 안 된다(2026-09-09 실측).
  const source = await loadQuestionSpecs(parsed.data.source, null);
  if (!source.ok) return NextResponse.json({ ok: false, error: source.error }, { status: 404 });
  const spec = findSpec(source.specs, parsed.data.questionKey);
  if (!spec) return NextResponse.json({ ok: false, error: "인용문이 사용된 문항을 찾지 못했습니다." }, { status: 404 });

  const grouped = new Map<number, {
    respondentId: number;
    originalResponse: string;
    matches: Array<{ quote: string; matchStart: number; matchEnd: number; needsReview: boolean }>;
  }>();

  for (const quote of [...new Set(parsed.data.quotes)]) {
    const quoteKey = normalized(quote);
    const input = spec.inputs.find((candidate) => normalized(candidate.reason).includes(quoteKey));
    if (!input) continue;
    const range = findNormalizedRange(input.reason, quote);
    const entry = grouped.get(input.respondent_id) ?? {
      respondentId: input.respondent_id,
      originalResponse: input.reason,
      matches: [],
    };
    entry.matches.push({
      quote,
      ...range,
      needsReview: needsReportQuoteEndingReview(quote),
    });
    grouped.set(input.respondent_id, entry);
  }

  const sources = [...grouped.values()];
  if (sources.length === 0) return NextResponse.json({ ok: false, error: "원본 응답에서 해당 인용문을 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, questionKey: spec.id, questionLabel: spec.label, sources });
}
