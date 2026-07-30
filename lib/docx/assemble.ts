import { Packer } from "docx";
import { put } from "@vercel/blob";
import { buildReportDocx } from "./ReportDocx";
import {
  getReportByFileUrl,
  getQuestionsWithAllCategories,
  getAllRecommendations,
  getStrategicInput,
  saveReportResultSummary,
} from "@/lib/db/reports";
import { runResultSummary } from "@/lib/pipeline/summary";

export interface AssembleDocxResult {
  ok: boolean;
  error?: string;
  pendingInsightCount?: number;
  pendingRecommendationCount?: number;
  docxUrl?: string;
}

/**
 * 최종 DOCX 조립(2026-07-23 추가) — lib/pdf/assemble.ts와 같은 초안 포함 데이터 소스를
 * 쓴다(resultSummary는 저장된 값을 우선 재사용). PDF와 별도 함수로 둔
 * 이유는 renderToBuffer(react-pdf)와 Packer.toBuffer(docx)가 서로 다른 렌더러라 자연스럽게
 * 갈라지기 때문이다. 분석 초안은 웹 보고서에서 바로 수정할 수 있으므로, PDF와 마찬가지로
 * 승인 대기 항목 때문에 DOCX 생성을 막지 않는다.
 */
export async function assembleReportDocx(
  fileUrl: string,
  { resultSummary: suppliedResultSummary }: { resultSummary?: string } = {},
): Promise<AssembleDocxResult> {
  const report = await getReportByFileUrl(fileUrl);
  if (!report || !report.quant_stats) {
    return { ok: false, error: "정량 통계가 없습니다. computeQuantStats를 먼저 호출하세요." };
  }

  const [questions, recommendations, strategicInput] = await Promise.all([
    getQuestionsWithAllCategories(report.id),
    getAllRecommendations(report.id),
    getStrategicInput(report.id),
  ]);

  // PDF 조립이 바로 앞에서 만든 동일한 요약을 받으면 재사용한다. PDF/DOCX를 동시에
  // 요청해 같은 Claude 요약을 두 번 만드는 낭비를 막되, 보고서 본문 내용은 바꾸지 않는다.
  // PDF를 거치지 않고 DOCX만 다시 만들 때도 저장된 요약을 우선 사용한다.
  const resultSummary = suppliedResultSummary ?? report.result_summary ?? (await runResultSummary({ quantStats: report.quant_stats, qualitative: questions, sectionAnalyses: report.section_analyses }));
  if (!suppliedResultSummary && !report.result_summary) await saveReportResultSummary(report.id, resultSummary);

  const doc = await buildReportDocx({
    fileName: report.file_name,
    generatedAt: new Date().toISOString().slice(0, 10),
    quantStats: report.quant_stats,
    questions,
    recommendations,
    strategicInput,
    resultSummary,
    productInfo: report.product_info ?? undefined,
  });
  const buffer = await Packer.toBuffer(doc);

  const docxName = `${(report.file_name ?? "report").replace(/\.[^.]+$/, "")}_결과보고서.docx`;
  const blob = await put(docxName, buffer, {
    access: "private",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    addRandomSuffix: true,
  });

  const downloadUrl = `/api/download?u=${encodeURIComponent(blob.url)}&name=${encodeURIComponent(docxName)}`;
  return { ok: true, docxUrl: downloadUrl };
}
