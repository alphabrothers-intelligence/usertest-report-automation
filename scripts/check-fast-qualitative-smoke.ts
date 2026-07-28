// 보고서용 고속 정성 분석의 최소 실사용 검증.
// 실제 리바랩스 raw data의 표준 문항 하나만 호출한다. 14문항 전체·상세 감사 경로는 실행하지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runFastReportAnalysis } from "../lib/pipeline/fastReportAnalysis";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";

const rawDataUrl = new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url);
const resultPath = join(process.cwd(), "tmp", "fast-qualitative-smoke-latest.json");

function writeState(state: Record<string, unknown>) {
  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`);
}

async function main() {
  const buffer = readFileSync(rawDataUrl);
  const parsed = parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const validation = validateWallaHeaderRow(parsed.headerRow);
  if (!validation.valid) throw new Error(`raw data 헤더 검증 실패: ${validation.errors.join(", ")}`);
  const question = buildQuestionSpecs(normalizeWallaRows(parsed.headerRow, parsed.dataRows)).find((spec) => spec.kind === "standard");
  if (!question || question.kind !== "standard") throw new Error("검증할 표준 문항을 찾지 못했습니다.");

  const startedAt = Date.now();
  writeState({ status: "started", apiCalls: 1, question: question.label, respondentsSent: question.inputs.length });
  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    const result = await runFastReportAnalysis(question);
    if (result.kind !== "standard") throw new Error("표준 문항 결과 형식이 아닙니다.");
    const categories = Object.values(result.stage2ByPolarity).flatMap((group) => group?.categories ?? []);
    const quoteCount = categories.reduce((sum, category) => sum + category.quotes.length, 0);
    writeState({
      event: "fast_qualitative_smoke_complete",
      status: "completed",
      apiCalls: 1,
      question: question.label,
      respondentsSent: question.inputs.length,
      categoryCount: categories.length,
      verifiedQuoteCount: quoteCount,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    writeState({ status: "failed", apiCalls: 1, question: question.label, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
}

const entryKeepAlive = setInterval(() => undefined, 1_000);
void main().catch((error) => {
  console.error("[fast-smoke] 고속 정성 분석 검증 실패", error);
  process.exitCode = 1;
}).finally(() => clearInterval(entryKeepAlive));
