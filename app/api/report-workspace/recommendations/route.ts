import { z } from "zod";
import { getAllRecommendations, getQuestionsWithAllCategories, getReportByFileUrl, saveRecommendation } from "@/lib/db/reports";
import { runFeatureCustomerRecommendations } from "@/lib/pipeline/customerRecommendations";
import { combineDevPriorityText, runAllFeatureImprovementRecommendations, runDevPriorityRecommendation } from "@/lib/pipeline/recommendation";
import { buildReportWorkspaceSeed } from "@/lib/report/workspace";
import { detectProductType } from "@/lib/report/productType";

export const maxDuration = 300;

const BodySchema = z.object({
  source: z.string().url(),
  target: z.enum(["strategy", "customer"]),
});

export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "제언 재생성 요청이 올바르지 않습니다." }, { status: 400 });

    const report = await getReportByFileUrl(parsed.data.source);
    if (!report?.quant_stats) return Response.json({ ok: false, error: "저장된 분석 결과를 찾지 못했습니다." }, { status: 404 });
    const qualitative = await getQuestionsWithAllCategories(report.id);

    if (parsed.data.target === "strategy") {
      const productType = detectProductType(report.quant_stats);
      const [priority, features] = await Promise.all([
        runDevPriorityRecommendation(report.quant_stats, qualitative, productType),
        runAllFeatureImprovementRecommendations(report.quant_stats, qualitative),
      ]);
      await Promise.all([
        saveRecommendation({
          reportId: report.id,
          section: "dev_priority",
          draft: combineDevPriorityText(priority.overallDirection, priority.devPriority),
        }),
        saveRecommendation({ reportId: report.id, section: "overall_direction", draft: priority.overallDirection }),
      ]);
      await Promise.all(features.map((feature) => saveRecommendation({
        reportId: report.id,
        section: `feature_improvement:${feature.featureName}`,
        draft: feature.draft,
      })));
    } else {
      const customer = await runFeatureCustomerRecommendations(report.quant_stats, qualitative);
      await saveRecommendation({ reportId: report.id, section: "feature_customer_recommendations", draft: JSON.stringify(customer) });
    }

    const recommendations = await getAllRecommendations(report.id);
    const workspace = buildReportWorkspaceSeed({
      quantStats: report.quant_stats,
      productInfo: report.product_info,
      fileName: report.file_name,
      resultSummary: report.result_summary,
      qualitative,
      recommendations,
      sectionAnalyses: report.section_analyses,
    });
    const blockId = parsed.data.target === "strategy" ? "conclusion-strategy-table" : "conclusion-feature-customer-table";
    const block = workspace.sections.flatMap((section) => section.blocks).find((candidate) => candidate.id === blockId);
    return Response.json({ ok: true, block });
  } catch (error) {
    console.error("[recommendation-regenerate]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "제언을 다시 생성하지 못했습니다." }, { status: 500 });
  }
}
