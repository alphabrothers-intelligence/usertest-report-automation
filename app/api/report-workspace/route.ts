import { NextResponse } from "next/server";
import { getReportByFileUrl, getQuestionsWithAllCategories, getAllRecommendations } from "@/lib/db/reports";
import { buildReportWorkspaceSeed } from "@/lib/report/workspace";

/**
 * 최종 산출물과 함께 열리는 웹 편집 작업공간의 초기 데이터.
 * 이미 저장된 정량 통계와 결과 요약만 조회하므로 이 API는 Claude 호출이나 재분석을 하지 않는다.
 */
export async function GET(request: Request) {
  const fileUrl = new URL(request.url).searchParams.get("source");
  if (!fileUrl) {
    return NextResponse.json({ ok: false, error: "보고서 원본 파일 정보가 없습니다." }, { status: 400 });
  }

  const report = await getReportByFileUrl(fileUrl);
  if (!report?.quant_stats) {
    return NextResponse.json({ ok: false, error: "저장된 정량 분석 결과를 찾을 수 없습니다." }, { status: 404 });
  }

  // 저장된 정성 분석(카테고리·인용문·인사이트)도 함께 읽어 웹 섹션에 채운다. 승인 여부와
  // 무관하게 전부 가져온다(getQuestionsWithAllCategories) — 웹 작업공간은 검수 전에도 결과를
  // 보고 편집할 수 있어야 하기 때문. Claude 재호출은 없다.
  const qualitative = await getQuestionsWithAllCategories(report.id);
  // 제언(Ⅳ 해석·Ⅸ 개발우선순위·기능개선제안)도 같은 원칙 — 체크포인트 B 승인 전 초안이라도
  // 웹 작업공간에서는 보여준다(최종 PDF만 승인된 것만 반영, assembleReport의 게이트 참고).
  const recommendations = await getAllRecommendations(report.id);

  return NextResponse.json({
    ok: true,
    workspace: buildReportWorkspaceSeed({
      quantStats: report.quant_stats,
      productInfo: report.product_info,
      fileName: report.file_name,
      resultSummary: report.result_summary,
      qualitative,
      recommendations,
    }),
  });
}
