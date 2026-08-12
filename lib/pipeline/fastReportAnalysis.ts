/**
 * 보고서 생성용 고속 정성 분석 경로.
 *
 * 상세 감사 경로(Stage1 절 분리 → Stage2 군집화)는 응답 절을 전부 다시 반환하므로
 * 문항 하나에서도 출력이 2만 토큰 이상이 될 수 있다. 보고서에는 최종 카테고리, 검증된
 * 인용, 인사이트만 쓰이므로 이 경로는 그 결과만 한 번에 받는다. 원문 인용은 응답 원문과
 * 다시 대조해 통과한 값만 저장한다.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { Output } from "ai";
import { z } from "zod";
import type { QuestionSpec } from "./questions";
import { isVerbatimClause, type Polarity } from "./stage1";
import {
  Stage2CombinedOutputSchema,
  Stage2ImprovementOutputSchema,
  buildQuoteDisplayText,
  type Stage2ImprovementOutput,
  type Stage2ImprovementRawOutput,
  type Stage2Output,
  type Stage2RawOutput,
} from "./stage2";
import { streamStructured, withClaudeGuard } from "./claudeGuard";
import type { QuestionResult } from "./orchestrate";
import { computeNps } from "@/lib/quant/basic";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";
import { FAST_STANDARD_SYSTEM, FAST_IMPROVEMENT_SYSTEM } from "./prompts";

const FAST_MODEL = process.env.ANTHROPIC_QUALITATIVE_FAST_MODEL ?? process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

function filterVerifiedQuotes(output: Stage2RawOutput, reasons: string[]): Stage2Output {
  return {
    ...output,
    categories: output.categories.map((category) => {
      const quotes = category.quotes.filter((quote) => reasons.some((reason) => isVerbatimClause(reason, quote)));
      const quotesDisplay = quotes.map((quote) => buildQuoteDisplayText(quote, category.quoteEvidence));
      const { quoteEvidence: _quoteEvidence, ...rest } = category;
      return { ...rest, quotes, quotesDisplay };
    }),
  };
}

function assertCounts(output: { total_clause_count: number; categories: Array<{ clause_count: number }> }, label: string) {
  const count = output.categories.reduce((sum, category) => sum + category.clause_count, 0);
  if (count !== output.total_clause_count) {
    throw new Error(`${label} 절 집계 불일치: total ${output.total_clause_count}, 카테고리 합 ${count}`);
  }
}

/** 개선아이디어 2단 출력에서 각 소분류의 quotes 중 원문에 verbatim으로 있는 것만 남긴다. */
function filterImprovementQuotes(
  output: Stage2ImprovementRawOutput,
  reasons: string[],
): Stage2ImprovementOutput {
  return {
    ...output,
    major_categories: output.major_categories.map((major) => ({
      ...major,
      subcategories: major.subcategories.map((sub) => {
        const quotes = sub.quotes.filter((quote) => reasons.some((reason) => isVerbatimClause(reason, quote)));
        const quotesDisplay = quotes.map((quote) => buildQuoteDisplayText(quote, sub.quoteEvidence));
        const { quoteEvidence: _quoteEvidence, ...rest } = sub;
        return { ...rest, quotes, quotesDisplay };
      }),
    })),
  };
}

// 2단 구조에서는 한 응답이 여러 소분류에 걸쳐 나뉠 수 있어(원본도 동일 — 예: 튜토리얼+GPS를
// 함께 언급한 응답), 소분류 clause_count 합이 응답 수를 초과하는 것이 정상이다. 따라서 표준
// 문항의 assertCounts(엄격 일치)와 달리 여기서는 던지지 않고, 소분류·인용이 하나도 없는
// 비정상 출력만 오류로 막는다.
function assertImprovementCounts(output: Stage2ImprovementRawOutput, label: string) {
  const subs = output.major_categories.flatMap((major) => major.subcategories);
  if (subs.length === 0) {
    throw new Error(`${label} 개선 아이디어 소분류가 비어 있습니다.`);
  }
}

function standardPrompt(spec: Extract<QuestionSpec, { kind: "standard" }>): string {
  if (spec.id !== "nps") return `'${spec.label}' 문항의 원문 응답입니다.\n\n${JSON.stringify(spec.inputs)}`;

  // NPS 수치는 모델이 계산하는 값이 아니라 deterministic quant 결과를 주입한다.
  const nps = computeNps(spec.inputs.map((input) => input.score));
  return [
    `'${spec.label}' 문항의 원문 응답입니다.`,
    "",
    "nps_quantitative_context (이 수치만 사용):",
    JSON.stringify({
      average_purchase_or_recommendation_intent: nps.rawMean,
      nps_score: nps.npsScore,
      promoters_pct: nps.promoterPct,
      passives_pct: nps.passivePct,
      detractors_pct: nps.detractorPct,
      respondent_count: nps.n,
    }),
    "",
    "원문 응답:",
    JSON.stringify(spec.inputs),
  ].join("\n");
}

