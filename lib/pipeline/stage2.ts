// Stage 2 — 극성별 카테고리 클러스터링 + 대표인용 + 인사이트 초안 (PRD 6.3절).
// label·quotes는 Tier 1(자동 확정), insight는 Tier 2(AI 초안 + 체크포인트 B 필수 편집, 7.2절).
import { anthropic } from "@ai-sdk/anthropic";
import { Output } from "ai";
import { z } from "zod";
import type { Polarity } from "./stage1";
import { streamStructured, withClaudeGuard } from "./claudeGuard";
import { STAGE2_SYSTEM_PROMPT, STAGE2_COMBINED_SYSTEM_PROMPT, STAGE2_IMPROVEMENT_SYSTEM_PROMPT } from "./prompts";

const STAGE2_MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

/** 인용문 안에서 근거/이유 구간을 별도로 지목하는 병렬 필드. quotes 자체(verbatim 안전장치
 * 기준)는 절대 건드리지 않고, 표시용 볼드+밑줄 마킹은 stage2.ts 후처리(buildQuoteDisplayText)가
 * 코드로만 스플라이스한다 — LLM이 직접 마크다운을 인용문에 써넣지 않는다. */
export const QuoteEvidenceSchema = z.object({
  quote: z.string().describe("quotes 배열의 인용문과 정확히 같은 문자열"),
  reasonSpan: z
    .string()
    .describe("quote 안에서 근거·이유에 해당하는 연속된 부분 문자열. 원문 그대로, 새로 쓰거나 요약하지 않음"),
});

export const CategorySchema = z.object({
  label: z.string().describe("대괄호 없이 카테고리명만 (예: GPS 및 걸음 수 측정 부정확성 문제)"),
  clause_count: z
    .number()
    .describe("이 카테고리에 속하는 전체 clause 개수 — quotes에 포함 안 된 것도 포함"),
  quotes: z.array(z.string()).describe("입력 raw_clause 원문 중에서만 verbatim으로 선택한 대표 인용 2~4개"),
  quoteEvidence: z
    .array(QuoteEvidenceSchema)
    .default([])
    .describe("quotes 각각에 대해 근거/이유 구간을 지목 — 위치 표시용"),
  insight: z.string().describe("관찰·시사점 톤의 인사이트 한 줄. 화살표 기호는 붙이지 않음"),
});

export const Stage2OutputSchema = z.object({
  polarity: z.enum(["positive", "negative", "neutral"]),
  total_clause_count: z.number(),
  categories: z.array(CategorySchema),
});

/** LLM이 그대로 뱉은 원본 파싱 결과(quoteEvidence 포함, quotesDisplay 없음) — 인용 검증
 * 직전까지만 쓴다. */
export type Stage2RawOutput = z.infer<typeof Stage2OutputSchema>;

/** 인용 검증(retainOnlyVerifiedQuotes) 이후의 최종 형태. quoteEvidence는 buildQuoteDisplayText가
 * 소비하고 나면 더 필요 없어 제거하고, 표시용 quotesDisplay를 대신 채운다. */
export type Stage2Output = Omit<Stage2RawOutput, "categories"> & {
  categories: (Omit<Stage2RawOutput["categories"][number], "quoteEvidence"> & { quotesDisplay: string[] })[];
};

/** NPS 문항에만 함께 생성하는 원본 NPS 결과표 하단의 3개 판단문. */
export const NpsJudgmentSchema = z.object({
  // groups와 별개의 선택 필드로 둬 기존 문항별 카테고리 구조를 바꾸지 않는다.
  lines: z.array(z.string()).length(3).describe("NPS 결과표 아래 판단문 3개. 화살표 기호는 넣지 않음"),
});

export type NpsJudgment = z.infer<typeof NpsJudgmentSchema>;

/**
 * 고속 경로용 묶음 출력. 기존에는 같은 문항의 긍정·부정·중립을 각각 호출했지만,
 * 이 구조는 세 극성을 한 번의 구조화 응답으로 돌려 반복 프롬프트와 대기열을 제거한다.
 */
export const Stage2CombinedOutputSchema = z.object({
  groups: z.array(Stage2OutputSchema),
  // NPS가 아닌 문항에서는 생략한다. 기존 상세 경로와 저장 데이터는 영향받지 않는다.
  nps_judgment: NpsJudgmentSchema.optional(),
});
type Stage2CombinedOutput = z.infer<typeof Stage2CombinedOutputSchema>;

const POLARITY_KR: Record<Polarity, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

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
  output: Stage2RawOutput,
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
 * quoteEvidence가 지목한 reasonSpan이 실제로 quote의 부분 문자열일 때만 볼드+밑줄 마커를
 * 스플라이스한 표시용 문자열을 만든다. 마킹은 코드가 하고 LLM은 위치만 지목하므로 verbatim
 * 검증(quotes 원본)과 완전히 분리된다. 일치하는 항목이 없으면 원본 quote를 그대로 쓴다.
 */
export function buildQuoteDisplayText(
  quote: string,
  evidence: { quote: string; reasonSpan: string }[],
): string {
  const match = evidence.find((e) => e.quote === quote && e.reasonSpan && quote.includes(e.reasonSpan));
  if (!match) return quote;
  return quote.replace(match.reasonSpan, `**__${match.reasonSpan}__**`);
}

/**
 * 모델 지시를 한 번 더 강제한다. 분석용 보정 문장이나 모델이 새로 만든 문장이 직접 인용으로
 * 저장되는 것을 막되, 카테고리·건수·인사이트(분석 결과)는 유지한다. 검증을 통과한 quote마다
 * quoteEvidence를 근거로 표시용 quotesDisplay도 함께 만든다.
 */
