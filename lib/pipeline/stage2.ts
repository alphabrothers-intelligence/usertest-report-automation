// Stage 2 — 극성별 카테고리 클러스터링 + 대표인용 + 인사이트 초안 (PRD 6.3절).
// label·quotes는 Tier 1(자동 확정), insight는 Tier 2(AI 초안 + 체크포인트 B 필수 편집, 7.2절).
import { anthropic } from "@ai-sdk/anthropic";
import { Output } from "ai";
import { z } from "zod";
import type { Polarity } from "./stage1";
import { streamStructured, withClaudeGuard } from "./claudeGuard";

const STAGE2_MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

export const CategorySchema = z.object({
  label: z.string().describe("대괄호 없이 카테고리명만 (예: GPS 및 걸음 수 측정 부정확성 문제)"),
  clause_count: z
    .number()
    .describe("이 카테고리에 속하는 전체 clause 개수 — quotes에 포함 안 된 것도 포함"),
  quotes: z.array(z.string()).describe("입력 raw_clause 원문 중에서만 verbatim으로 선택한 대표 인용 2~4개"),
  insight: z.string().describe("관찰·시사점 톤의 인사이트 한 줄. 화살표 기호는 붙이지 않음"),
});

export const Stage2OutputSchema = z.object({
  polarity: z.enum(["positive", "negative", "neutral"]),
  total_clause_count: z.number(),
  categories: z.array(CategorySchema),
});

export type Stage2Output = z.infer<typeof Stage2OutputSchema>;

/**
 * 고속 경로용 묶음 출력. 기존에는 같은 문항의 긍정·부정·중립을 각각 호출했지만,
 * 이 구조는 세 극성을 한 번의 구조화 응답으로 돌려 반복 프롬프트와 대기열을 제거한다.
 */
export const Stage2CombinedOutputSchema = z.object({
  groups: z.array(Stage2OutputSchema),
});
type Stage2CombinedOutput = z.infer<typeof Stage2CombinedOutputSchema>;

const STAGE2_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서를 작성하는 애널리스트입니다.
Stage1에서 극성별로 분류된 응답 절 목록을 받아, 실제 발행되는
보고서와 동일한 형식으로 카테고리화합니다.

