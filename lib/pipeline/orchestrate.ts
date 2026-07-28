// 14개 문항 × Stage1/Stage2 병렬 처리 오케스트레이터 (PRD 4.2절 — 필수 요구사항).
// 절대 순차 처리하지 않는다: 문항 간 Stage1은 서로 독립적으로 동시 실행하고, 각 문항의
// Stage1이 끝나면 그 문항의 극성별 Stage2도 문항 간 동시 실행한다. 동시성은 p-limit으로
// 5~10개로 제한한다(Claude API 레이트리밋 고려, 10장).
//
// **극성별 총평("[긍정 의견 요약]" 박스)은 여기 없다 — 의도적이다(2026-07-21).** 처음엔 Stage2
// 직후 같은 흐름 안에서 호출했는데, 실사용 중 그 호출 하나가 응답 없이 걸려 14문항 전체가
// 15분 넘게 멈추는 사고가 났다. 타임아웃(60초)과 개별 실패 격리(try/catch)를 넣어 "멈추는"
// 문제는 막았지만, 그 다음 "왜 이렇게 느린가"를 밝히려고 동시성을 늘리는 실험(14로 상향)과
// 문항 내부를 청크로 쪼개 병렬화하는 실험을 각각 돌려봤는데 — 둘 다 오히려 타임아웃이 대량
// 발생했다(21분간 27건 전부 실패 / 33분간 18건+ 계속 증가). 두 실험의 공통점은 "API 호출
// 개수를 늘리는 방향"이었다는 것 — 결론은 원래 안정적으로 잘 돌던 Stage1+Stage2 파이프라인
// 위에 극성 요약(문항당 최대 3회 호출 추가, 14문항이면 최대 42회)을 얹은 것 자체가 레이트리밋을
// 넘겨버렸다는 것이었다. 그래서 극성 요약은 이 기본 파이프라인에서 완전히 빼고, 사용자가
// 명시적으로 요청할 때만 별도로 실행되는 기능으로 분리했다 — lib/pipeline/polaritySummary.ts
// (개별 호출 함수)와 lib/pipeline/generatePolaritySummaries.ts(리포트 단위 오케스트레이션,
// app/api/chat/route.ts의 generatePolaritySummaries 도구가 호출) 참고.
import pLimit from "p-limit";
import type { QuestionSpec } from "./questions";
import { runStage1, runStage1ImprovementIdea, type Polarity } from "./stage1";
import {
  runStage2AllPolarities,
  runStage2ImprovementIdea,
  type Stage2ClauseInput,
  type Stage2Output,
  type Stage2ImprovementOutput,
} from "./stage2";
import { scoreConfidence, type ConfidenceLevel } from "./confidence";
import { runFastReportAnalysis } from "./fastReportAnalysis";

// 크레딧·레이트리밋 상태가 불명확한 기본 환경에서는 보수적 동시성으로 시작한다.
// 실제 측정 후 PIPELINE_CONCURRENCY로만 올린다; 코드에서 임의로 상향하지 않는다.
const DEFAULT_CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 3);
// 일반 보고서 생성은 카테고리·인용·인사이트만 필요한 고속 경로를 기본으로 쓴다.
// 절 단위 극성 검수까지 필요한 감사 작업은 QUALITATIVE_ANALYSIS_MODE=detailed로 명시한다.
export const QUALITATIVE_ANALYSIS_MODE = process.env.QUALITATIVE_ANALYSIS_MODE === "detailed" ? "detailed" : "fast";
// 0은 무제한이 아니라 안전 모드 해제를 명시적으로 뜻하게 하지 않는다. $11처럼 잔액이 적은
// 환경에서 무심코 전체 파이프라인을 실행하지 않도록 기본 예산은 20회로 막는다.
export const QUALITATIVE_MAX_CLAUDE_CALLS = Number(process.env.QUALITATIVE_MAX_CLAUDE_CALLS ?? 20);
// 모델별 실제 단가는 변동될 수 있으므로 운영 환경에서 반드시 갱신 가능한 환경변수로 둔다.
// 기본값은 비용을 "보수적으로 미리 막기" 위한 Sonnet 계열의 입력/출력 단가 가정이며, 청구서
// 확정값은 아니다. 사용자는 estimateQualitativeAnalysis 카드에서 이 전제를 함께 확인한다.
const INPUT_USD_PER_MTOKENS = Number(process.env.QUALITATIVE_INPUT_USD_PER_MTOKENS ?? 3);
const OUTPUT_USD_PER_MTOKENS = Number(process.env.QUALITATIVE_OUTPUT_USD_PER_MTOKENS ?? 15);
export const QUALITATIVE_MAX_ESTIMATED_USD = Number(process.env.QUALITATIVE_MAX_ESTIMATED_USD ?? 2);

