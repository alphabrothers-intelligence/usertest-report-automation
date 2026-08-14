// Stage 1 — 문장/절 분리 + 극성 판정 (PRD 6.2절). 문항 1개당 1콜, 응답자 전체를 한 번에 처리한다.
//
// PRD 4.4절은 "generateObject + Zod 스키마"라고 표현하지만, 이 프로젝트가 쓰는 AI SDK 버전에서는
// generateObject/streamObject가 deprecated이고 generateText({ output: Output.object(...) })가
// 후속 API다(node_modules/ai/docs/03-ai-sdk-core/60-telemetry.mdx 참고). 강제되는 구조·의미는
// 동일하므로 여기서는 최신 API로 구현한다.
import { anthropic } from "@/lib/anthropic";
import { Output } from "ai";
import { z } from "zod";
import { streamStructured, withClaudeGuard } from "./claudeGuard";
import { STAGE1_SYSTEM_PROMPT, STAGE1_IMPROVEMENT_SYSTEM_PROMPT } from "./prompts";

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
  /** true면 문장이 잘렸을 위험이 있어 사람 검토가 필요하다(대조 연결어미로 끝나
   *  자동으로 이어붙이면 다른 극성 내용이 섞일 위험이 있는 경우, 또는 이어붙일
   *  종결 지점을 원문에서 못 찾은 경우). */
  needs_review: boolean;
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

// -지만/-는데류(대조 연결어미, "그런데"에 해당)는 뒤에 반대 뉘앙스·다른 극성의 내용이 이어질
// 위험이 있다(실측 사례, 2026-08-03: "화면 구성도 직관적이라 사용하기 편리했지만" 뒤에 부정적
// 서술이 이어짐 — 자동으로 이어붙이면 긍정 인용문에 부정 내용이 섞인다). 자동 확장하지 않고
// needs_review로만 표시한다.
const CONTRASTIVE_REVIEW_ENDING = /(지만|는데|은데|인데)$/;
// 나열·인과 연결어미(-고/-며/-어서/-니까/-므로 등)는 대체로 같은 맥락·같은 극성이 이어지므로
// 원문에서 다음 종결 지점까지 자동으로 이어붙여도 안전하다.
const COORDINATING_EXTEND_ENDING =
  /(면서|으면서|으며|어서|아서|여서|니까|으니까|므로|으므로|라서|다가|고)$/;
// 관형형 어미·조사로 끝나면 뒤에 명사가 이어져야 완결된다 — 극성 반전 위험이 없어 이어붙여도 안전.
// '가'/'과'처럼 흔한 단어 끝소리와 겹치는 조사는 오탐이 커서 제외한 좁은 집합만 쓴다.
const INCOMPLETE_PHRASE_ENDING = /(을|를|이|은|는|의|에|와|도|만)$/;
// 종결어미·문장부호·의성/의태 표현으로 끝나면 문장이 완결됐다고 본다(위 판정보다 우선 확인).
const SENTENCE_TERMINAL_ENDING =
  /(다|요|음|함|임|됨|짐|네|죠|까|랑|ㅎ+|ㅋ+|!|\?|\.|~|음\)|요\)|다\))$/;

export type ClauseEndingKind = "complete" | "extend" | "review";

/** clause 끝맺음을 분류한다. 규칙 기반, LLM 재호출 없음. */
export function classifyClauseEnding(clause: string): ClauseEndingKind {
  const trimmed = clause.trim();
  if (trimmed.length === 0) return "complete";
  if (SENTENCE_TERMINAL_ENDING.test(trimmed)) return "complete";
  if (CONTRASTIVE_REVIEW_ENDING.test(trimmed)) return "review";
  if (COORDINATING_EXTEND_ENDING.test(trimmed) || INCOMPLETE_PHRASE_ENDING.test(trimmed)) return "extend";
  return "complete";
}

const HARD_SENTENCE_BOUNDARY = /[.!?\n]/;
// 이 길이 안에서 종결 지점을 못 찾으면 이어붙이지 않는다(엉뚱하게 먼 지점까지 끌고 오는 것을 방지).
const MAX_EXTEND_CHARS = 300;