export async function runFastReportAnalysis(
  spec: QuestionSpec,
  options: { onUsage?: (usage: ClaudeUsageRecord) => void } = {},
): Promise<QuestionResult> {
  if (spec.kind === "improvement") {
    const traceLabel = `fast:${spec.label}`;
    const { output } = await withClaudeGuard(traceLabel, () => streamStructured<z.infer<typeof Stage2ImprovementOutputSchema>>({
      model: anthropic(FAST_MODEL),
      instructions: {
        role: "system",
        content: FAST_IMPROVEMENT_SYSTEM,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
      },
      prompt: `'${spec.label}' 문항의 원문 응답입니다.\n\n${JSON.stringify(spec.inputs)}`,
      output: Output.object({ schema: Stage2ImprovementOutputSchema }),
      // **2026-07-28 90s→120s로 상향(실측 근거)**: 14문항 전체 실행을 두 번 실측한 결과
      // (Codex 1차: 4/14 실패, 이번 재검증: 5/14 실패), 실패한 호출은 전부 정확히 90.0X초에서
      // 끊겼고 — Anthropic 쪽 오류가 아니라 이 hardTimeoutMs 자체가 원인이었다. 재시도로 성공한
      // 호출들도 74~87초가 걸려 90초 턱밑까지 갔다 — "정상 실측 45초"라는 예전 가정은 순차 실행
      // 기준이었고, 동시 3개 처리 중 뒤쪽 문항일수록 누적 부하로 45초보다 훨씬 오래 걸렸다.
      // 120초로 올리되 90×2=180초보다 크게 늘리지 않은 이유는, withClaudeGuard가 최대 2회
      // 재시도하므로 한 번의 run-next 요청이 최악의 경우 120×2=240초까지 걸릴 수 있는데, Vercel
      // 서버리스 함수 제한(maxDuration=300초, app/api/qualitative-jobs/[jobId]/run-next/route.ts)
      // 안에 60초 여유를 두고 들어와야 하기 때문이다.
      hardTimeoutMs: 120_000,
      // 2단 구조 + 소분류당 인용 다수라 예전 평면 구조(6000)보다 출력이 크다 — 넉넉히 상향.
      maxOutputTokens: 12000,
      reasoning: "none",
    }, traceLabel), { onUsage: options.onUsage });
    assertImprovementCounts(output, traceLabel);
    return {
      id: spec.id,
      label: spec.label,
      kind: "improvement",
      stage2: filterImprovementQuotes(output, spec.inputs.map((input) => input.reason)),
    };
  }

  const traceLabel = `fast:${spec.label}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<z.infer<typeof Stage2CombinedOutputSchema>>({
    model: anthropic(FAST_MODEL),
    instructions: {
      role: "system",
      content: FAST_STANDARD_SYSTEM,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: standardPrompt(spec),
    output: Output.object({ schema: Stage2CombinedOutputSchema }),
    // 90s→120s로 상향한 근거는 위 개선아이디어 분기 주석 참고 — 표준 문항 쪽이 실패 사례
    // 대부분(펫 레이싱·기능적/심미적/경제적/사회공공적 가치·유사서비스·전반적만족도)이었다.
    hardTimeoutMs: 120_000,
    maxOutputTokens: 8000,
    reasoning: "none",
  }, traceLabel), { onUsage: options.onUsage });

  const stage2ByPolarity: Partial<Record<Polarity, Stage2Output>> = {};
  const seen = new Set<Polarity>();
  for (const group of output.groups) {
    if (seen.has(group.polarity)) continue;
    assertCounts(group, traceLabel);
    stage2ByPolarity[group.polarity] = filterVerifiedQuotes(group, spec.inputs.map((input) => input.reason));
    seen.add(group.polarity);
  }
  return {
    id: spec.id,
    label: spec.label,
    kind: "standard",
    // 고속 경로는 보고서 산출물만 저장한다. 개별 절·극성 검수는 상세 감사 모드에서 제공한다.
    clauses: [],
    stage2ByPolarity,
    stage2Failures: [],
    npsJudgment: spec.id === "nps" ? output.nps_judgment : undefined,
  };
}
