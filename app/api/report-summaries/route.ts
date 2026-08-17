import { NextResponse } from "next/server";
import { getReportByFileUrl, getQuestionsWithAllCategories } from "@/lib/db/reports";
import { runPolaritySummariesForQuestion } from "@/lib/pipeline/generatePolaritySummaries";
import { runSectionAnalysesForReport } from "@/lib/pipeline/sectionAnalysis";
import { responseSummaryHtml, valueSummaryBoxHtml, sectionAnalysisPanelHtml, type SectionAnalysisRegenKey } from "@/lib/report/workspace";

const SECTION_ANALYSIS_KEYS: SectionAnalysisRegenKey[] = ["featureExperience", "corePurchaseFactor", "fourValues", "uxQuality"];

/** 선택한 요약 박스 한 개만 opt-in으로 생성한다. 보고서 열기·렌더링에서는 호출되지 않는다.
 * questionKey가 SectionAnalysisKey(예: "fourValues")면 문항별 극성 요약이 아니라
 * sectionAnalysis.ts의 섹션 종합 해석(Ⅲ.2/Ⅳ.2/Ⅴ.2/Ⅵ.2)을 재생성한다 — 같은 "AI 요약 생성"
 * 버튼·엔드포인트를 공유해 클라이언트 쪽 분기를 새로 만들지 않는다. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { source?: string; questionKey?: string };
    if (!body.source || !body.questionKey) {
      return NextResponse.json({ ok: false, error: "보고서 원본과 문항 정보가 필요합니다." }, { status: 400 });
    }
    const report = await getReportByFileUrl(body.source);
    if (!report) return NextResponse.json({ ok: false, error: "저장된 보고서를 찾을 수 없습니다." }, { status: 404 });

    if ((SECTION_ANALYSIS_KEYS as string[]).includes(body.questionKey)) {
      const section = body.questionKey as SectionAnalysisRegenKey;
      const analyses = await runSectionAnalysesForReport(report.id, { sections: [section] });
      const analysis = analyses[section];
      if (!analysis) return NextResponse.json({ ok: false, error: "섹션 분석 생성에 실패했습니다." }, { status: 502 });
      return NextResponse.json({ ok: true, summaryKind: "section", html: sectionAnalysisPanelHtml(section, analysis) });
    }

    const summaries = await runPolaritySummariesForQuestion(report.id, body.questionKey);
    const question = (await getQuestionsWithAllCategories(report.id)).find((item) => item.question_key === body.questionKey);
    if (!question) return NextResponse.json({ ok: false, error: "요약 생성 후 문항을 찾을 수 없습니다." }, { status: 404 });
    const value = question.question_key.startsWith("values:");
    return NextResponse.json({
      ok: true,
      summaryKind: value ? "value" : "polarity",
      html: value ? valueSummaryBoxHtml(question.label, summaries, question.question_key) : responseSummaryHtml(summaries, question.question_key),
    });
  } catch (error) {
    console.error("[report-summaries]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AI 요약 생성에 실패했습니다." }, { status: 500 });
  }
}
