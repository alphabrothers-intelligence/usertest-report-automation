import { renderToBuffer } from "@react-pdf/renderer";
import { put } from "@vercel/blob";
import { registerFonts } from "./fonts";
import { ReportDocument } from "./ReportDocument";
import {
  getReportByFileUrl,
  getQuestionsWithApprovedCategories,
  getApprovedRecommendations,
  getStrategicInput,
  getPendingInsightReviews,
  getPendingRecommendationReviews,
} from "@/lib/db/reports";
import { runResultSummary } from "@/lib/pipeline/summary";

export interface AssembleResult {
  ok: boolean;
  error?: string;
  pendingInsightCount?: number;
  pendingRecommendationCount?: number;
  pdfUrl?: string;
}

/**
 * 최종 PDF 조립 (PRD 8장). label·quotes가 확정돼도 insight/제언이 전부 승인되기 전에는
 * 문서를 발행하지 않는다는 원칙을 여기서 게이트로 강제한다.
 */
export async function assembleReport(fileUrl: string): Promise<AssembleResult> {
  const report = await getReportByFileUrl(fileUrl);
  if (!report || !report.quant_stats) {
    return { ok: false, error: "정량 통계가 없습니다. computeQuantStats를 먼저 호출하세요." };
  }

  const pendingInsights = await getPendingInsightReviews(report.id);
  const pendingRecommendations = await getPendingRecommendationReviews(report.id);
  if (pendingInsights.length > 0 || pendingRecommendations.length > 0) {
    return {
      ok: false,
      error: `아직 승인되지 않은 항목이 있습니다 (인사이트 ${pendingInsights.length}건, 제언 ${pendingRecommendations.length}건). 체크포인트를 먼저 완료하세요.`,
      pendingInsightCount: pendingInsights.length,
      pendingRecommendationCount: pendingRecommendations.length,
    };
  }

  const [questions, recommendations, strategicInput] = await Promise.all([
    getQuestionsWithApprovedCategories(report.id),
    getApprovedRecommendations(report.id),
    getStrategicInput(report.id),
  ]);

  const resultSummary = await runResultSummary(report.quant_stats);

  registerFonts();
  const buffer = await renderToBuffer(
    ReportDocument({
      fileName: report.file_name,
      generatedAt: new Date().toISOString().slice(0, 10),
      quantStats: report.quant_stats,
      questions,
      recommendations,
      strategicInput,
      resultSummary,
      productInfo: report.product_info ?? undefined,
    }),
  );

  // PRD 3장 ⑨: "채팅에 다운로드 링크 제공" — PDF 바이너리를 채팅 메시지에 그대로 넣지 않고
  // Blob에 업로드해 링크만 돌려준다(대화 페이로드 크기, 스트리밍 성능 모두를 위해).
  const pdfName = `${(report.file_name ?? "report").replace(/\.[^.]+$/, "")}_결과보고서.pdf`;
  const blob = await put(pdfName, buffer, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: true,
  });

  return { ok: true, pdfUrl: blob.url };
}
