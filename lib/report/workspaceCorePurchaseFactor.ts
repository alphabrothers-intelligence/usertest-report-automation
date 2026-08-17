import type { QuantStats } from "@/lib/quant/compute";
import { distributionChart } from "@/lib/report/workspaceCharts";
import {
  headingBlock,
  PENDING_QUALITATIVE_NOTICE,
  richStaticBlock,
  tableBlock,
  type ReportBlock,
} from "@/lib/report/sections";

export type CorePurchaseFactorServices = {
  questionText: (stats: QuantStats, questionNumber: number, fallback: string) => string;
  sectionAnalysisPanelHtml: (analysis: string) => string;
  originalAnalysisPanelHtml: (title: string, content: string, actionHtml?: string) => string;
  sectionAiRegenerateButtonHtml: () => string;
};

/** 섹션 Ⅳ: 핵심구매요소 — 원본 30~31쪽은 사분면 없이 응답분포+표+분석 텍스트만 있다. */
export function buildCorePurchaseFactorSection(
  stats: QuantStats,
  analysis: string | undefined,
  services: CorePurchaseFactorServices,
): ReportBlock[] {
  const rankedKeyFactors = [...stats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage);
  return [
    headingBlock({ id: "core-result-heading", variant: "numbered", number: "1", text: "핵심구매요소 조사 결과" }),
    headingBlock({ id: "core-q13", variant: "question", number: "Q13", text: services.questionText(stats, 13, "서비스를 이용 결정함에 있어서 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하십니까?") }),
    distributionChart("core-factor-dist", "핵심구매요소 조사 결과", stats.keyFactorDistribution),
    tableBlock({
      id: "core-factor-result-table",
      headers: ["No", "핵심 기능", "순위", "비율"],
      rows: rankedKeyFactors.map((item, i) => [i + 1, item.label, `${i + 1}위`, `${item.percentage}%`]),
    }),
    headingBlock({ id: "core-analysis-heading", variant: "numbered", number: "2", text: "핵심구매요소 분석" }),
    richStaticBlock({
      id: "core-analysis-summary",
      html: analysis
        ? services.sectionAnalysisPanelHtml(analysis)
        : services.originalAnalysisPanelHtml(
          "핵심구매요소 중요 순위 및 만족도 종합 해석",
          `<p>${PENDING_QUALITATIVE_NOTICE}</p>`,
          services.sectionAiRegenerateButtonHtml(),
        ),
      summaryQuestionKey: "corePurchaseFactor",
      summaryKind: "section",
    }),
  ];
}
