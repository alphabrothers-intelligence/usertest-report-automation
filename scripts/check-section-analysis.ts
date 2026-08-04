/**
 * 기존 Stage1·Stage2 결과를 절대 재실행하지 않고, 저장된 정량·정성 카테고리를 재료로
 * 새 섹션 분석 단계만 측정한다.
 *
 * 사용법:
 *   REPORT_ID=<보고서 UUID> npm run check:section-analysis
 *   REPORT_ID=<보고서 UUID> SECTIONS=featureExperience npm run check:section-analysis
 *
 * SW형은 Claude 호출 5회(동시 최대 2), 실제품형은 1회다. 원문 응답과 생성 본문은
 * tmp 아티팩트에 기록하지 않는다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getReportById } from "../lib/db/reports";
import { detectProductType } from "../lib/report/productType";
import { runSectionAnalysesForReport, type SectionAnalysisKey } from "../lib/pipeline/sectionAnalysis";

const reportId = process.env.REPORT_ID ?? "";
if (!reportId) throw new Error("REPORT_ID 환경변수가 필요합니다.");
const allowedSections = ["featureExperience", "corePurchaseFactor", "fourValues", "uxQuality", "crossAnalysis"] as const;
const requestedByEnv = (process.env.SECTIONS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (requestedByEnv.some((key) => !allowedSections.includes(key as typeof allowedSections[number]))) {
  throw new Error(`SECTIONS에는 다음 값만 사용할 수 있습니다: ${allowedSections.join(", ")}`);
}

const artifactPath = join(process.cwd(), "tmp", "section-analysis-experiment-latest.json");

function writeArtifact(payload: Record<string, unknown>) {
  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(
    artifactPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const report = await getReportById(reportId);
  if (!report?.quant_stats) throw new Error("정량 통계가 저장된 보고서를 찾지 못했습니다.");

  const productType = report.product_type ?? detectProductType(report.quant_stats);
  const defaultSections = productType === "sw"
    ? ["featureExperience", "corePurchaseFactor", "fourValues", "uxQuality", "crossAnalysis"]
    : ["corePurchaseFactor"];
  const requestedSections: SectionAnalysisKey[] = (requestedByEnv.length > 0 ? requestedByEnv : defaultSections) as SectionAnalysisKey[];
  const startedAt = Date.now();
  writeArtifact({
    status: "started",
    reportId,
    productType,
    requestedSections,
    apiCallsPlanned: requestedSections.length,
    concurrency: 2,
    // Stage1·Stage2는 실행하지 않는다. 기존 저장 결과만 읽어 새 단계만 측정한다.
    baselinePipelineReexecuted: false,
  });

  try {
    const analyses = await runSectionAnalysesForReport(reportId, {
      concurrency: 2,
      sections: requestedSections,
    });
    const completedSections = requestedSections.filter((key) => Boolean(analyses[key as keyof typeof analyses]));
    const failedSections = requestedSections.filter((key) => !completedSections.includes(key));
    const elapsedMs = Date.now() - startedAt;
    const completed = failedSections.length === 0;
    writeArtifact({
      status: completed ? "completed" : "partial",
      reportId,
      productType,
      requestedSections,
      completedSections,
      failedSections,
      apiCallsPlanned: requestedSections.length,
      concurrency: 2,
      baselinePipelineReexecuted: false,
      elapsedMs,
    });
    console.log(JSON.stringify({ ok: completed, elapsedMs, completedSections, failedSections }, null, 2));
    if (!completed) process.exitCode = 1;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    writeArtifact({
      status: "failed",
      reportId,
      productType,
      requestedSections,
      apiCallsPlanned: requestedSections.length,
      concurrency: 2,
      baselinePipelineReexecuted: false,
      elapsedMs,
      error: message,
    });
    throw error;
  }
}

void main();
