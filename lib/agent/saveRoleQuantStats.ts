/**
 * 역할 분류 결과로 정량 통계와 장 구성을 계산해 저장한다.
 *
 * **두 곳이 이걸 공유한다**: 업로드 직후(`/api/wizard/quant-stats`)와 담당자가 확인 카드에서
 * 역할을 고쳤을 때(`/api/wizard/role-review`). 고친 판정이 도표에 반영되려면 같은 계산을 다시
 * 해야 하는데, 그 코드가 두 벌이 되면 한쪽만 고쳐져 "카드에서 고쳤는데 보고서는 그대로"가 된다.
 *
 * Claude 호출은 없다 — 역할 분류는 `role_plan`에 캐시돼 있고 여기서는 읽기만 한다.
 */
import { applyOverrides, getOrCreateRolePlan, planSections } from "@/lib/agent/rolePlan";
import { computeRoleQuantStats } from "@/lib/agent/quant";
import { toQuantStats, surveyQuestionRowsFromRoles } from "@/lib/agent/toQuantStats";
import { upsertReportQuantStats, saveReportSectionPlan } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";

export async function saveRoleQuantStats(params: {
  fileUrl: string;
  fileName: string | null;
  headerRow: unknown[];
  dataRows: unknown[][];
}): Promise<QuantStats> {
  const { fileUrl, fileName, headerRow, dataRows } = params;
  const plan = await getOrCreateRolePlan({ fileUrl, fileName, headerRow, dataRows });
  const classification = applyOverrides(plan);
  const roleStats = computeRoleQuantStats(classification, plan.profiles, dataRows);
  const stats = toQuantStats(roleStats, {
    surveyQuestions: surveyQuestionRowsFromRoles(classification, plan.profiles),
  });
  await upsertReportQuantStats({
    fileUrl,
    fileName,
    respondentCount: roleStats.respondentCount,
    quantStats: stats,
  });
  // 장 구성은 데이터마다 다르다 — 보고서를 열 때마다 raw data를 다시 받아 계산할 수 없으므로
  // 여기서 저장한다(reports.section_plan).
  await saveReportSectionPlan(fileUrl, planSections(plan, dataRows));
  return stats;
}
