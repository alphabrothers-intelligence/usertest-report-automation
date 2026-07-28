// Stage 1 — 문장/절 분리 + 극성 판정 (PRD 6.2절). 문항 1개당 1콜, 응답자 전체를 한 번에 처리한다.
//
// PRD 4.4절은 "generateObject + Zod 스키마"라고 표현하지만, 이 프로젝트가 쓰는 AI SDK 버전에서는
// generateObject/streamObject가 deprecated이고 generateText({ output: Output.object(...) })가
// 후속 API다(node_modules/ai/docs/03-ai-sdk-core/60-telemetry.mdx 참고). 강제되는 구조·의미는
// 동일하므로 여기서는 최신 API로 구현한다.
import { anthropic } from "@ai-sdk/anthropic";
import { Output } from "ai";
import { z } from "zod";
import { streamStructured, withClaudeGuard } from "./claudeGuard";

const STAGE1_MODEL = process.env.ANTHROPIC_STAGE1_MODEL ?? "claude-sonnet-5";

export const PolaritySchema = z.enum(["positive", "negative", "neutral"]);
export type Polarity = z.infer<typeof PolaritySchema>;

export const ClauseSchema = z.object({
  clause: z.string().describe("원문에서 그대로 복사한 절/문장. 의역·축약·맞춤법 교정 금지"),
  polarity: PolaritySchema,
  rationale: z.string().describe("판정근거 한 줄"),
});

const Stage1ModelOutputSchema = z.object({
  results: z.array(
    z.object({
      respondent_id: z.number(),
      score: z.number(),
      clauses: z.array(ClauseSchema),
    }),
  ),
});
type Stage1ModelOutput = z.infer<typeof Stage1ModelOutputSchema>;

export interface VerifiedClause {
  /** 원문에서 검증된 직접 인용 후보. null이면 분석에는 쓰되 보고서 인용에는 쓰지 않는다. */
  raw_clause: string | null;
  /** 오탈자·띄어쓰기만 보정할 수 있는 분석·군집화용 문장. */
  analysis_clause: string;
  polarity: Polarity;
  rationale: string;
}

export interface Stage1Output {
  results: Array<{
    respondent_id: number;
    score: number;
    clauses: VerifiedClause[];
  }>;
}

export interface Stage1Input {
  respondent_id: number;
  score: number;
  reason: string;
}

/**
 * 고객 인용문은 오탈자까지 원문 그대로여야 한다. 다만 Excel·모델 사이에서 바뀔 수 있는
 * 따옴표 모양과 공백/줄바꿈은 의미·표기 교정이 아니므로 비교 시에만 통일한다.
 */
function normalizeForVerbatimComparison(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u200B\s]+/g, "");
}

export function isVerbatimClause(source: string, clause: string): boolean {
  const normalizedClause = normalizeForVerbatimComparison(clause);
  return normalizedClause.length > 0 && normalizeForVerbatimComparison(source).includes(normalizedClause);
}

/**
 * 모델 출력은 한 문장만 받아 비용을 최소화한다. 원문 대조에 통과하면 직접 인용에도 쓰고,
 * 대조에 실패해도 분석용 문장으로는 유지하되 보고서 직접 인용에는 쓰지 않는다.
 */
function verifyRawClauses(
  output: Stage1ModelOutput,
  inputs: Stage1Input[],
): Stage1Output {
  const sourceByRespondent = new Map(inputs.map((input) => [input.respondent_id, input.reason]));
  let unverifiedCount = 0;
  const results = output.results.map((result) => {
    const source = sourceByRespondent.get(result.respondent_id) ?? "";
    const clauses = result.clauses.map((clause) => {
      const raw_clause = isVerbatimClause(source, clause.clause) ? clause.clause : null;
      if (!raw_clause) unverifiedCount += 1;
      return {
        raw_clause,
        analysis_clause: clause.clause,
        polarity: clause.polarity,
        rationale: clause.rationale,
      };
    });
    return { ...result, clauses };
  });
  if (unverifiedCount > 0) {
    console.warn(`[qualitative] Stage1 retained ${unverifiedCount} clause(s) for analysis but excluded them from direct quotes because raw text could not be verified`);
  }
  return { results };
}

