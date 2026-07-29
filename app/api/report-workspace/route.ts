import { NextResponse } from "next/server";
import {
  getReportByFileUrl,
  getQuestionsWithAllCategories,
  getAllRecommendations,
  saveOverallSatisfactionDistribution,
} from "@/lib/db/reports";
import { buildReportWorkspaceSeed } from "@/lib/report/workspace";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { computeQuantStats, type QuantStats } from "@/lib/quant/compute";

export const runtime = "nodejs";

/**
 * 이전 저장본에는 Ⅷ장 전반적 만족도의 0~10점 분포가 없었다. 평균/표준편차만으로는
 * 막대 분포를 역산할 수 없으므로, 이 경우에만 업로드 원본을 읽어 해당 필드를 보완한다.
 * DB의 기존 분석/정성 결과는 건드리지 않고, 응답용 통계에만 분포를 합친다.
 */
async function ensureOverallSatisfactionDistribution(
  source: string,
  quantStats: QuantStats,
): Promise<QuantStats> {
  if (quantStats.overallSatisfactionDistribution?.some((count) => count > 0)) return quantStats;

  try {
    // raw data는 private Vercel Blob이다. 일반 fetch()는 403이므로, 채팅의 정량 분석과
    // 동일하게 BLOB_READ_WRITE_TOKEN을 쓰는 공용 로더를 거쳐야 한다.
    const loaded = await loadWallaFromUrl(source);
    if (!loaded.ok || !loaded.parsed) return quantStats;

    const { parsed } = loaded;
    const recalculated = computeQuantStats(
      normalizeWallaRows(parsed.headerRow, parsed.dataRows),
      parsed.headerRow,
    );

    return {
      ...quantStats,
      overallSatisfactionDistribution: recalculated.overallSatisfactionDistribution,
    };
  } catch (error) {
    // 뷰어는 기존 저장값만으로도 계속 열려야 한다. 실패 원인은 서버 로그로만 남긴다.
    console.warn("[report-workspace] overall satisfaction distribution backfill failed", error);
    return quantStats;
  }
}

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

  const quantStats = await ensureOverallSatisfactionDistribution(fileUrl, report.quant_stats);
  // 과거 저장본에만 필요한 1회성 보완이다. 다음 뷰어 진입부터는 DB의 정량 통계가
  // 분포까지 완전한 상태이므로 raw data를 다시 내려받지 않는다.
  if (
    !report.quant_stats.overallSatisfactionDistribution?.some((count) => count > 0) &&
    quantStats.overallSatisfactionDistribution?.some((count) => count > 0)
  ) {
    await saveOverallSatisfactionDistribution(report.id, quantStats.overallSatisfactionDistribution);
  }

  return NextResponse.json({
    ok: true,
    workspace: buildReportWorkspaceSeed({
      quantStats,
      productInfo: report.product_info,
      fileName: report.file_name,
      resultSummary: report.result_summary,
      qualitative,
      recommendations,
      sectionAnalyses: report.section_analyses,
    }),
  });
}
