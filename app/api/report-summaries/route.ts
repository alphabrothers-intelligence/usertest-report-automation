import { NextResponse } from "next/server";
import { getReportByFileUrl, getQuestionsWithAllCategories } from "@/lib/db/reports";
import { runPolaritySummariesForQuestion } from "@/lib/pipeline/generatePolaritySummaries";
import { responseSummaryHtml, valueSummaryBoxHtml } from "@/lib/report/workspace";

/** 선택한 요약 박스 한 개만 opt-in으로 생성한다. 보고서 열기·렌더링에서는 호출되지 않는다. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { source?: string; questionKey?: string };
    if (!body.source || !body.questionKey) {
      return NextResponse.json({ ok: false, error: "보고서 원본과 문항 정보가 필요합니다." }, { status: 400 });
    }
    const report = await getReportByFileUrl(body.source);
    if (!report) return NextResponse.json({ ok: false, error: "저장된 보고서를 찾을 수 없습니다." }, { status: 404 });
    const summaries = await runPolaritySummariesForQuestion(report.id, body.questionKey);
    const question = (await getQuestionsWithAllCategories(report.id)).find((item) => item.question_key === body.questionKey);
    if (!question) return NextResponse.json({ ok: false, error: "요약 생성 후 문항을 찾을 수 없습니다." }, { status: 404 });
    const value = question.question_key.startsWith("values:");
    return NextResponse.json({
      ok: true,
      summaryKind: value ? "value" : "polarity",
      html: value ? valueSummaryBoxHtml(question.label, summaries) : responseSummaryHtml(summaries, question.question_key),
    });
  } catch (error) {
    console.error("[report-summaries]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AI 요약 생성에 실패했습니다." }, { status: 500 });
  }
}
