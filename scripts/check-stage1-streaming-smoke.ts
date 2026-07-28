// Stage1 스트리밍 전환의 최소 실사용 검증.
// 실제 리바랩스 raw data의 표준 주관식 문항 **하나만** 보내며, Stage2·극성 요약·전체
// 파이프라인은 실행하지 않는다. 사용법: npm run check:stage1-stream
// 주의: Anthropic API 1회 호출이 발생한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { isVerbatimClause, runStage1 } from "../lib/pipeline/stage1";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";

const rawDataUrl = new URL(
  "../data/[리바랩스]사용성테스트 raw data.xlsx",
  import.meta.url,
);
const resultPath = join(process.cwd(), "tmp", "stage1-streaming-smoke-latest.json");

function writeRunState(state: Record<string, unknown>) {
  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`);
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
  const question = buildQuestionSpecs(records).find((spec) => spec.kind === "standard");
  if (!question || question.kind !== "standard") {
    throw new Error("검증할 표준 주관식 문항을 찾지 못했습니다.");
  }

  console.info(
    `[smoke] Stage1 스트리밍 단일 호출 시작 — ${question.label}, 응답 ${question.inputs.length}명`,
  );
  writeRunState({ status: "started", question: question.label, apiCalls: 1, respondentsSent: question.inputs.length });
  const startedAt = Date.now();
  let result;
  // AI SDK 스트림은 첫 청크 뒤 내부 fetch 핸들이 unref될 수 있어, CLI 실행기만 Promise를
  // 기다리지 못하고 종료되는 경우가 있다. 실제 Next.js 서버 경로에는 필요 없으며, 이 단일
  // 검증 스크립트에서만 결과·사용량 로그를 끝까지 받기 위한 keep-alive다.
  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    result = await runStage1({
      questionLabel: question.label,
      inputs: question.inputs,
    });
  } catch (error) {
    writeRunState({
      status: "failed",
      question: question.label,
      apiCalls: 1,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
  const elapsedMs = Date.now() - startedAt;

  const inputByRespondent = new Map(question.inputs.map((input) => [input.respondent_id, input.reason]));
  const missingRespondents = question.inputs.filter(
    (input) => !result.results.some((entry) => entry.respondent_id === input.respondent_id),
  );
  const clauses = result.results.flatMap((entry) =>
    entry.clauses.map((clause) => ({ respondentId: entry.respondent_id, clause })),
  );
  const unverifiedRawClauses = clauses.filter(({ respondentId, clause }) => {
    const source = inputByRespondent.get(respondentId) ?? "";
    return clause.raw_clause === null || !isVerbatimClause(source, clause.raw_clause);
  });

  const summary = {
    event: "stage1_streaming_smoke_complete",
    status: "completed",
    question: question.label,
    apiCalls: 1,
    respondentsSent: question.inputs.length,
    respondentsReturned: result.results.length,
    missingRespondents: missingRespondents.length,
    clausesReturned: clauses.length,
    unverifiedRawClauses: unverifiedRawClauses.length,
    // 분석은 보존하되 직접 인용에서 제외된 사례만 최소 추적한다.
    unverifiedExamples: unverifiedRawClauses.slice(0, 5).map(({ respondentId, clause }) => ({
      respondentId,
      analysisClause: clause.analysis_clause,
    })),
    elapsedMs,
  };
  writeRunState(summary);
  console.info(JSON.stringify(summary, null, 2));

  if (missingRespondents.length > 0) {
    process.exitCode = 1;
  }
}

// 이 스크립트는 CommonJS로 실행되므로 top-level await를 쓸 수 없다. 실행기 전체에
// ref된 타이머를 두고, main Promise가 종료될 때만 해제해 스트림 완료 전 프로세스가
// 종료되는 일을 방지한다.
const entryKeepAlive = setInterval(() => undefined, 1_000);
void main()
  .catch((error) => {
    console.error("[smoke] Stage1 스트리밍 검증 실패", error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(entryKeepAlive));
