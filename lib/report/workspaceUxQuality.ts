import type { QuantStats } from "@/lib/quant/compute";
import { genericOf } from "@/lib/report/genericStats";
import { REPORT_TEXT } from "@/lib/report/sectionStyle";
import {
  headingBlock,
  PENDING_QUALITATIVE_NOTICE,
  radarBlock,
  richStaticBlock,
  scaleNoteFromQuestion,
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
  // 계열 수를 2개로 전제하지 않는다 — raw data에 있는 계열 전부를 문항 번호 순서로 번갈아 낸다
  // (리바랩스는 실용성1·즐거움1·실용성2… 순서라 예전과 결과가 같다).
  const groups = genericOf(stats).uxGroups;
  const maxItems = Math.max(0, ...groups.map((group) => group.items.length));
  const pairs = Array.from({ length: maxItems }, (_, index) => index).flatMap((index) =>
    groups.flatMap((group) => (group.items[index] ? [{ group: group.groupKey, index, item: group.items[index] }] : [])),
  );
  const groupOrder = groups.map((group) => group.groupKey);
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
        // 원본은 계열마다 표 색이 다르다 — 실용성 파랑, 즐거움 베이지(37쪽 실측).
        // 계열이 셋 이상인 raw data 는 TABLE_PALETTES 를 순환한다.
        paletteIndex: groupOrder.indexOf(entry.group),
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
  const groups = genericOf(stats).uxGroups;
  // 계열 접두(`실용성1)`)가 없는 raw data는 이 장이 통째로 드롭된다(실측: 리바랩스 외 4종).
  // 빌더는 목차와 무관하게 먼저 실행되므로 여기서 빈 채로 돌려준다.
  if (groups.length === 0) return [];
  const allItems = groups.flatMap((group) => group.items);
  // 계열 색은 원본 실측값(실용성 파랑 · 즐거움 베이지). 계열이 셋 이상인 raw data는 순환한다.
  const seriesColors = ["#9ec5f8", "#ffcf94", "#a8d6b5", "#cbb4e3", "#facaa8"];
  return [
    headingBlock({ id: "ux-result-heading", variant: "numbered", number: "1", text: "사용자 경험 품질 평가 결과" }),
    // 원본에는 이 소절 전체를 덮는 척도 주석이 없다 — 문항마다 `* 불편하다: 0점 / 편하다:10점`이
    // 붙는다(headingBlock이 문항 원문에서 도출). 그런데 리바랩스처럼 헤더가 요약 라벨이면
    // 문항별 주석을 뽑을 수 없어 척도 정보가 아예 사라지므로, 그때만 이 한 줄을 남긴다.
    ...(stats.surveyQuestions.some((row) => row.stage === "사용자 경험 품질 평가" && scaleNoteFromQuestion(row.question))
      ? []
      : [richStaticBlock({
        id: "ux-scale-note",
        html: `<p style="text-align:right;margin:0 0 6pt;font-size:${REPORT_TEXT.noteFontSize}pt;color:#6b7280">* 0점 ~ 10점 척도</p>`,
      })]),
    ...uxItemBlocks(stats),
    // "전체" 레이더는 계열을 전부 합쳐 그린다. 계열이 1개뿐이면 바로 아래 계열별 레이더와
    // 같은 그림이 되므로 내지 않는다.
    ...(groups.length > 1
      ? [radarBlock({
        id: "ux-radar-overall",
        title: "전체",
        axisMin: 4,
        axisMax: 6.5,
        indicators: allItems.map((item) => item.name),
        series: [{ name: "전체", color: "#8f8f8f", values: allItems.map((item) => item.mean) }],
      })]
      : []),
    ...groups.map((group, index) =>
      radarBlock({
        id: `ux-radar-${index}`,
        title: group.groupKey,
        axisMin: 4,
        axisMax: 6.5,
        indicators: group.items.map((item) => item.name),
        series: [{ name: group.groupKey, color: seriesColors[index % seriesColors.length], values: group.items.map((item) => item.mean) }],
      }),
    ),
    tableBlock({
      id: "ux-quality-table",
      title: "사용자 경험 품질 평가 결과",
      headers: ["구분", "항목", "평균", "표준편차"],
      rows: groups.flatMap((group) => group.items.map((item) => [group.groupKey, item.name, item.mean, item.sd])),
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
