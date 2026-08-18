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

/**
 * 원본 37~38쪽 "1. 사용자 경험 품질 평가 결과"의 개별 문항 점수표(문항 제목 + 평균/표준편차
 * 2열 + "전체" 행). PDF 렌더러(lib/pdf-rivalabs-v3의 UxSingleScoreTable)에는 이미 있었지만 웹
 * 문서 빌더에만 빠져 있어 이 소절이 레이더·종합표만 나왔다(2026-08-18 지적). 정량 stats에 이미
 * 있는 값만 쓰므로 정성/정량 재계산은 필요 없다.
 *
 * 문항 순서는 raw data 컬럼 순서(실용성1·즐거움1·실용성2·즐거움2…)와 같고, Q 번호는
 * stats.surveyQuestions("사용자 경험 품질 평가" 단계)에서 그대로 가져온다.
 */
function uxItemBlocks(stats: QuantStats): ReportBlock[] {
  const surveyRows = stats.surveyQuestions
    .map((row, index) => ({ ...row, no: index + 1 }))
    .filter((row) => row.stage === "사용자 경험 품질 평가");
  const pairs = stats.uxQuality.usability.flatMap((usabilityItem, index) => [
    { group: "실용성", index, item: usabilityItem },
    ...(stats.uxQuality.fun[index] ? [{ group: "즐거움", index, item: stats.uxQuality.fun[index] }] : []),
  ]);
  return pairs.flatMap((entry, order) => {
    const survey = surveyRows[order];
    const title = `${entry.group}${entry.index + 1}) ${entry.item.name}`;
    return [
      ...(survey
        ? [headingBlock({ id: `ux-item-heading-${order}`, variant: "question", number: `Q${survey.no}`, text: survey.question })]
        : []),
      tableBlock({
        id: `ux-item-score-${order}`,
        title: `${title} 점수`,
        headers: ["", "평균", "표준편차"],
        rows: [["전체", entry.item.mean, entry.item.sd]],
      }),
    ];
  });
}

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
    richStaticBlock({
      id: "ux-scale-note",
      html: `<p style="text-align:right;margin:0 0 6pt;font-size:9pt;color:#6b7280">* 0점 ~ 10점 척도</p>`,
    }),
    ...uxItemBlocks(stats),
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
