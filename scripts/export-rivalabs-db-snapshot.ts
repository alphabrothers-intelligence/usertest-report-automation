import { writeFile } from "node:fs/promises";
import {
  getAllRecommendations,
  getQuestionsWithAllCategories,
  getReportById,
  getStrategicInput,
} from "../lib/db/reports";

async function main() {
  const reportId = process.argv[2] ?? "777788c3-7552-47cc-8d97-57c74a815db9";
  const output = process.argv[3] ?? "tmp/rivalabs-db-snapshot.json";

  const report = await getReportById(reportId);
  if (!report?.quant_stats) throw new Error(`정량 데이터가 있는 보고서를 찾지 못했습니다: ${reportId}`);

  const [questions, recommendations, strategicInput] = await Promise.all([
    getQuestionsWithAllCategories(reportId),
    getAllRecommendations(reportId),
    getStrategicInput(reportId),
  ]);

  await writeFile(output, JSON.stringify({ report, questions, recommendations, strategicInput }, null, 2), "utf8");
  console.log(JSON.stringify({
  output,
  reportId,
  fileName: report.file_name,
  productInfo: report.product_info,
  respondentCount: report.respondent_count,
  questions: questions.length,
  categories: questions.reduce((sum, question) => sum + question.categories.length, 0),
  recommendations: recommendations.length,
  hasSectionAnalyses: Boolean(report.section_analyses),
  hasWorkspaceDraft: Boolean(report.workspace_draft),
  }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