/**
 * clause가 원문에서 끝나는 지점부터 다음 마침표/느낌표/물음표/줄바꿈까지 원문 그대로 이어붙인다.
 * 원문에서 clause를 못 찾거나(정규화 차이 등) 상한 안에 종결 지점이 없으면 null을 반환한다
 * (이 경우 호출부가 needs_review로 표시한다).
 */
export function extendClauseToSentenceBoundary(source: string, clause: string): string | null {
  const startIdx = source.indexOf(clause);
  if (startIdx === -1) return null;
  const endIdx = startIdx + clause.length;
  const rest = source.slice(endIdx, endIdx + MAX_EXTEND_CHARS);
  if (rest.length === 0) return null; // clause가 이미 원문 끝 — 더 이어붙일 내용이 없다
  const boundary = HARD_SENTENCE_BOUNDARY.exec(rest);
  if (boundary) return (clause + rest.slice(0, boundary.index + 1)).trim();
  // 마침표 없이 원문이 그냥 끝나는 경우가 한국어 설문 응답에 흔하다(문장부호 없이 종결어미로만
  // 끝맺는 구어체). rest가 상한(MAX_EXTEND_CHARS)에 걸리지 않고 원문 끝까지 자연히 다 온
  // 것이면(=더 먼 곳까지 끌고 올 위험이 없으면) 남은 전체를 안전하게 이어붙인다.
  if (rest.length < MAX_EXTEND_CHARS) return (clause + rest).trim();
  return null; // 상한 안에 경계도 없고 원문도 안 끝남 — 너무 멀리 끌고 올 위험, review로 넘긴다
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
  let extendedCount = 0;
  let flaggedForReviewCount = 0;
  const results = output.results.map((result) => {
    const source = sourceByRespondent.get(result.respondent_id) ?? "";
    const clauses = result.clauses.map((clause) => {
      let raw_clause = isVerbatimClause(source, clause.clause) ? clause.clause : null;
      let needs_review = false;
      if (raw_clause) {
        const kind = classifyClauseEnding(raw_clause);
        if (kind === "review") {
          needs_review = true;
        } else if (kind === "extend") {
          const extended = extendClauseToSentenceBoundary(source, raw_clause);
          if (extended) {
            raw_clause = extended;
            extendedCount += 1;
          } else {
            needs_review = true;
          }
        }
      }
      if (!raw_clause) unverifiedCount += 1;
      if (needs_review) flaggedForReviewCount += 1;
      return {
        raw_clause,
        analysis_clause: clause.clause,
        polarity: clause.polarity,
        rationale: clause.rationale,
        needs_review,
      };
    });
    return { ...result, clauses };
  });
  if (unverifiedCount > 0) {
    console.warn(`[qualitative] Stage1 retained ${unverifiedCount} clause(s) for analysis but excluded them from direct quotes because raw text could not be verified`);
  }
  if (extendedCount > 0) {
    console.info(`[qualitative] Stage1 extended ${extendedCount} clause(s) to the next sentence boundary in the source text`);
  }
  if (flaggedForReviewCount > 0) {
    console.info(`[qualitative] Stage1 flagged ${flaggedForReviewCount} clause(s) as needs_review (contrastive ending or no safe extension point)`);
  }
  return { results };
}

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
      needs_review: boolean;
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
      let raw_clause = isVerbatimClause(source, clause.clause) ? clause.clause : null;
      let needs_review = false;
      if (raw_clause) {
        const kind = classifyClauseEnding(raw_clause);
        if (kind === "review") {
          needs_review = true;
        } else if (kind === "extend") {
          const extended = extendClauseToSentenceBoundary(source, raw_clause);
          if (extended) raw_clause = extended;
          else needs_review = true;
        }
      }
      if (!raw_clause) unverifiedCount += 1;
      return { raw_clause, analysis_clause: clause.clause, needs_review };
    }),
  }));
  if (unverifiedCount > 0) {
    console.warn(`[qualitative] Stage1 improvement retained ${unverifiedCount} clause(s) for analysis but excluded them from direct quotes because raw text could not be verified`);
  }
  return { results };
}

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
