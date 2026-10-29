import {
  getAllRecommendations,
  getQuestionsWithAllCategories,
  getReportByFileUrl,
  getStrategicInput,
  type ReportRow,
} from "@/lib/db/reports";

type ReadyReport = ReportRow & { quant_stats: NonNullable<ReportRow["quant_stats"]> };

/** PDF·DOCX·HWPX가 같은 저장본과 승인 전 초안을 읽도록 데이터 조회를 한곳에 둔다. */
export async function loadAssemblyData(fileUrl: string) {
  const report = await getReportByFileUrl(fileUrl);
  if (!report?.quant_stats) return null;

  const [questions, recommendations, strategicInput] = await Promise.all([
    getQuestionsWithAllCategories(report.id),
    getAllRecommendations(report.id),
    getStrategicInput(report.id),
  ]);
  return {
    report: report as ReadyReport,
    questions,
    recommendations,
    strategicInput,
  };
}
