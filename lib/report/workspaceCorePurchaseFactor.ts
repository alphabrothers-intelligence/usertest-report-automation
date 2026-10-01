import type { QuantStats } from "@/lib/quant/compute";
import { hasFeatureImportance } from "@/lib/quant/featureRanking";
import { distributionChart, importanceRankBlocks } from "@/lib/report/workspaceCharts";
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
  // **순위 문항이 기능이 아니라 구매요소를 묻고 있으면 그 도표는 이 장 것이다**(케어클 실측,
  // 2026-09-11). 예전에는 Ⅲ장이 무조건 가져가 "Q12 기능 중요도 순위" 제목 아래 구매요소를
  // 나열하고, 정작 이 장은 "1 핵심구매요소 조사 결과" 제목만 덩그러니 남았다.
  const purchaseRankBlocks = hasFeatureImportance(stats) ? [] : importanceRankBlocks(stats, {
    idPrefix: "core-factor",
    compositionTitle: "핵심구매요소 중요도 순위 구성",
    tableTitle: "핵심구매요소 중요 순위 종합",
    itemHeader: "핵심구매요소",
  });
  const resultBlocks: ReportBlock[] = [
    // **분포 문항이 없는 raw data(케어클 — 핵심구매요소가 순위만 있다)에서는 만들지 않는다.**
    // 예전엔 항목 0개짜리 차트와 행 0개짜리 표가 그대로 남았다(2026-09-07 5종 점검).
    ...(rankedKeyFactors.length > 0 ? [
      headingBlock({ id: "core-q13", variant: "question", number: "Q13", text: services.questionText(stats, 13, "서비스를 이용 결정함에 있어서 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하십니까?") }),
      distributionChart("core-factor-dist", "핵심구매요소 조사 결과", stats.keyFactorDistribution),
      tableBlock({
        id: "core-factor-result-table",
        headers: ["No", "핵심 기능", "순위", "비율"],
        rows: rankedKeyFactors.map((item, i) => [i + 1, item.label, `${i + 1}위`, `${item.percentage}%`]),
      }),
    ] : []),
    ...purchaseRankBlocks,
  ];
  return [
    // **내용이 하나도 없으면 절 제목도 만들지 않는다** — 빈 장을 빼는 규칙(workspace.ts)의
    // 절 단위 판이다. 예전엔 제목만 남아 담당자가 "왜 뽑히지도 않았냐"고 묻게 됐다.
    ...(resultBlocks.length > 0
      ? [headingBlock({ id: "core-result-heading", variant: "numbered", number: "1", text: "핵심구매요소 조사 결과" }), ...resultBlocks]
      : []),
    headingBlock({ id: "core-analysis-heading", variant: "numbered", number: resultBlocks.length > 0 ? "2" : "1", text: "핵심구매요소 분석" }),
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
