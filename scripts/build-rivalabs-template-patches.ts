/** 저장된 리바랩스 보고서를 원본 HWPX 문단 패치 JSON으로 내보낸다. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAllRecommendations, getQuestionsWithAllCategories, getReportById } from "@/lib/db/reports";
import { sql } from "@/lib/db/client";
import { buildStoredTemplateReportPayload } from "@/lib/hwpx/templatePayload";
import { buildRivalabsSwStoredPatches } from "@/lib/hwpx/rivalabsSwTemplateMap";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const reportId = argument("--report-id");
  const output = argument("--output");
  if (!reportId || !output) {
    throw new Error("사용법: tsx scripts/build-rivalabs-template-patches.ts --report-id <id> --output <patches.json>");
  }

  const report = await getReportById(reportId);
  if (!report) throw new Error("저장된 보고서를 찾을 수 없습니다.");
  const [qualitative, recommendations] = await Promise.all([
    getQuestionsWithAllCategories(report.id),
    getAllRecommendations(report.id),
  ]);
  const payload = buildStoredTemplateReportPayload({ report, qualitative, recommendations });
  const patches = buildRivalabsSwStoredPatches(payload);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(patches, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportId: report.id,
    template: payload.template.id,
    quantitativeFeatures: payload.report.quantStats.featureSatisfaction.length,
    qualitativeQuestions: payload.qualitative.length,
    recommendations: payload.recommendations.length,
    patches: patches.length,
    output,
  }, null, 2));
}

void main().finally(async () => {
  // CLI는 1회성 DB 조회만 하므로 연결을 닫아 후속 HWPX 패치 단계가 이어지게 한다.
  await sql.end();
});
