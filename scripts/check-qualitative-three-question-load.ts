// 스트리밍 정성 파이프라인의 제한된 병렬 부하 검증.
// 기본값은 실제 raw data의 첫 3개 기능 문항만 동시성 5로 실행한다.
// 환경변수로 1문항 사전 검증에도 재사용할 수 있다.
// Stage1/Stage2 모두 포함하지만 전체 14문항 실행 전 안정성 확인용이다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { estimateQualitativeCallPlan, runQualitativePipeline } from "../lib/pipeline/orchestrate";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";

const rawDataUrl = new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url);
const resultPath = join(process.cwd(), "tmp", "qualitative-three-question-load-latest.json");
const CONCURRENCY = Number(process.env.QUALITATIVE_TEST_CONCURRENCY ?? 5);
const QUESTION_COUNT = Number(process.env.QUALITATIVE_TEST_QUESTION_COUNT ?? 3);
const PLAN_ONLY = process.env.QUALITATIVE_TEST_PLAN_ONLY === "1";
let runCompleted = false;

function writeRunState(state: Record<string, unknown>) {
  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(
    resultPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`,
  );
}

async function main() {
  const buffer = readFileSync(rawDataUrl);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  const parsed = parseWallaWorkbook(arrayBuffer);
  const validation = validateWallaHeaderRow(parsed.headerRow);
  if (!validation.valid) {
    throw new Error(`raw data 헤더 검증 실패: ${validation.errors.join(", ")}`);
  }

  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const specs = buildQuestionSpecs(records)
    .filter((spec) => spec.kind === "standard")
    .slice(0, QUESTION_COUNT);
  if (specs.length !== QUESTION_COUNT) {
    throw new Error(`부하 검증 문항 ${QUESTION_COUNT}개를 구성하지 못했습니다.`);
  }

  const plan = estimateQualitativeCallPlan(specs);
  if (PLAN_ONLY) {
    const summary = {
      event: "qualitative_load_plan",
      status: "planned",
      concurrency: CONCURRENCY,
      questionLabels: specs.map((spec) => spec.label),
      callPlan: plan,
    };
    writeRunState(summary);
    console.info(JSON.stringify(summary, null, 2));
    return;
  }
  writeRunState({
    status: "started",
    concurrency: CONCURRENCY,
    questionLabels: specs.map((spec) => spec.label),
    callPlan: plan,
  });
  console.info(
    `[load] ${specs.length}문항·동시성 ${CONCURRENCY} 시작 — 최대 ${plan.maxTotalCalls}회 호출`,
  );

  const startedAt = Date.now();
  try {
    const result = await runQualitativePipeline(specs, { concurrency: CONCURRENCY });
    const summary = {
      event: "qualitative_three_question_load_complete",
      status: result.failedQuestionCount === 0 ? "completed" : "completed_with_failures",
      concurrency: CONCURRENCY,
      questionLabels: specs.map((spec) => spec.label),
      callPlan: plan,
      completedQuestions: result.questions.map((question) => ({
        id: question.id,
        label: question.label,
        kind: question.kind,
        ...(question.kind === "standard"
          ? {
              clauses: question.clauses.length,
              stage2Polarities: Object.keys(question.stage2ByPolarity),
              stage2Failures: question.stage2Failures,
            }
          : { majorCategories: question.stage2.major_categories.length, subcategories: question.stage2.major_categories.reduce((s, m) => s + m.subcategories.length, 0) }),
      })),
      failedQuestionCount: result.failedQuestionCount,
      failedQuestions: result.failedQuestions,
      elapsedMs: Date.now() - startedAt,
    };
    writeRunState(summary);
    console.info(JSON.stringify(summary, null, 2));
    if (result.failedQuestionCount > 0) process.exitCode = 1;
  } catch (error) {
    writeRunState({
      status: "failed",
      concurrency: CONCURRENCY,
      questionLabels: specs.map((spec) => spec.label),
      callPlan: plan,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// CommonJS CLI에서 스트림 완료 전 프로세스가 먼저 종료되지 않도록 ref된 타이머를 유지한다.
const entryKeepAlive = setInterval(() => undefined, 1_000);
process.on("beforeExit", (code) => {
  if (!runCompleted) {
    writeRunState({
      status: "exited_before_completion",
      exitCode: code,
      concurrency: CONCURRENCY,
      questionCount: QUESTION_COUNT,
      message: "정성 분석 완료 결과가 기록되기 전에 Node 프로세스가 종료되었습니다.",
    });
  }
});
void main()
  .catch((error) => {
    console.error("[load] 3문항 정성 분석 부하 검증 실패", error);
    process.exitCode = 1;
  })
  .finally(() => {
    runCompleted = true;
    clearInterval(entryKeepAlive);
  });
