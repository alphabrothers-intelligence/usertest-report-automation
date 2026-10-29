import { saveRecommendation } from "@/lib/db/reports";
import type { runFeatureCustomerRecommendations } from "@/lib/pipeline/customerRecommendations";
import {
  combineDevPriorityText,
  type runAllFeatureImprovementRecommendations,
  type runDevPriorityRecommendation,
} from "@/lib/pipeline/recommendation";

export async function saveStrategyRecommendations(
  reportId: string,
  result: Awaited<ReturnType<typeof runDevPriorityRecommendation>>,
): Promise<void> {
  await Promise.all([
    saveRecommendation({
      reportId,
      section: "dev_priority",
      draft: combineDevPriorityText(result.overallDirection, result.devPriority),
    }),
    saveRecommendation({ reportId, section: "overall_direction", draft: result.overallDirection }),
  ]);
}

export async function saveFeatureImprovementRecommendations(
  reportId: string,
  features: Awaited<ReturnType<typeof runAllFeatureImprovementRecommendations>>,
): Promise<void> {
  await Promise.all(features.map(({ featureName, draft }) =>
    saveRecommendation({ reportId, section: `feature_improvement:${featureName}`, draft }),
  ));
}

export async function saveCustomerRecommendations(
  reportId: string,
  result: Awaited<ReturnType<typeof runFeatureCustomerRecommendations>>,
): Promise<void> {
  await saveRecommendation({
    reportId,
    section: "feature_customer_recommendations",
    draft: JSON.stringify(result),
  });
}
