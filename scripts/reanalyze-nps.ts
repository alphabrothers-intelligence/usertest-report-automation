/**
 * 저장된 보고서의 NPS 문항만 고속 정성 분석으로 다시 생성한다.
 *
 * 사용법:
 *   REPORT_ID=<보고서 UUID> npm run analyze:nps
 *
 * 전체 14문항 작업 큐를 만들지 않으며 Claude 호출은 정확히 1회다.
 * 출력에는 원문 응답 전문을 남기지 않고, NPS 판단문과 처리 결과만 tmp에 기록한다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveQualitativeQuestionResult } from "../lib/db/reports";
import { runFastReportAnalysis } from "../lib/pipeline/fastReportAnalysis";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { normalizeWallaRows } from "../lib/walla/normalize";

const reportId = process.env.REPORT_ID ?? "";
if (!reportId) throw new Error("REPORT_ID 환경변수가 필요합니다.");

const rawPath = process.env.QUALITATIVE_RAW_DATA_PATH
  ?? join(process.cwd(), "data", "[리바랩스]사용성테스트 raw data.xlsx");
const artifactPath = join(process.cwd(), "tmp", "nps-reanalysis-latest.json");

function writeArtifact(payload: Record<string, unknown>) {
  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(
    artifactPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const buffer = readFileSync(rawPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const parsed = parseWallaWorkbook(arrayBuffer);
  const validation = validateWallaHeaderRow(parsed.headerRow);
  if (!validation.valid) throw new Error(`raw data 헤더 검증 실패: ${validation.errors.join(", ")}`);

  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const npsQuestion = buildQuestionSpecs(records).find((spec) => spec.id === "nps");
  if (!npsQuestion || npsQuestion.kind !== "standard") throw new Error("NPS 문항을 찾지 못했습니다.");

  const startedAt = Date.now();
  writeArtifact({
    status: "started",
    reportId,
    questionKey: npsQuestion.id,
    questionLabel: npsQuestion.label,
    apiCalls: 1,
    respondentCount: npsQuestion.inputs.length,
  });

  try {
    const result = await runFastReportAnalysis(npsQuestion);
    if (result.kind !== "standard") throw new Error("NPS 문항 결과 형식이 올바르지 않습니다.");
    if (!result.npsJudgment || result.npsJudgment.lines.length !== 3) {
      throw new Error("NPS 판단문 3개를 생성하지 못했습니다.");
    }

    await saveQualitativeQuestionResult(reportId, result);
    writeArtifact({
      status: "completed",
      reportId,
      questionKey: result.id,
      apiCalls: 1,
      elapsedMs: Date.now() - startedAt,
      npsJudgment: result.npsJudgment,
      polarityGroups: Object.fromEntries(
        Object.entries(result.stage2ByPolarity).map(([polarity, group]) => [polarity, group?.categories.length ?? 0]),
      ),
    });
    console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - startedAt, npsJudgment: result.npsJudgment }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeArtifact({ status: "failed", reportId, questionKey: npsQuestion.id, apiCalls: 1, elapsedMs: Date.now() - startedAt, error: message });
    throw error;
  }
}

void main();
