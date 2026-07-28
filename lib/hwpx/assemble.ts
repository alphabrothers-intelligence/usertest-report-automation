import { put } from "@vercel/blob";
import { buildReportHwpx } from "./ReportHwpx";
import {
  getApprovedRecommendations,
  getPendingInsightReviews,
  getPendingRecommendationReviews,
  getQuestionsWithApprovedCategories,
  getReportByFileUrl,
  getStrategicInput,
} from "@/lib/db/reports";

export interface AssembleHwpxResult {
  ok: boolean;
  error?: string;
  hwpxUrl?: string;
}

/** PDF에서 이미 확정한 resultSummary를 받아 HWPX만 추가 생성한다. 이 함수 자체는 AI를 호출하지 않는다. */
export async function assembleReportHwpx(fileUrl: string, resultSummary: string): Promise<AssembleHwpxResult> {
  const report = await getReportByFileUrl(fileUrl);
  if (!report || !report.quant_stats) return { ok: false, error: "정량 통계가 없습니다. computeQuantStats를 먼저 호출하세요." };
  const [pendingInsights, pendingRecommendations] = await Promise.all([
    getPendingInsightReviews(report.id), getPendingRecommendationReviews(report.id),
  ]);
  if (pendingInsights.length || pendingRecommendations.length) {
    return { ok: false, error: "아직 승인되지 않은 정성 분석 또는 제언 항목이 있습니다." };
  }
  // HWPX의 현재 텍스트 출력은 PDF와 동일한 확정 정량/요약 데이터를 사용한다. 아래 조회는
  // 향후 HWPX 표·인용문 블록 확장 시의 동일한 데이터 계약을 유지하기 위한 사전 로드다.
  await Promise.all([getQuestionsWithApprovedCategories(report.id), getApprovedRecommendations(report.id), getStrategicInput(report.id)]);
  const buffer = await buildReportHwpx({
    fileName: report.file_name,
    generatedAt: new Date().toISOString().slice(0, 10),
    quantStats: report.quant_stats,
    resultSummary,
    productInfo: report.product_info ?? undefined,
  });
  const name = `${(report.file_name ?? "report").replace(/\.[^.]+$/, "")}_결과보고서.hwpx`;
  const blob = await put(name, buffer, { access: "private", contentType: "application/hwp+zip", addRandomSuffix: true });
  return { ok: true, hwpxUrl: `/api/download?u=${encodeURIComponent(blob.url)}&name=${encodeURIComponent(name)}` };
}
