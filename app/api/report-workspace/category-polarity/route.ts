import { NextResponse } from "next/server";
import {
  getReportByFileUrl,
  getQuestionsWithAllCategories,
  getAllRecommendations,
  reviewCategoryPolarity,
} from "@/lib/db/reports";
import { buildReportWorkspaceSeed } from "@/lib/report/workspace";

export const runtime = "nodejs";

const POLARITIES = new Set(["positive", "negative", "neutral"]);

/**
 * 웹뷰 왼쪽 패널의 극성 확인 처리(2026-09-02).
 *
 * "이대로 유지"는 확인 표시만 남기고, 다른 극성을 고르면 카테고리의 polarity를 바꾼다.
 * **바뀐 화면은 서버가 다시 만들어 돌려준다** — 극성이 바뀌면 그 문항의 배너 번호·비율·도넛
 * 차트가 전부 달라지는데, 그 계산은 이미 `buildReportWorkspaceSeed`에 있다. 브라우저에서
 * DOM을 옮기고 비율을 다시 계산하면 같은 로직이 두 벌이 되므로 그렇게 하지 않는다.
 * LLM 호출은 없다(이미 저장된 분석 결과를 다시 조립할 뿐).
 */
export async function POST(request: Request) {
  const body = await request.json() as {
    source?: string;
    questionKey?: string;
    label?: string;
    polarity?: string | null;
  };
  const { source, questionKey, label } = body;
  if (!source || !questionKey || !label) {
    return NextResponse.json({ ok: false, error: "확인할 의견 묶음 정보가 없습니다." }, { status: 400 });
  }
  if (body.polarity != null && !POLARITIES.has(body.polarity)) {
    return NextResponse.json({ ok: false, error: "알 수 없는 극성 값입니다." }, { status: 400 });
  }

  const report = await getReportByFileUrl(source);
  if (!report?.quant_stats) {
    return NextResponse.json({ ok: false, error: "저장된 분석 결과를 찾을 수 없습니다." }, { status: 404 });
  }

  const updated = await reviewCategoryPolarity(
    report.id,
    questionKey,
    label,
    (body.polarity ?? null) as "positive" | "negative" | "neutral" | null,
  );
  if (!updated) {
    return NextResponse.json({ ok: false, error: "해당 의견 묶음을 찾지 못했습니다." }, { status: 404 });
  }

  const workspace = buildReportWorkspaceSeed({
    quantStats: report.quant_stats,
    productInfo: report.product_info,
    fileName: report.file_name,
    resultSummary: report.result_summary,
    qualitative: await getQuestionsWithAllCategories(report.id),
    recommendations: await getAllRecommendations(report.id),
    sectionAnalyses: report.section_analyses,
  });

  return NextResponse.json({ ok: true, sections: workspace.sections });
}