export interface FlaggedClause {
  respondent_id: number;
  /** 맞춤법·띄어쓰기 보정이 가능한 분석용 문장 */
  clause: string;
  /** 원본 응답과 대조된 직접 인용 후보. null은 인용 불가를 뜻한다. */
  raw_clause: string | null;
  polarity: Polarity;
  rationale: string;
  confidence: ConfidenceLevel;
}

export interface StandardQuestionResult {
  id: string;
  label: string;
  kind: "standard";
  clauses: FlaggedClause[];
  stage2ByPolarity: Partial<Record<Polarity, Stage2Output>>;
  stage2Failures: string[];
}

export interface ImprovementQuestionResult {
  id: string;
  label: string;
  kind: "improvement";
  stage2: Stage2ImprovementOutput;
}

export interface FailedQuestionResult {
  id: string;
  label: string;
  kind: "standard" | "improvement";
  failed: true;
  error: string;
}

export type QuestionResult = StandardQuestionResult | ImprovementQuestionResult;

export interface PipelineResult {
  questions: QuestionResult[];
  elapsedMs: number;
  failedQuestionCount: number;
  failedQuestions: FailedQuestionResult[];
}

export interface QualitativeCallPlan {
  mode: "fast" | "detailed";
  stage1Calls: number;
  stage2MaxCalls: number;
  maxTotalCalls: number;
  inputCharacters: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  costAssumption: {
    inputUsdPerMTokens: number;
    outputUsdPerMTokens: number;
  };
}

/** API를 전혀 호출하지 않고, 이번 raw data 분석의 최악 호출 수와 입력 크기를 계산한다. */
export function estimateQualitativeCallPlan(specs: QuestionSpec[]): QualitativeCallPlan {
  const standardQuestions = specs.filter((spec) => spec.kind === "standard");
  const improvementQuestions = specs.filter((spec) => spec.kind === "improvement");
  const stage1Calls = specs.length;
  // 고속 Stage2는 표준 문항의 긍/부정/중립을 한 번에 처리한다. 개선 아이디어도 1회다.
  const stage2MaxCalls = QUALITATIVE_ANALYSIS_MODE === "detailed"
    ? standardQuestions.length + improvementQuestions.length
    : 0;
  const inputCharacters = specs.reduce((sum, spec) => sum + JSON.stringify(spec.inputs).length, 0);
  // 리바랩스 3문항 실측(2026-07-27)에서 입력 원문 45,676자에 총 122,719 입력/
  // 91,561 출력 토큰이 발생했다. 고속 Stage2 통합 후에는 반복 프롬프트가 줄어들므로
  // 입력은 원문 대비 2.4배, 출력은 2.0배를 보수적 상한으로 둔다. 실제 인보이스는
  // Anthropic 프롬프트 캐시·모델별 단가에 따라 달라지므로 화면에는 예상 상한만 표시한다.
  const estimatedInputTokens = Math.ceil(inputCharacters * (QUALITATIVE_ANALYSIS_MODE === "detailed" ? 2.4 : 1.15) + stage2MaxCalls * 500);
  const estimatedOutputTokens = Math.ceil(inputCharacters * (QUALITATIVE_ANALYSIS_MODE === "detailed" ? 2.0 : 0.35));
  const estimatedCostUsd = Number(((estimatedInputTokens / 1_000_000) * INPUT_USD_PER_MTOKENS + (estimatedOutputTokens / 1_000_000) * OUTPUT_USD_PER_MTOKENS).toFixed(3));
  return {
    mode: QUALITATIVE_ANALYSIS_MODE,
    stage1Calls,
    stage2MaxCalls,
    maxTotalCalls: stage1Calls + stage2MaxCalls,
    inputCharacters,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    costAssumption: { inputUsdPerMTokens: INPUT_USD_PER_MTOKENS, outputUsdPerMTokens: OUTPUT_USD_PER_MTOKENS },
  };
}

