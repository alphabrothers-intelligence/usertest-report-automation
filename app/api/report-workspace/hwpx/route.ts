import { getReportByFileUrl } from "@/lib/db/reports";
import { buildReportHwpx } from "@/lib/hwpx/ReportHwpx";
import type { ProductInfo } from "@/lib/productInfo/types";

/**
 * 저장된 정량 결과로 HWPX를 즉시 내려준다. 이 경로는 Claude 호출·정량 재계산·Vercel Blob
 * 업로드를 전혀 하지 않으므로, 웹 작업공간에서 반복 내려받아도 API 비용이 추가되지 않는다.
 */
export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  if (!source) return Response.json({ ok: false, error: "보고서 원본 파일 정보가 없습니다." }, { status: 400 });

  const report = await getReportByFileUrl(source);
  if (!report?.quant_stats) return Response.json({ ok: false, error: "저장된 정량 분석 결과를 찾을 수 없습니다." }, { status: 404 });

  const name = `${(report.file_name ?? "사용성테스트_결과보고서").replace(/\.[^.]+$/, "")}_결과보고서.hwpx`;
  const document = await buildReportHwpx({
    fileName: report.file_name,
    generatedAt: new Date().toISOString().slice(0, 10),
    quantStats: report.quant_stats,
    resultSummary: report.result_summary ?? "",
    productInfo: report.product_info ?? undefined,
  });

  return new Response(new Uint8Array(document), {
    headers: {
      "Content-Type": "application/hwp+zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}

/** /viewer의 저장 전 편집 상태까지 포함해 즉시 HWPX로 내려준다. */
export async function POST(request: Request) {
  const body = await request.json() as { source?: string; sections?: unknown; productInfo?: ProductInfo };
  if (!body.source || !Array.isArray(body.sections)) {
    return Response.json({ ok: false, error: "내보낼 보고서 내용이 없습니다." }, { status: 400 });
  }
  const report = await getReportByFileUrl(body.source);
  if (!report?.quant_stats) return Response.json({ ok: false, error: "저장된 보고서를 찾을 수 없습니다." }, { status: 404 });
  const name = `${(report.file_name ?? "사용성테스트_결과보고서").replace(/\.[^.]+$/, "")}_편집본.hwpx`;
  const document = await buildReportHwpx({
    fileName: report.file_name,
    generatedAt: new Date().toISOString().slice(0, 10),
    quantStats: report.quant_stats,
    resultSummary: report.result_summary ?? "",
    productInfo: body.productInfo ?? report.product_info ?? undefined,
    sections: body.sections as Parameters<typeof buildReportHwpx>[0]["sections"],
  });
  return new Response(new Uint8Array(document), { headers: {
    "Content-Type": "application/hwp+zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "no-store",
  }});
}
