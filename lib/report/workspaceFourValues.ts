import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";
import { meanChart } from "@/lib/report/workspaceCharts";
import {
  headingBlock,
  richStaticBlock,
  tableBlock,
  type ReportBlock,
} from "@/lib/report/sections";

export type FourValuesServices = {
  fourValueQualitativeBlocks: (
    stats: QuantStats,
    idPrefix: string,
    questions: QuestionWithApprovedCategories[],
    itemsText?: string,
  ) => ReportBlock[];
  questionsByKeyPrefix: (questions: QuestionWithApprovedCategories[], prefix: string) => QuestionWithApprovedCategories[];
  sectionAnalysisPanelHtml: (analysis: string) => string;
  analysisEvidenceHtml: (title: string, content: string) => string;
  originalAnalysisPanelHtml: (title: string, content: string, actionHtml?: string) => string;
  sectionAiRegenerateButtonHtml: () => string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Ⅴ장 "2"의 저장 분석이 없을 때 사용하는 기존 규칙 기반 종합 해석. */
function buildFourValuesAnalysisText(
  rows: { label: string; mean: number; sd: number }[],
  qualitative: QuestionWithApprovedCategories[],
  questionsByKeyPrefix: FourValuesServices["questionsByKeyPrefix"],
): string {
  const ranked = [...rows].sort((a, b) => b.mean - a.mean);
  // 패널 제목 배너가 이미 "4대 가치 만족도 종합 해석"이므로 본문 라벨은 중복이다(2026-08-18).
  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 3pt">• '${escapeHtml(ranked[0].label)}'의 만족도가 ${ranked[0].mean.toFixed(2)}점으로 가장 높고, '${escapeHtml(ranked[ranked.length - 1].label)}'가 ${ranked[ranked.length - 1].mean.toFixed(2)}점으로 가장 낮음.</p>`);
  const valuesQual = questionsByKeyPrefix(qualitative, "values:");
  for (const row of ranked) {
    const question = valuesQual.find((q) => q.label.includes(row.label.replace("·", "")) || row.label.includes(q.label));
    const negatives = question?.categories.filter((c) => c.polarity === "negative").slice(0, 3).map((c) => c.label) ?? [];
    if (negatives.length > 0) {
      parts.push(`<p style="margin:0 0 3pt">• '${escapeHtml(row.label)}'(${row.mean.toFixed(2)}점): ${negatives.map(escapeHtml).join(", ")} 관련 개선 필요</p>`);
    }
  }
  return parts.join("");
}

/** 섹션 Ⅴ: 4대 가치 만족도. */
export function buildFourValuesSection(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  analysis: string | undefined,
  itemsText: string | undefined,
  services: FourValuesServices,
): ReportBlock[] {
  const rows: { label: string; mean: number; sd: number }[] = [
    { label: "기능적 가치", mean: stats.fourValues.functional.mean, sd: stats.fourValues.functional.sd },
    { label: "심미적 가치", mean: stats.fourValues.aesthetic.mean, sd: stats.fourValues.aesthetic.sd },
    { label: "경제적 가치", mean: stats.fourValues.economic.mean, sd: stats.fourValues.economic.sd },
    { label: "사회·공공적 가치", mean: stats.fourValues.social.mean, sd: stats.fourValues.social.sd },
  ];
  return [
    headingBlock({ id: "values-result-heading", variant: "numbered", number: "1", text: "4대 가치 만족도 조사 결과" }),
    ...services.fourValueQualitativeBlocks(stats, "four-values-qualitative", services.questionsByKeyPrefix(qualitative, "values:"), itemsText),
    headingBlock({ id: "values-analysis-heading", variant: "numbered", number: "2", text: "4대 가치 만족도 조사 결과 분석" }),
    meanChart("four-values-chart", "4대 가치 만족도 종합 결과", rows.map((r) => ({ name: r.label, mean: r.mean }))),
    tableBlock({
      id: "four-values-table",
      title: "4대 가치 만족도",
      headers: ["가치", "평균", "표준편차"],
      rows: rows.map((r) => [r.label, r.mean, r.sd]),
    }),
    richStaticBlock({
      id: "four-values-analysis-summary",
      html: analysis
        ? services.sectionAnalysisPanelHtml(analysis)
        : services.analysisEvidenceHtml("4대 가치 만족도 종합 해석", services.originalAnalysisPanelHtml(
          "4대 가치 만족도 종합 해석",
          buildFourValuesAnalysisText(rows, qualitative, services.questionsByKeyPrefix),
          services.sectionAiRegenerateButtonHtml(),
        )),
      summaryQuestionKey: "fourValues",
      summaryKind: "section",
    }),
  ];
}