function groupByPolarity(clauses: FlaggedClause[]): Partial<Record<Polarity, Stage2ClauseInput[]>> {
  const groups: Partial<Record<Polarity, Stage2ClauseInput[]>> = {};
  for (const c of clauses) {
    const arr = groups[c.polarity] ?? (groups[c.polarity] = []);
    arr.push({
      respondent_id: c.respondent_id,
      analysis_clause: c.clause,
      quote_verified: c.raw_clause !== null,
      ...(c.raw_clause && c.raw_clause !== c.clause ? { raw_clause: c.raw_clause } : {}),
    });
  }
  return groups;
}

/** 작업 큐가 Stage1과 Stage2를 서로 다른 서버리스 요청으로 실행할 때 저장하는 중간 산출물. */
export type QualitativeStage1Checkpoint =
  | { mode: "fast"; result: QuestionResult }
  | { id: string; label: string; kind: "standard"; clauses: FlaggedClause[] }
  | { id: string; label: string; kind: "improvement"; clauses: Stage2ClauseInput[] };

/**
 * Stage1만 실행한다. 대형 응답을 받는 가장 긴 단계이므로, 작업 큐에서는 이 함수 하나를
 * 단일 요청으로 실행하고 결과를 체크포인트로 저장한다.
 */
export async function runQualitativeStage1(spec: QuestionSpec): Promise<QualitativeStage1Checkpoint> {
  if (QUALITATIVE_ANALYSIS_MODE === "fast") {
    return { mode: "fast", result: await runFastReportAnalysis(spec) };
  }
  if (spec.kind === "improvement") {
    const stage1 = await runStage1ImprovementIdea({ questionLabel: spec.label, inputs: spec.inputs });
    return {
      id: spec.id,
      label: spec.label,
      kind: "improvement",
      clauses: stage1.results.flatMap((r) => r.clauses.map((c) => ({
        respondent_id: r.respondent_id,
        analysis_clause: c.analysis_clause,
        quote_verified: c.raw_clause !== null,
        ...(c.raw_clause && c.raw_clause !== c.analysis_clause ? { raw_clause: c.raw_clause } : {}),
      }))),
    };
  }
  const stage1 = await runStage1({ questionLabel: spec.label, inputs: spec.inputs });
  return {
    id: spec.id,
    label: spec.label,
    kind: "standard",
    clauses: stage1.results.flatMap((r) => r.clauses.map((c) => ({
      respondent_id: r.respondent_id,
      clause: c.analysis_clause,
      raw_clause: c.raw_clause,
      polarity: c.polarity,
      rationale: c.rationale,
      confidence: scoreConfidence(c),
    }))),
  };
}

/** Stage1 체크포인트만 받아 카테고리·인용·인사이트를 만든다. */
export async function runQualitativeStage2(checkpoint: QualitativeStage1Checkpoint): Promise<QuestionResult> {
  if ("result" in checkpoint) return checkpoint.result;
  if (checkpoint.kind === "improvement") {
    const stage2 = await runStage2ImprovementIdea({ questionLabel: checkpoint.label, clauses: checkpoint.clauses });
    return { id: checkpoint.id, label: checkpoint.label, kind: "improvement", stage2 };
  }
  const stage2ByPolarity = await runStage2AllPolarities({
    questionLabel: checkpoint.label,
    groups: groupByPolarity(checkpoint.clauses),
  });
  return {
    id: checkpoint.id,
    label: checkpoint.label,
    kind: "standard",
    clauses: checkpoint.clauses,
    stage2ByPolarity,
    stage2Failures: [],
  };
}

