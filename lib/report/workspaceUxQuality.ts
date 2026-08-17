import type { QuantStats } from "@/lib/quant/compute";
import {
  headingBlock,
  PENDING_QUALITATIVE_NOTICE,
  radarBlock,
  richStaticBlock,
  tableBlock,
  type ReportBlock,
} from "@/lib/report/sections";

export type UxQualityServices = {
  sectionAnalysisPanelHtml: (analysis: string) => string;
  originalAnalysisPanelHtml: (title: string, content: string, actionHtml?: string) => string;
  sectionAiRegenerateButtonHtml: () => string;
};

/** 섹션 Ⅵ: 사용자 경험 품질 평가 — 실용성/즐거움 평균·표준편차 표. */
export function buildUxQualitySection(
  stats: QuantStats,
  analysis: string | undefined,
  services: UxQualityServices,
): ReportBlock[] {
  const usability = stats.uxQuality.usability;
  const fun = stats.uxQuality.fun;
  return [
    headingBlock({ id: "ux-result-heading", variant: "numbered", number: "1", text: "사용자 경험 품질 평가 결과" }),
    radarBlock({
      id: "ux-radar-overall",
      title: "전체",
      axisMin: 4,
      axisMax: 6.5,
      indicators: [...usability.map((item) => item.name), ...fun.map((item) => item.name)],
      series: [{ name: "전체", color: "#8f8f8f", values: [...usability.map((item) => item.mean), ...fun.map((item) => item.mean)] }],
    }),
    radarBlock({
      id: "ux-radar-usability",
      title: "실용성",
      axisMin: 4,
      axisMax: 6.5,
      indicators: usability.map((item) => item.name),
      series: [{ name: "실용성", color: "#9ec5f8", values: usability.map((item) => item.mean) }],
    }),
    radarBlock({
      id: "ux-radar-fun",
      title: "즐거움",
      axisMin: 4,
      axisMax: 6.5,
      indicators: fun.map((item) => item.name),
      series: [{ name: "즐거움", color: "#ffcf94", values: fun.map((item) => item.mean) }],
    }),
    tableBlock({
      id: "ux-quality-table",
      title: "사용자 경험 품질 평가 결과",
      headers: ["구분", "항목", "평균", "표준편차"],
      rows: [
        ...usability.map((item) => ["실용성", item.name, item.mean, item.sd]),
        ...fun.map((item) => ["즐거움", item.name, item.mean, item.sd]),
      ],
    }),
    headingBlock({ id: "ux-analysis-heading", variant: "numbered", number: "2", text: "사용자 경험 품질 평가 결과 분석" }),
    richStaticBlock({
      id: "ux-analysis-summary",
      html: analysis
        ? services.sectionAnalysisPanelHtml(analysis)
        : services.originalAnalysisPanelHtml(
          "사용자 경험 품질 평가 결과 분석",
          `<p>${PENDING_QUALITATIVE_NOTICE}</p>`,
          services.sectionAiRegenerateButtonHtml(),
        ),
      summaryQuestionKey: "uxQuality",
      summaryKind: "section",
    }),
  ];
}