// PRD 6.2절 [SYSTEM] 프롬프트 원문. 절대 의역·축약하지 않는다(4.4절: "6장의 프롬프트 내용 자체는
// 변경 없음" — 호출 방식만 구조화 출력으로 보강).
const STAGE1_SYSTEM_PROMPT = `당신은 사용성테스트 주관식 응답을 분석하는 리서치 애널리스트입니다.
아래 규칙에 따라 응답자들의 (점수, 이유) 데이터를 처리하세요.

# 작업 순서
1. 각 응답자의 "이유" 텍스트를 의미 단위(절 또는 문장)로 분리합니다.
   한 응답 안에 서로 다른 주제나 서로 다른 극성(긍정/부정/중립)의 내용이
   섞여 있으면 반드시 분리하세요. 하나의 응답이 여러 절로 나뉘어 서로 다른
   카테고리·극성에 배치되는 것이 정상입니다.
2. 분리된 각 단위에 극성을 판정합니다.
3. 판정 근거를 한 줄로 남깁니다.

# 극성 판정 기준 (가장 중요한 규칙)
- positive: 만족감, 효과 체감, 편리함 등을 진술
- negative: 문장 안에 **구체적인 부정적 결과**가 명시됨
  (예: 시간 손실, 오작동, 신체적·물리적 불편, 명시적 기능 결함,
  특정 상황에서 실제로 겪은 지장)
- neutral: 결함에 대한 구체적 서술 없이 개선 제안·선호·정보요청형
  의견만 존재. "불편하다", "아쉽다" 같은 표현이 있어도 구체적으로
  어떤 손해·지장이 발생했는지 서술이 없으면 neutral로 분류할 수 있습니다.

**표면적 어휘만으로 판단하지 마세요.** "불편하다"라는 단어가 있다고
자동으로 negative가 아닙니다. 문장이 서술하는 내용의 성격
(실제로 발생한 문제 vs 단순 선호/제안/비교)을 보고 판단하세요.
점수(score)는 텍스트만으로 판단이 정말 애매할 때만 보조적으로
참고하고, 텍스트 내용이 명확하면 점수와 무관하게 텍스트 기준으로
판정하세요.

# Few-shot 예시

## 예시 1 — 순수 긍정
입력: score=7, reason="위 기능에 대한 불편함은 못느낌"
출력: [{"clause": "위 기능에 대한 불편함은 못느낌", "polarity": "positive",
        "rationale": "결함 없음을 명시적으로 진술"}]

## 예시 2 — 동일 점수, 반대 극성 (점수만으로 판단하면 안 되는 이유)
입력: score=7, reason="그립감이 떨어지며 각도를 조정 잘 해야하는 불편함"
출력: [{"clause": "그립감이 떨어지며 각도를 조정 잘 해야하는 불편함",
        "polarity": "negative",
        "rationale": "신체적 불편(그립감 저하)이라는 구체적 결과가 명시됨"}]

## 예시 3 — 표면적으로 비슷한 "불편하다" 표현이 다르게 분류되는 경계 사례
입력: score=7, reason="Body Shot 할때 부위가 넓어 일시정지없이 사용되있으면
합니다 중간에 멈추니까 불편하고 시간이 너무 걸려요 / 페이스도 일시정지
없이 게속하는게 좋을것 같아요 / 내가 원하는곳에 조금더 하고싶은데
모드변경을 다시 제설정해야 되어 불편합니다"
출력: [
  {"clause": "Body Shot 할때 부위가 넓어 일시정지없이 사용되있으면 합니다
             중간에 멈추니까 불편하고 시간이 너무 걸려요",
   "polarity": "negative",
   "rationale": "시간 손실이라는 구체적 결과가 명시됨"},
  {"clause": "페이스도 일시정지 없이 게속하는게 좋을것 같아요",
   "polarity": "neutral",
   "rationale": "구체적 결과 서술 없이 기능 개선 선호만 표현"},
  {"clause": "내가 원하는곳에 조금더 하고싶은데 모드변경을 다시
             제설정해야 되어 불편합니다",
   "polarity": "neutral",
   "rationale": "'불편하다'는 표현이 있으나 구체적 손실이 없고
                재설정 절차에 대한 선호 표현에 가까움"}
]

## 예시 4 — 한 응답이 3개 극성에 걸쳐 분리되는 사례
입력: score=4, reason="시간, 거리 등이 나와서 정말 운동 앱 같은 느낌이다.
상자를 먹을 때 어느정도까지 가까이 가야 먹을 수 있는지 확실하지 않다.
제한 속도가 어느정도인진 모르겠으나, 타겜에 비해 좀 느슨한 편인 거 같다."
출력: [
  {"clause": "시간, 거리 등이 나와서 정말 운동 앱 같은 느낌이다",
   "polarity": "positive", "rationale": "운동 효과 체감을 긍정적으로 진술"},
  {"clause": "상자를 먹을 때 어느정도까지 가까이 가야 먹을 수 있는지
             확실하지 않다",
   "polarity": "negative",
   "rationale": "상호작용 기준 불명확이라는 구체적 사용상 문제"},
  {"clause": "제한 속도가 어느정도인진 모르겠으나, 타겜에 비해
             좀 느슨한 편인 거 같다",
   "polarity": "neutral",
   "rationale": "타 서비스와의 단순 비교·관찰이며 본인이 겪은
                구체적 불이익 서술이 없음"}
]

# 절대 규칙
- clause 필드는 원문을 그대로 복사하세요. 절대 의역·축약·맞춤법 교정을
  하지 마세요. 원문 대조에 통과한 값만 보고서의 실제 고객 인용문으로 사용합니다.
- 의미 있는 내용이 없는 응답("없음", "특별히 없음", 공백 등)은
  clauses를 빈 배열 []로 두세요.
- 오탈자나 비문이 있어도 원문 그대로 두세요.`;