/** 기존 일괄 실행기 호환용 조합 함수. 새 작업 큐는 위 두 함수를 별도 요청으로 쓴다. */
export async function runQualitativeQuestion(spec: QuestionSpec): Promise<QuestionResult | FailedQuestionResult> {
  try {
    const checkpoint = await runQualitativeStage1(spec);
    try {
      return await runQualitativeStage2(checkpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 고속 경로의 Stage2는 저장을 위한 no-op이므로 여기까지 오지 않는다. 방어적으로
      // 기존 결과를 반환해, 타입 분기와 재시도 정책을 상세 경로와 섞지 않는다.
      if ("result" in checkpoint) return checkpoint.result;
      if (checkpoint.kind === "improvement") {
        return { id: checkpoint.id, label: checkpoint.label, kind: "improvement", failed: true, error: message };
      }
      console.error(`[qualitative] Stage2 failed for ${checkpoint.label}:`, error);
      return { id: checkpoint.id, label: checkpoint.label, kind: "standard", clauses: checkpoint.clauses, stage2ByPolarity: {}, stage2Failures: [message] };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[qualitative] question failed for ${spec.label}:`, error);
    return { id: spec.id, label: spec.label, kind: spec.kind, failed: true, error: message };
  }
}

export async function runQualitativePipeline(
  specs: QuestionSpec[],
  {
    concurrency = DEFAULT_CONCURRENCY,
    onQuestionComplete,
  }: {
    concurrency?: number;
    /** 문항 단위 체크포인트. 실패한 문항도 전달해 실행 상태를 남길 수 있다. */
    onQuestionComplete?: (result: QuestionResult | FailedQuestionResult) => Promise<void> | void;
  } = {},
): Promise<PipelineResult> {
  const callPlan = estimateQualitativeCallPlan(specs);
  if (callPlan.maxTotalCalls > QUALITATIVE_MAX_CLAUDE_CALLS) {
    console.warn(JSON.stringify({ event: "qualitative_safety_blocked", reason: "call_limit", ...callPlan, allowedCalls: QUALITATIVE_MAX_CLAUDE_CALLS }));
    throw new Error(
      "현재 정성 분석을 시작할 수 없습니다. 관리자 설정 확인이 필요합니다.",
    );
  }
  if (callPlan.estimatedCostUsd > QUALITATIVE_MAX_ESTIMATED_USD) {
    console.warn(JSON.stringify({ event: "qualitative_safety_blocked", reason: "estimated_budget", ...callPlan, allowedEstimatedUsd: QUALITATIVE_MAX_ESTIMATED_USD }));
    throw new Error(
      "현재 정성 분석을 시작할 수 없습니다. 관리자 설정 확인이 필요합니다.",
    );
  }
  const start = Date.now();
  // Stage2 호출을 Stage1과 같은 limit 인스턴스 안에서 큐잉하면, limit이 Stage1 작업으로
  // 꽉 찬 상태에서 그 안의 Stage2 호출이 슬롯을 얻지 못해 교착 상태에 빠질 수 있다
  // (p-limit 공식 문서의 "중첩 사용 금지" 경고). 두 단계는 별도 limiter를 쓴다.
  const questionLimit = pLimit(concurrency);
  const allResults = await Promise.all(specs.map((spec) => questionLimit(async () => {
    const result = await runQualitativeQuestion(spec);
    // 저장 실패가 분석 결과 자체를 폐기하지 않도록, 체크포인트 오류는 별도 로그로만 남긴다.
    // 호출자는 후속 재시도 정책을 가질 수 있다.
    try {
      await onQuestionComplete?.(result);
    } catch (error) {
      console.error(`[qualitative] checkpoint failed for ${spec.label}:`, error);
    }
    return result;
  })));
  const failedQuestions = allResults.filter(
    (question): question is FailedQuestionResult => "failed" in question && question.failed,
  );
  const questions = allResults.filter(
    (question): question is QuestionResult => !("failed" in question && question.failed),
  );

  return {
    questions,
    elapsedMs: Date.now() - start,
    failedQuestionCount: failedQuestions.length,
    failedQuestions,
  };
}
