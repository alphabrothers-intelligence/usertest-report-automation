// Stage 2 — 극성별 카테고리 클러스터링 + 대표인용 + 인사이트 초안 (PRD 6.3절).
// label·quotes는 Tier 1(자동 확정), insight는 Tier 2(AI 초안 + 체크포인트 B 필수 편집, 7.2절).
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Polarity } from "./stage1";

const STAGE2_MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

export const CategorySchema = z.object({
  label: z.string().describe("대괄호 없이 카테고리명만 (예: GPS 및 걸음 수 측정 부정확성 문제)"),
  clause_count: z
    .number()
    .describe("이 카테고리에 속하는 전체 clause 개수 — quotes에 포함 안 된 것도 포함"),
  quotes: z.array(z.string()).describe("입력 clause 원문 중에서만 verbatim으로 선택한 대표 인용 2~4개"),
  insight: z.string().describe("관찰·시사점 톤의 인사이트 한 줄. 화살표 기호는 붙이지 않음"),
});

export const Stage2OutputSchema = z.object({
  polarity: z.enum(["positive", "negative", "neutral"]),
  total_clause_count: z.number(),
  categories: z.array(CategorySchema),
});

export type Stage2Output = z.infer<typeof Stage2OutputSchema>;

const STAGE2_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서를 작성하는 애널리스트입니다.
Stage1에서 극성별로 분류된 응답 절(clause) 목록을 받아, 실제 발행되는
보고서와 동일한 형식으로 카테고리화합니다.

# 작업 순서
1. 같은 극성 내에서, 유사한 주제·맥락을 가진 clause들을 그룹핑합니다.
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
- quotes는 입력으로 받은 clause 원문 중에서만 verbatim으로 선택하세요.
  새로 문장을 만들거나 여러 clause를 합쳐 재구성하지 마세요.
- clause_count의 합은 total_clause_count와 일치해야 합니다
  (모든 clause가 어딘가의 카테고리에 속해야 합니다).`;

const POLARITY_KR: Record<Polarity, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

export interface Stage2ClauseInput {
  respondent_id: number;
  clause: string;
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
  const { output } = await generateText({
    model: anthropic(STAGE2_MODEL),
    system: STAGE2_SYSTEM_PROMPT,
    prompt: `'${questionLabel}' 문항의 ${POLARITY_KR[polarity]} 응답 ${clauses.length}건입니다.\n\n${JSON.stringify(clauses)}`,
    output: Output.object({ schema: Stage2OutputSchema }),
    maxOutputTokens: 16000, // 큰 기본값이 헤더 타임아웃을 유발함 — stage1.ts의 상세 주석 참고
    reasoning: "none", // reasoning이 토큰 예산을 먼저 소비한다 — stage1.ts의 상세 주석 참고. 절대 지우지 말 것
    temperature: 0, // claude-sonnet-5는 무시함 — stage1.ts의 상세 주석 참고
  });

  return output;
}

/** PRD 6.6절 — 개선아이디어는 극성 구분 없이 카테고리화만 수행한다. */
export const Stage2ImprovementOutputSchema = z.object({
  total_clause_count: z.number(),
  categories: z.array(CategorySchema),
});

export type Stage2ImprovementOutput = z.infer<typeof Stage2ImprovementOutputSchema>;

const STAGE2_IMPROVEMENT_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서를 작성하는 애널리스트입니다.
Stage1에서 문장 분리된 개선 아이디어 응답 절(clause) 목록을 받아, 실제
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
- quotes는 입력으로 받은 clause 원문 중에서만 verbatim으로 선택하세요.
- clause_count의 합은 total_clause_count와 일치해야 합니다.`;

export async function runStage2ImprovementIdea({
  questionLabel,
  clauses,
}: {
  questionLabel: string;
  clauses: Stage2ClauseInput[];
}): Promise<Stage2ImprovementOutput> {
  const { output } = await generateText({
    model: anthropic(STAGE2_MODEL),
    system: STAGE2_IMPROVEMENT_SYSTEM_PROMPT,
    prompt: `'${questionLabel}' 문항의 개선 아이디어 응답 ${clauses.length}건입니다.\n\n${JSON.stringify(clauses)}`,
    output: Output.object({ schema: Stage2ImprovementOutputSchema }),
    maxOutputTokens: 16000, // 큰 기본값이 헤더 타임아웃을 유발함 — stage1.ts의 상세 주석 참고
    reasoning: "none", // reasoning이 토큰 예산을 먼저 소비한다 — stage1.ts의 상세 주석 참고. 절대 지우지 말 것
    temperature: 0, // claude-sonnet-5는 무시함 — stage1.ts의 상세 주석 참고
  });

  return output;
}