function retainOnlyVerifiedQuotes(output: Stage2RawOutput, clauses: Stage2ClauseInput[]): Stage2Output {
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
    const quotesDisplay = quotes.map((quote) => buildQuoteDisplayText(quote, category.quoteEvidence));
    const { quoteEvidence: _quoteEvidence, ...rest } = category;
    return { ...rest, quotes, quotesDisplay };
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
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage2RawOutput>({
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

// PRD 6.6절 — 개선아이디어는 극성 구분 없이 카테고리화만 수행한다.
// **2026-07-30 사용자 지시로 원본 보고서(리바랩스 45~49쪽) 대조에 맞춰 2단 구조로 재설계.**
// 원본 "개선 아이디어 > 주요 의견 종합"은 [대분류] → <소분류> → 원문 인용 다수의 2단 계층이며,
// 인사이트(요약 한 줄)가 없다(순수 인용 taxonomy). 예전 1단 평면 구조(카테고리+인용3~4+인사이트)는
// 원본과 형식·분량이 크게 달라 이 구조로 바꿨다. flat categories 테이블 저장을 위해
// 저장 시 label을 "대분류소분류"로 인코딩한다(reports.ts) — decodeImprovementLabel 참고.
export const Stage2ImprovementSubcategorySchema = z.object({
  label: z.string().describe("소분류명 — 홑화살괄호 없이 이름만 (예: 설명 부족)"),
  clause_count: z.number().describe("이 소분류에 속하는 전체 clause 개수"),
  quotes: z.array(z.string()).describe("이 소분류에 속하는 verbatim 인용 2~6개(가능한 많이, 원문 그대로)"),
  quoteEvidence: z
    .array(QuoteEvidenceSchema)
    .default([])
    .describe("quotes 각각에 대해 근거/이유 구간을 지목 — 위치 표시용"),
});
export const Stage2ImprovementMajorSchema = z.object({
  label: z.string().describe("대분류명 — 대괄호 없이 이름만 (예: 튜토리얼/가이드 고도화)"),
  subcategories: z.array(Stage2ImprovementSubcategorySchema),
});
export const Stage2ImprovementOutputSchema = z.object({
  total_clause_count: z.number(),
  major_categories: z.array(Stage2ImprovementMajorSchema),
});

/** LLM 원본 파싱 결과(quoteEvidence 포함, quotesDisplay 없음). */
export type Stage2ImprovementRawOutput = z.infer<typeof Stage2ImprovementOutputSchema>;

/** 인용 검증(retainVerifiedImprovementQuotes) 이후의 최종 형태 — Stage2Output과 같은 원칙. */
export type Stage2ImprovementOutput = Omit<Stage2ImprovementRawOutput, "major_categories"> & {
  major_categories: (Omit<Stage2ImprovementRawOutput["major_categories"][number], "subcategories"> & {
    subcategories: (Omit<
      Stage2ImprovementRawOutput["major_categories"][number]["subcategories"][number],
      "quoteEvidence"
    > & { quotesDisplay: string[] })[];
  })[];
};

/** 저장 시 flat categories.label에 두 계층을 인코딩하는 구분자(유닛 세퍼레이터 — 본문에 안 나옴). */
export const IMPROVEMENT_LABEL_SEP = "";
export function encodeImprovementLabel(major: string, sub: string): string {
  return `${major}${IMPROVEMENT_LABEL_SEP}${sub}`;
}
export function decodeImprovementLabel(label: string): { major: string; sub: string } {
  const idx = label.indexOf(IMPROVEMENT_LABEL_SEP);
  return idx >= 0 ? { major: label.slice(0, idx), sub: label.slice(idx + 1) } : { major: "", sub: label };
}
/** 개선아이디어 2단 출력에서 verify 안 된 인용만 제거한다(각 소분류의 quotes 대상). 검증을 통과한
 * quote마다 quoteEvidence를 근거로 표시용 quotesDisplay도 함께 만든다. */
function retainVerifiedImprovementQuotes(
  output: Stage2ImprovementRawOutput,
  clauses: Stage2ClauseInput[],
): Stage2ImprovementOutput {
  const approvedQuotes = new Set(
    clauses.flatMap((clause) => {
      const candidate = quoteCandidate(clause);
      return candidate ? [candidate] : [];
    }),
  );
  let removedCount = 0;
  const major_categories = output.major_categories.map((major) => ({
    ...major,
    subcategories: major.subcategories.map((sub) => {
      const quotes = sub.quotes.filter((quote) => {
        const allowed = approvedQuotes.has(quote);
        if (!allowed) removedCount += 1;
        return allowed;
      });
      const quotesDisplay = quotes.map((quote) => buildQuoteDisplayText(quote, sub.quoteEvidence));
      const { quoteEvidence: _quoteEvidence, ...rest } = sub;
      return { ...rest, quotes, quotesDisplay };
    }),
  }));
  if (removedCount > 0) {
    console.warn(`[qualitative] Stage2 improvement removed ${removedCount} quote(s) that did not exactly match verified raw text`);
  }
  return { ...output, major_categories };
}

export async function runStage2ImprovementIdea({
  questionLabel,
  clauses,
}: {
  questionLabel: string;
  clauses: Stage2ClauseInput[];
}): Promise<Stage2ImprovementOutput> {
  const traceLabel = `stage2-improvement:${questionLabel}`;
  const { output } = await withClaudeGuard(traceLabel, () => streamStructured<Stage2ImprovementRawOutput>({
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

  return retainVerifiedImprovementQuotes(output, clauses);
}