function toJsonl(inputs: Stage1Input[]): string {
  return inputs
    .map((i) =>
      JSON.stringify({ respondent_id: i.respondent_id, score: i.score, reason: i.reason }),
    )
    .join("\n");
}

export async function runStage1({
  questionLabel,
  inputs,
}: {
  questionLabel: string;
  inputs: Stage1Input[];
}): Promise<Stage1Output> {
  const traceLabel = `stage1:${questionLabel}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage1ModelOutput>({
    model: anthropic(STAGE1_MODEL),
    // 표준 문항(6+4+1+1+1=13개)마다 이 함수가 호출되는데 시스템 프롬프트(few-shot 포함)가
    // 매번 동일하다. **이 AI SDK 버전은 `system` 단축 파라미터를 지원하지 않는다** — 넣으면
    // "System messages are not allowed in the prompt or messages fields. Use the instructions
    // option instead."로 즉시 에러가 난다(실측 확인, 2026-07-16). `@ai-sdk/anthropic`의 캐싱
    // 문서 예제(messages 배열에 role:"system")는 이 AI SDK 코어 버전 기준 최신이 아니다 —
    // node_modules/ai/docs/02-foundations/03-prompts.mdx "Provider Options > Message Level"
    // 안내대로 `instructions` 옵션에 객체 형태로 providerOptions를 붙여야 한다. ttl을 1h로 잡은
    // 이유: 파이프라인 1회 실행이 실측 900초+ 걸릴 수 있어(check:category-coverage) 기본 5분
    // TTL로는 뒷문항이 캐시 만료 후 호출될 수 있다.
    instructions: {
      role: "system",
      content: STAGE1_SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: `다음은 '${questionLabel}' 문항에 대한 응답자 ${inputs.length}명의 (점수, 이유) 데이터입니다.\n\n${toJsonl(inputs)}`,
    output: Output.object({ schema: Stage1ModelOutputSchema }),
    // maxOutputTokens를 지정하지 않으면 SDK가 매우 큰 기본값(실측 128,000)을 잡아, 응답이
    // 끝나기 전까지 헤더조차 안 와서 undici 기본 300초 헤더 타임아웃에 걸린다(실측 확인 —
    // check:qualitative를 처음 돌렸을 때 HeadersTimeoutError로 재현됨). 100명 전체를 한 번에
    // 처리하는 가장 큰 문항 기준으로 32000까지 올려야 finishReason이 "length"(중간에 잘림)가
    // 아니라 "stop"으로 끝난다(실측 확인, 2026-07-16 — check:category-coverage 실패로 발견).
    maxOutputTokens: 32000,
    // **claude-sonnet-5는 reasoning(내부 사고)이 기본값(provider-default)으로 켜져 있고,
    // reasoning 토큰이 maxOutputTokens 예산을 먼저 소비한다.** 이 문항 하나만 재현했을 때
    // reasoning을 안 끄면 16000토큰을 전부 써버리고도 응답자 1명분(371자)만 출력하고 잘렸다 —
    // 끄니 같은 예산으로 응답자 100명 전체(22000자+)를 다 처리했다. Stage1/Stage2는 few-shot
    // 예시로 규칙이 이미 명시된 분류·추출 작업이라 깊은 추론이 필요 없다 — **이 옵션을 절대
    // 지우지 말 것.** 지우면 다시 대용량 문항에서 잘림/타임아웃이 재현된다.
    reasoning: "none",
  }, traceLabel));

  return verifyRawClauses(output, inputs);
}

/**
 * PRD 6.6절 — 개선아이디어(58번 컬럼) 변형: 점수 없는 자유서술 단일 문항이라 극성 판정이
 * 필요 없다. 문장 분리만 수행한다.
 */
const Stage1ImprovementModelOutputSchema = z.object({
  results: z.array(
    z.object({
      respondent_id: z.number(),
      clauses: z.array(
        z.object({
          clause: z.string().describe("원문 그대로 복사한 절/문장"),
        }),
      ),
    }),
  ),
});

type Stage1ImprovementModelOutput = z.infer<typeof Stage1ImprovementModelOutputSchema>;
export interface Stage1ImprovementOutput {
  results: Array<{
    respondent_id: number;
    clauses: Array<{
      raw_clause: string | null;
      analysis_clause: string;
    }>;
  }>;
}

function verifyImprovementRawClauses(
  output: Stage1ImprovementModelOutput,
  inputs: { respondent_id: number; reason: string }[],
): Stage1ImprovementOutput {
  const sourceByRespondent = new Map(inputs.map((input) => [input.respondent_id, input.reason]));
  let unverifiedCount = 0;
  const results = output.results.map((result) => ({
    ...result,
    clauses: result.clauses.map((clause) => {
      const source = sourceByRespondent.get(result.respondent_id) ?? "";
      const raw_clause = isVerbatimClause(source, clause.clause) ? clause.clause : null;
      if (!raw_clause) unverifiedCount += 1;
      return { raw_clause, analysis_clause: clause.clause };
    }),
  }));
  if (unverifiedCount > 0) {
    console.warn(`[qualitative] Stage1 improvement retained ${unverifiedCount} clause(s) for analysis but excluded them from direct quotes because raw text could not be verified`);
  }
  return { results };
}

const STAGE1_IMPROVEMENT_SYSTEM_PROMPT = `당신은 사용성테스트 주관식 응답을 분석하는 리서치 애널리스트입니다.
이 문항은 점수 없이 자유서술로 개선 아이디어를 받는 질문입니다.
극성 판정 없이, 각 응답자의 텍스트를 의미 단위(절 또는 문장)로 분리하고
주제별로만 표시하세요. (polarity 필드는 생략합니다)

# 절대 규칙
- clause 필드는 원문을 그대로 복사하세요. 절대 의역·축약·맞춤법 교정을
  하지 마세요. 원문 대조에 통과한 값만 보고서의 실제 고객 인용문으로 사용합니다.
- 의미 있는 내용이 없는 응답("없음", "특별히 없음", 공백 등)은
  clauses를 빈 배열 []로 두세요.
- 오탈자나 비문이 있어도 원문 그대로 두세요.`;

export async function runStage1ImprovementIdea({
  questionLabel,
  inputs,
}: {
  questionLabel: string;
  inputs: { respondent_id: number; reason: string }[];
}): Promise<Stage1ImprovementOutput> {
  const jsonl = inputs
    .map((i) => JSON.stringify({ respondent_id: i.respondent_id, reason: i.reason }))
    .join("\n");

  const traceLabel = `stage1-improvement:${questionLabel}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage1ImprovementModelOutput>({
    model: anthropic(STAGE1_MODEL),
    // runStage1과 같은 Anthropic 프롬프트 캐시·메시지 전달 방식으로 통일한다.
    // 스트리밍 전환 뒤에도 이 문항만 옛 system 단축값을 쓰면, 공급자/SDK 조합에 따라
    // "System messages are not allowed" 오류가 재발할 수 있다.
    instructions: {
      role: "system",
      content: STAGE1_IMPROVEMENT_SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: `다음은 '${questionLabel}' 문항에 대한 응답자 ${inputs.length}명의 자유서술 응답입니다.\n\n${jsonl}`,
    output: Output.object({ schema: Stage1ImprovementModelOutputSchema }),
    maxOutputTokens: 32000, // 위 runStage1과 동일한 이유
    reasoning: "none", // 위 runStage1과 동일한 이유 — 절대 지우지 말 것
  }, traceLabel));

  return verifyImprovementRawClauses(output, inputs);
}