# 작업 순서
1. 같은 극성 내에서, analysis_clause의 유사한 주제·맥락을 가진 절들을 그룹핑합니다.
2. 각 그룹에 대괄호 카테고리명을 붙입니다. (예: "GPS 및 걸음 수 측정
   부정확성 문제")
3. 각 카테고리에서 가장 대표성 있고 구체적인 인용문을 2~4개 선택합니다.
   (해당 극성의 clause를 전부 인용하지 않습니다. 대표성 있는 것만 고릅니다.)
4. 각 카테고리 마지막에 인사이트 한 줄을 씁니다. 인사이트는 관찰·시사점
   톤으로 쓰고("~개선 필요", "~니즈 확인", "~정합성 개선 필요"),
   화살표 기호는 붙이지 마세요(조립 단계에서 자동으로 붙습니다).

# 카테고리 세분화 지침 (중요)
큰 대분류(2~3개)로 뭉뚱그리지 마세요. 실제 언급된 구체적 대상·맥락
단위로 세분화합니다. 예를 들어 "지도 조작 문제"와 "GPS 정확도 문제"는
원인이 다르므로 별도 카테고리로 분리해야 합니다. 실제 보고서는 한
극성 안에 보통 4~9개의 세부 카테고리를 사용합니다. clause 개수가
너무 적어(1~2개) 별도 카테고리로 보기 어려운 경우는 유사 카테고리에
합치거나 "기타" 성격 카테고리로 묶어도 됩니다.

# Few-shot 예시
입력(negative clause 목록 일부):
[
  {"respondent_id": 11, "clause": "gps가 부정확해서 걸은 길이나
   걸음수가 제대로 체크 되지 않아요"},
  {"respondent_id": 16, "clause": "경로가 지도상 도로를 따라 찍히지
   않고 건물을 뚫고 찍히거나 가끔 아예 다른 길로 표시되어 아쉬웠다"},
  {"respondent_id": 40, "clause": "실제 걸음 수와 게임에서 측정하는
   걸음 수에 많은 차이가 있었다"}
]
출력:
{
  "label": "GPS 및 걸음 수 측정 부정확성 문제",
  "quotes": [
    "gps가 부정확해서 걸은 길이나 걸음수가 제대로 체크 되지 않아요",
    "경로가 지도상 도로를 따라 찍히지 않고 건물을 뚫고 찍히거나
     가끔 아예 다른 길로 표시되어 아쉬웠다"
  ],
  "insight": "GPS 정확도 및 걸음 수 측정 정확도 개선 필요"
}

# 절대 규칙
- quotes는 quote_verified=true인 입력에서만 verbatim으로 선택하세요. raw_clause가 있으면
  그 값을, 없으면 analysis_clause 값을 인용하세요. analysis_clause는 군집화·카테고리명·
  인사이트 작성에 사용합니다.
  새로 문장을 만들거나 여러 절을 합쳐 재구성하지 마세요.
- clause_count의 합은 total_clause_count와 일치해야 합니다
  (모든 clause가 어딘가의 카테고리에 속해야 합니다).`;

const POLARITY_KR: Record<Polarity, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

const STAGE2_COMBINED_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서를 작성하는 애널리스트입니다.
하나의 설문 문항에 대해 긍정·부정·중립 절 목록이 함께 주어집니다.
각 극성은 서로 섞지 말고 독립적으로 카테고리화하세요.

# 출력 규칙
- 입력에 존재하는 극성마다 groups에 정확히 하나의 결과를 만드세요.
- 각 결과의 polarity, total_clause_count, categories를 채우세요.
- 같은 극성 안에서 유사 주제·맥락의 analysis_clause를 묶되, 3~6개 세부 카테고리로 정리하세요.
- 각 카테고리는 대표 인용 1~2개와 한 줄 인사이트를 포함하세요.
- quotes는 quote_verified=true인 입력에서만 원문 그대로 선택하세요. raw_clause가 있으면 raw_clause를,
  없으면 analysis_clause를 쓰세요. 새 문장을 만들거나 여러 절을 합치지 마세요.
- clause_count 합계와 total_clause_count는 해당 극성의 입력 절 수와 반드시 일치해야 합니다.
- 인사이트는 "~개선 필요", "~니즈 확인" 같은 관찰·시사점 한 줄로 쓰며 화살표는 붙이지 마세요.`;

export interface Stage2ClauseInput {
  respondent_id: number;
  /** 군집화·인사이트 작성에 사용하는 맞춤법 보정 가능 분석 문장 */
  analysis_clause: string;
  /** analysis_clause가 원문과 다르면서도 원문 대조에 통과한 경우에만 전송한다. */
  raw_clause?: string;
  /** true일 때만 직접 인용 가능하다. false면 분석·군집화에만 쓴다. */
  quote_verified: boolean;
}

function assertCategoryCounts(
  output: Stage2Output,
  expectedClauseCount: number,
  traceLabel: string,
) {
  const categorizedCount = output.categories.reduce((sum, category) => sum + category.clause_count, 0);
  if (output.total_clause_count !== expectedClauseCount || categorizedCount !== expectedClauseCount) {
    throw new Error(
      `${traceLabel} 절 집계 불일치: 입력 ${expectedClauseCount}, total ${output.total_clause_count}, 카테고리 합 ${categorizedCount}`,
    );
  }
}

function quoteCandidate(clause: Stage2ClauseInput): string | null {
  if (!clause.quote_verified) return null;
  return clause.raw_clause ?? clause.analysis_clause;
}

/**
 * 모델 지시를 한 번 더 강제한다. 분석용 보정 문장이나 모델이 새로 만든 문장이 직접 인용으로
 * 저장되는 것을 막되, 카테고리·건수·인사이트(분석 결과)는 유지한다.
 */
function retainOnlyVerifiedQuotes<T extends { categories: Array<{ quotes: string[] }> }>(
  output: T,
  clauses: Stage2ClauseInput[],
): T {
  const approvedQuotes = new Set(
    clauses.flatMap((clause) => {
      const candidate = quoteCandidate(clause);
      return candidate ? [candidate] : [];
    }),
  );
  let removedCount = 0;
  const categories = output.categories.map((category) => {
    const quotes = category.quotes.filter((quote) => {
      const allowed = approvedQuotes.has(quote);
      if (!allowed) removedCount += 1;
      return allowed;
    });
    return { ...category, quotes };
  });
  if (removedCount > 0) {
    console.warn(`[qualitative] Stage2 removed ${removedCount} quote(s) that did not exactly match verified raw text`);
  }
  return { ...output, categories };
}

export async function runStage2({
  questionLabel,
  polarity,
  clauses,
}: {
  questionLabel: string;
  polarity: Polarity;
  clauses: Stage2ClauseInput[];
}): Promise<Stage2Output> {
  const traceLabel = `stage2:${questionLabel}:${polarity}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage2Output>({
    model: anthropic(STAGE2_MODEL),
    // 표준 문항 13개 × 극성 최대 3개 = 최대 39회 호출되는데 시스템 프롬프트가 매번 동일하다.
    // `instructions` 옵션 사용 이유는 stage1.ts의 상세 주석 참고(`system` 단축 파라미터는 이
    // AI SDK 버전에서 아예 지원 안 함 — 실측 확인).
    instructions: {
      role: "system",
      content: STAGE2_SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: `'${questionLabel}' 문항의 ${POLARITY_KR[polarity]} 응답 ${clauses.length}건입니다.\n\n${JSON.stringify(clauses)}`,
    output: Output.object({ schema: Stage2OutputSchema }),
    maxOutputTokens: 16000, // 큰 기본값이 헤더 타임아웃을 유발함 — stage1.ts의 상세 주석 참고
    reasoning: "none", // reasoning이 토큰 예산을 먼저 소비한다 — stage1.ts의 상세 주석 참고. 절대 지우지 말 것
    // 요청 전체·청크 타임아웃은 streamStructured가 일괄 적용한다.
    // 여기에서 비스트리밍용 timeout 값을 넘기지 않는다.
  }, traceLabel));

  return retainOnlyVerifiedQuotes(output, clauses);
}

/**
 * 표준 문항 한 개의 모든 극성을 한 번에 카테고리화하는 고속 Stage2.
 * 기존 runStage2는 호환성과 개별 재실행을 위해 유지한다.
 */
export async function runStage2AllPolarities({
  questionLabel,
  groups,
}: {
  questionLabel: string;
  groups: Partial<Record<Polarity, Stage2ClauseInput[]>>;
}): Promise<Partial<Record<Polarity, Stage2Output>>> {
  const activeGroups = (Object.entries(groups) as Array<[Polarity, Stage2ClauseInput[]]>).filter(
    ([, clauses]) => clauses.length > 0,
  );
  if (activeGroups.length === 0) return {};

  const traceLabel = `stage2-combined:${questionLabel}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage2CombinedOutput>({
    model: anthropic(STAGE2_MODEL),
    instructions: {
      role: "system",
      content: STAGE2_COMBINED_SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: `'${questionLabel}' 문항의 극성별 응답 절입니다.\n\n${JSON.stringify(
      Object.fromEntries(activeGroups),
    )}`,
    output: Output.object({ schema: Stage2CombinedOutputSchema }),
    // 3개 극성을 합쳐도 기존 3회 결과의 실제 출력량(약 9~10k)을 넘지 않도록 상한을 둔다.
    maxOutputTokens: 12000,
    reasoning: "none",
  }, traceLabel));

  const result: Partial<Record<Polarity, Stage2Output>> = {};
  const seen = new Set<Polarity>();
  for (const group of output.groups) {
    const clauses = groups[group.polarity];
    if (!clauses || clauses.length === 0 || seen.has(group.polarity)) continue;
    assertCategoryCounts(group, clauses.length, traceLabel);
    result[group.polarity] = retainOnlyVerifiedQuotes(group, clauses);
    seen.add(group.polarity);
  }

  const missing = activeGroups
    .map(([polarity]) => polarity)
    .filter((polarity) => !seen.has(polarity));
  if (missing.length > 0) {
    throw new Error(`${traceLabel} 결과에서 극성 ${missing.join(", ")} 이(가) 누락됐습니다.`);
  }
  return result;
}

/** PRD 6.6절 — 개선아이디어는 극성 구분 없이 카테고리화만 수행한다. */
export const Stage2ImprovementOutputSchema = z.object({
  total_clause_count: z.number(),
  categories: z.array(CategorySchema),
});

export type Stage2ImprovementOutput = z.infer<typeof Stage2ImprovementOutputSchema>;

const STAGE2_IMPROVEMENT_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서를 작성하는 애널리스트입니다.
Stage1에서 문장 분리된 개선 아이디어 응답 절 목록을 받아, 실제
발행되는 보고서와 동일한 형식으로 카테고리화합니다. 이 문항은 점수·극성
구분이 없는 자유서술 개선 아이디어이므로, 극성과 무관하게 유사한
주제·맥락을 가진 clause들을 그룹핑하세요.

# 작업 순서
1. 유사한 주제·맥락을 가진 clause들을 그룹핑합니다.
2. 각 그룹에 대괄호 카테고리명을 붙입니다.
3. 각 카테고리에서 가장 대표성 있고 구체적인 인용문을 2~4개 선택합니다.
4. 각 카테고리 마지막에 인사이트 한 줄을 씁니다. 인사이트는 관찰·시사점
   톤으로 쓰고, 화살표 기호는 붙이지 마세요.

# 카테고리 세분화 지침
큰 대분류로 뭉뚱그리지 말고, 실제 언급된 구체적 대상·맥락 단위로
세분화하세요. clause 개수가 너무 적은 경우 유사 카테고리에 합치거나
"기타" 성격 카테고리로 묶어도 됩니다.

# 절대 규칙
- quotes는 quote_verified=true인 입력에서만 verbatim으로 선택하세요. raw_clause가 있으면
  그 값을, 없으면 analysis_clause 값을 인용하세요.
- clause_count의 합은 total_clause_count와 일치해야 합니다.`;

export async function runStage2ImprovementIdea({
  questionLabel,
  clauses,
}: {
  questionLabel: string;
  clauses: Stage2ClauseInput[];
}): Promise<Stage2ImprovementOutput> {
  const traceLabel = `stage2-improvement:${questionLabel}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage2ImprovementOutput>({
    model: anthropic(STAGE2_MODEL),
    instructions: {
      role: "system",
      content: STAGE2_IMPROVEMENT_SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: `'${questionLabel}' 문항의 개선 아이디어 응답 ${clauses.length}건입니다.\n\n${JSON.stringify(clauses)}`,
    output: Output.object({ schema: Stage2ImprovementOutputSchema }),
    maxOutputTokens: 16000, // 큰 기본값이 헤더 타임아웃을 유발함 — stage1.ts의 상세 주석 참고
    reasoning: "none", // reasoning이 토큰 예산을 먼저 소비한다 — stage1.ts의 상세 주석 참고. 절대 지우지 말 것
    // 요청 전체·청크 타임아웃은 streamStructured가 일괄 적용한다.
  }, traceLabel));

  return retainOnlyVerifiedQuotes(output, clauses);
}
