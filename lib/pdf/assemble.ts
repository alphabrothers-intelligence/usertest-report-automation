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
  saveReportResultSummary,
} from "@/lib/db/reports";
import { runResultSummary } from "@/lib/pipeline/summary";

export interface AssembleResult {
  ok: boolean;
  error?: string;
  pendingInsightCount?: number;
  pendingRecommendationCount?: number;
  pdfUrl?: string;
  /** PDF와 DOCX에 동일하게 넣을 Tier 1 결과 요약. 호출자는 한 번만 생성해 재사용할 수 있다. */
  resultSummary?: string;
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

  // 재렌더링은 Claude 분석이 아니라 순수 PDF 레이아웃 작업이다. 이미 생성·확정된 요약이
  // 있으면 그대로 사용하고, 없을 때만 한 번 생성해 reports에 캐시한다.
  const resultSummary = report.result_summary ?? (await runResultSummary(report.quant_stats));
  if (!report.result_summary) await saveReportResultSummary(report.id, resultSummary);

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

  // PRD 3장 ⑩: "채팅에 다운로드 링크 제공" — PDF 바이너리를 채팅 메시지에 그대로 넣지 않고
  // Blob에 업로드해 링크만 돌려준다(대화 페이로드 크기, 스트리밍 성능 모두를 위해).
  // Blob 스토어가 private 전용이라(2026-07-19) access:"public"으로 올리면 실패한다 — private로
  // 올리고, 사용자에게 주는 링크는 원본 블롭 URL이 아니라 /api/download 프록시를 가리키게
  // 한다(그 라우트가 토큰으로 대신 읽어서 스트리밍 — app/api/download/route.ts 참고). 원본
  // private 블롭 URL을 그대로 주면 브라우저가 인증 없이 열 수 없어서 링크가 무용지물이 된다.
  const pdfName = `${(report.file_name ?? "report").replace(/\.[^.]+$/, "")}_결과보고서.pdf`;
  const blob = await put(pdfName, buffer, {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: true,
  });

  const downloadUrl = `/api/download?u=${encodeURIComponent(blob.url)}&name=${encodeURIComponent(pdfName)}`;
  return { ok: true, pdfUrl: downloadUrl, resultSummary };
}
