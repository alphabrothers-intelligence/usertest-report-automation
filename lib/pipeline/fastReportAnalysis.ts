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
  type Stage2Output,
} from "./stage2";
import { streamStructured, withClaudeGuard } from "./claudeGuard";
import type { QuestionResult } from "./orchestrate";
import { computeNps } from "@/lib/quant/basic";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

const FAST_MODEL = process.env.ANTHROPIC_QUALITATIVE_FAST_MODEL ?? process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

const FAST_STANDARD_SYSTEM = `당신은 사용성테스트 결과보고서 작성 애널리스트입니다.
한 설문 문항의 (응답자 번호, 점수, 원문 이유) 전체를 분석하여 보고서에 바로 넣을 수 있는
긍정·부정·중립 의견 카테고리와 대표 인용, 인사이트를 만드세요.

중요: 내부적으로는 각 응답을 의미 단위로 나누어 극성을 판정하고 카테고리화하되, 출력에는
개별 절 목록을 절대 반복하지 마세요. 이는 긴 절 목록을 반환하지 않고도 보고서 품질을 유지하기
위한 규칙입니다.

출력 규칙:
- 실제 언급된 구체적 대상·맥락별로 각 극성 3~6개 카테고리를 만듭니다.
- category.clause_count는 내부적으로 분리한 의미 단위 수이며, 각 극성의 categories 합과
  total_clause_count는 일치해야 합니다.
- quotes는 입력의 reason에서 문자 그대로 연속해 등장하는 문장만 1~2개 선택합니다.
  오탈자 교정, 여러 문장 결합, 의역은 금지합니다.
- insight는 한 줄의 관찰·시사점 문장으로 작성하고 화살표 기호는 넣지 마세요.
- insight는 보고서 개조식 문체로 명사형 종결만 씁니다("~함", "~강화", "~부합", "~필요" 등).
  "~다"로 끝나는 서술형 문장(예: "~부합한다", "~높인다", "~유발한다")은 절대 쓰지 마세요.
- 단순 개선 제안·선호·정보 요청은 구체적 손해가 없으면 neutral로 분류합니다.
- 입력에 해당 극성의 의미 단위가 없으면 그 극성 group은 만들지 마세요.

# NPS 문항에서만 추가 출력
- 입력에 nps_quantitative_context가 있을 때에만 nps_judgment.lines를 정확히 3개 작성합니다.
- 각 줄은 화면에서 자동으로 붙는 화살표를 제외한 한 문장으로 쓰며, 번호·글머리표·화살표를 넣지 마세요.
- 제공된 NPS 수치(평균, NPS, 구매·중립·비구매 고객 비율)는 그대로 사용하고, 계산하거나 다른 수치를 만들지 마세요.
- 판단은 수치와 reason 원문에서 확인되는 사실에만 근거합니다. 외부 벤치마크, 원문에 없는 기능·원인, 단정적 시장 전망은 쓰지 마세요.
- 1번은 NPS 점수와 고객군 비율의 사실 기반 판단, 2번은 중립/비구매 고객 비율과 전환·개선 필요성, 3번은 reason에 반복된 불편·개선 요구 반영 필요성을 다룹니다.
- 보고서 개조식 문체로 "~필요함", "~확인됨", "~사료됨"처럼 종결하고, 각 줄은 110자 이내로 간결하게 씁니다.
- NPS가 아닌 문항에서는 nps_judgment를 절대 만들지 마세요.`;

const FAST_IMPROVEMENT_SYSTEM = `당신은 사용성테스트 결과보고서 작성 애널리스트입니다.
자유서술 개선 아이디어 전체를 실제 언급된 구체적 주제·맥락별로 4~8개 카테고리로 정리하세요.
내부적으로 의미 단위 수를 세되 개별 절 목록은 출력하지 마세요.
quotes는 입력 reason에 문자 그대로 연속해 등장하는 문장만 1~2개 선택하고, 의역·교정·결합은
금지합니다. insight는 한 줄의 관찰·시사점이며 화살표 기호를 넣지 마세요.
insight는 보고서 개조식 문체로 명사형 종결만 씁니다("~함", "~강화", "~필요" 등) — "~다"로
끝나는 서술형 문장은 쓰지 마세요.
category.clause_count 합은 total_clause_count와 반드시 일치해야 합니다.`;

function filterVerifiedQuotes<T extends { categories: Array<{ quotes: string[] }> }>(
  output: T,
  reasons: string[],
): T {
  return {
    ...output,
    categories: output.categories.map((category) => ({
      ...category,
      quotes: category.quotes.filter((quote) => reasons.some((reason) => isVerbatimClause(reason, quote))),
    })),
  };
}

function assertCounts(output: { total_clause_count: number; categories: Array<{ clause_count: number }> }, label: string) {
  const count = output.categories.reduce((sum, category) => sum + category.clause_count, 0);
  if (count !== output.total_clause_count) {
    throw new Error(`${label} 절 집계 불일치: total ${output.total_clause_count}, 카테고리 합 ${count}`);
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
      maxOutputTokens: 6000,
      reasoning: "none",
    }, traceLabel), { onUsage: options.onUsage });
    assertCounts(output, traceLabel);
    return {
      id: spec.id,
      label: spec.label,
      kind: "improvement",
      stage2: filterVerifiedQuotes(output, spec.inputs.map((input) => input.reason)),
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
