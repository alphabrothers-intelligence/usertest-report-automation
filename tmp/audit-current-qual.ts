import {
  getAllRecommendations,
  getQuestionsWithAllCategories,
  getReportById,
  getStrategicInput,
} from "../lib/db/reports";

async function main() {
  const reportId =
    process.argv[2] ?? "dfc8de69-4430-41a2-a4bd-a4b426f0a426";

  const [report, questions, recommendations, strategicInput] =
    await Promise.all([
      getReportById(reportId),
      getQuestionsWithAllCategories(reportId),
      getAllRecommendations(reportId),
      getStrategicInput(reportId),
    ]);

  if (!report) {
    throw new Error(`Report not found: ${reportId}`);
  }

  const payload = {
  report: {
    id: report.id,
    fileName: report.file_name,
    respondentCount: report.respondent_count,
    resultSummary: report.result_summary,
    sectionAnalyses: report.section_analyses,
  },
  questions: questions.map((question) => ({
    key: question.question_key,
    label: question.label,
    kind: question.kind,
    polaritySummaries: question.polarity_summaries,
    categories: question.categories.map((category) => ({
      polarity: category.polarity,
      label: category.label,
      clauseCount: category.clause_count,
      quotes: category.quotes,
      insight:
        category.insight_final?.trim() || category.insight_draft?.trim() || "",
      approved: category.insight_approved,
    })),
  })),
  recommendations: recommendations.map((recommendation) => ({
    section: recommendation.section,
    draft: recommendation.draft,
    final: recommendation.final,
    approved: recommendation.approved,
  })),
  strategicInput,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
