/**
 * 웹 보고서 작업공간의 섹션 콘텐츠 모델 (PRD 3.3.1 "구조화 문서 블록"의 웹 작업공간 쪽 구현).
 *
 * `buildReportPlan()`(lib/pipeline/reportPlan.ts)의 9개 numeral/title을 섹션 뼈대로 그대로
 * 쓴다 — 채팅 목차 카드·PDF ToC와 항상 같은 출처를 공유해야 어긋나지 않는다(CLAUDE.md
 * "reportPlan.ts의 title이 SectionHeader 문자열과 정확히 같아야 한다" 원칙과 동일 이유).
 *
 * 세 종류 블록:
 * - chart: 정량 막대그래프. 값/색/축 범위를 웹에서 편집할 수 있다 — 단, 이 편집은
 *   **웹 작업공간의 표시/내보내기 레이어에만 적용되는 로컬 오버라이드**다. DB의 quant_stats나
 *   PDF 재계산에는 영향을 주지 않는다(raw data 기반 정량 계산 원칙은 그대로 유지, 이 화면의
 *   "발표용 조정"만 허용 — 2026-07-25 사용자 확정).
 * - table: 정량 표. 숫자 셀만 편집 가능(라벨 열은 편집 대상 아님).
 * - text: 정성 서술문(인사이트·제언 등). `pending: true`면 아직 정성 분석이 승인되지 않아
 *   실제 내용이 없다는 뜻 — 가짜 내용을 채우는 대신 정직하게 "정성 분석 승인 후 표시"로
 *   보여준다.
 */

export type ReportChartItem = { id: string; label: string; value: number };

export type ReportChartBlock = {
  id: string;
  kind: "chart";
  title: string;
  unit: string;
  color: string;
  axisMin: number;
  axisMax: number;
  items: ReportChartItem[];
};

/** PDF의 `RankCompositionChart`와 같은 순위별 가로 누적 막대. */
export type ReportRankCompositionBlock = {
  id: string;
  kind: "rank-composition";
  title: string;
  candidates: { name: string; color: string }[];
  rows: { rank: number; segments: { name: string; percentage: number }[] }[];
};

/** PDF의 성별×연령대 교차 차트처럼 행별 구성값을 가로 누적 막대로 표현한다. */
export type ReportStackedBarBlock = {
  id: string;
  kind: "stacked-bar";
  title: string;
  unit: string;
  axisMax: number;
  categories: { name: string; color: string }[];
  rows: { label: string; segments: { name: string; value: number }[] }[];
};

/** 연령대/성별 비교처럼 동일 항목의 여러 집단 점수를 나란히 비교하는 묶음 막대. */
export type ReportGroupedBarBlock = {
  id: string;
  kind: "grouped-bar";
  title: string;
  unit: string;
  axisMin: number;
  axisMax: number;
  series: { name: string; color: string }[];
  categories: { label: string; values: { series: string; value: number }[] }[];
};

/** 사용자 경험 품질 평가의 전체/영역별 방사형 차트. */
export type ReportRadarBlock = {
  id: string;
  kind: "radar";
  title: string;
  axisMin: number;
  axisMax: number;
  series: { name: string; color: string; values: number[] }[];
  indicators: string[];
};

/** 0~10 추천의향 구간과 추천/중립/비추천 비율을 보여주는 NPS 설명 차트. */
export type ReportNpsBlock = {
  id: string;
  kind: "nps";
  title: string;
  mean: number;
  npsScore: number;
  promoterPct: number;
  passivePct: number;
  detractorPct: number;
};

/** 원본의 "기능별 상대 중요도-만족도 그래프"를 위한 사분면 차트.
 * 상대 중요도(-5~5)와 만족도(0~10)를 같은 좌표계에서 보이며, 웹에서도 수치를 조정할 수 있다. */
export type ReportQuadrantBlock = {
  id: string;
  kind: "quadrant";
  title: string;
  xLabel: string;
  yLabel: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  items: { id: string; name: string; importance: number; satisfaction: number }[];
  /** 10×10 격자의 사용자가 직접 입력한 표시 문구. 값이 없으면 정량 항목명을 해당 칸에 자동 배치한다. */
  cellContents: { id: string; x: number; y: number; text: string }[];
  /** FGI 기준표의 3×3 개선 우선순위 영역. 웹에서 각 칸을 눌러 표시 문구·해석을 수정한다. */
  zones: { id: string; title: string; description: string; color: string; x0: number; x1: number; y0: number; y1: number }[];
};

/** 원본 28쪽의 "영역별 참고 지표". 실제 원자료가 아니라 사분면 해석 기준이므로
 * 값 편집 대상과 분리해, 어느 보고서에서도 동일한 판정 규칙을 보여준다. */
export type ReportPriorityReferenceBlock = {
  id: string;
  kind: "priority-reference";
  title: string;
};

/** 정성 분석이 승인된 문항의 긍정·부정·중립 응답 비율. PDF의 PolarityStackedBar와 동일한
 * 데이터이며, 각 구간은 편집 화면에서 수치 조정 후 PNG로 저장할 수 있다. */
export type ReportPolarityBlock = {
  id: string;
  kind: "polarity";
  title: string;
  positive: number;
  negative: number;
  neutral: number;
};

/** 원본 보고서의 번호형 소제목 상자와 Q 문항 제목을 위한 구조 블록.
 * 본문/차트와 분리해 두면 문서 웹 화면에서도 원본의 읽는 순서와 여백을 유지할 수 있다. */
export type ReportHeadingBlock = {
  id: string;
  kind: "heading";
  /** numbered: `1 | 기능별 고객 경험 조사 결과`, question: `Q13. ...`, subheading: 일반 굵은 소제목 */
  variant: "numbered" | "question" | "subheading";
  text: string;
  number?: string;
};

export type ReportTableBlock = {
  id: string;
  kind: "table";
  title?: string;
  headers: string[];
  /** 숫자 셀만 편집 가능 — 문자열 셀(라벨 등)은 읽기 전용으로 렌더링한다. */
  rows: (string | number)[][];
};

export type ReportTextBlock = {
  id: string;
  kind: "text";
  label: string;
  html: string;
  /** true면 정성 분석 승인 전 — 실제 내용 대신 대기 안내를 보여준다. */
  pending?: boolean;
  /** true면 서식(극성 배너 색상 등)이 있는 정성 콘텐츠 — 단순 편집기(RichReportEditor)가
   * 인라인 스타일을 제거하므로, 서식을 보존하는 렌더링 경로로 표시한다(2026-07-26). */
  styled?: boolean;
};

/**
 * 읽기 전용 서식 HTML 블록. PDF의 `OverviewTable`·`SurveyQuestionTable`처럼 병합 셀·테두리·
 * 색상이 있는 표는 RichReportEditor(단순 편집기)가 table/border/width/display 스타일을 전부
 * 제거하므로 표현할 수 없다 — 이 블록은 sanitizer를 거치지 않고 `dangerouslySetInnerHTML`로
 * 그대로 렌더링해 PDF와 동일한 표를 그린다(2026-07-26). 편집이 필요 없는 개요·설문 항목 표처럼
 * 결정론적으로 생성되는 정적 콘텐츠에만 쓴다.
 */
export type ReportRichStaticBlock = {
  id: string;
  kind: "rich-static";
  html: string;
  /** 이 블록의 AI 요약을 필요할 때만 갱신할 때 쓰는 DB 문항 키. */
  summaryQuestionKey?: string;
  /** Ⅲ장의 짧은 극성 총평과 Ⅴ장의 가치 종합 요약은 문체 규칙이 다르다. */
  summaryKind?: "polarity" | "value";
};

export type ReportBlock = ReportChartBlock | ReportRankCompositionBlock | ReportStackedBarBlock | ReportGroupedBarBlock | ReportRadarBlock | ReportNpsBlock | ReportQuadrantBlock | ReportPriorityReferenceBlock | ReportPolarityBlock | ReportHeadingBlock | ReportTableBlock | ReportTextBlock | ReportRichStaticBlock;

export type ReportSectionContent = {
  numeral: string;
  title: string;
  blocks: ReportBlock[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 차트 items의 값으로부터 "예쁜" Y축 상한을 고른다(기존 studioFixture 관례: 데이터 최댓값을 살짝 넘는 정수). */
function niceAxisMax(values: number[], fallback = 10): number {
  const max = Math.max(...values, 0);
  if (max <= 0) return fallback;
  return Math.min(fallback, Math.ceil(max) + 1);
}

export function chartBlock(params: {
  id: string;
  title: string;
  unit?: string;
  color?: string;
  axisMin?: number;
  axisMax?: number;
  items: ReportChartItem[];
}): ReportChartBlock {
  return {
    id: params.id,
    kind: "chart",
    title: params.title,
    unit: params.unit ?? "",
    color: params.color ?? "#34d7aa",
    axisMin: params.axisMin ?? 0,
    axisMax: params.axisMax ?? niceAxisMax(params.items.map((item) => item.value)),
    items: params.items.map((item) => ({ ...item, value: round2(item.value) })),
  };
}

export function tableBlock(params: { id: string; title?: string; headers: string[]; rows: (string | number)[][] }): ReportTableBlock {
  return { id: params.id, kind: "table", title: params.title, headers: params.headers, rows: params.rows };
}

/** PDF `RankCompositionChart`와 웹 렌더러가 공유하는 순위구성 데이터 계약. */
export function rankCompositionBlock(params: {
  id: string;
  title: string;
  candidates: { name: string; color: string }[];
  rows: { rank: number; segments: { name: string; percentage: number }[] }[];
}): ReportRankCompositionBlock {
  return {
    id: params.id,
    kind: "rank-composition",
    title: params.title,
    candidates: params.candidates.map((candidate) => ({ ...candidate })),
    rows: params.rows.map((row) => ({
      rank: row.rank,
      segments: row.segments.map((segment) => ({ ...segment, percentage: round2(segment.percentage) })),
    })),
  };
}

export function stackedBarBlock(params: {
  id: string;
  title: string;
  unit?: string;
  axisMax: number;
  categories: { name: string; color: string }[];
  rows: { label: string; segments: { name: string; value: number }[] }[];
}): ReportStackedBarBlock {
  return {
    id: params.id,
    kind: "stacked-bar",
    title: params.title,
    unit: params.unit ?? "명",
    axisMax: params.axisMax,
    categories: params.categories.map((category) => ({ ...category })),
    rows: params.rows.map((row) => ({ ...row, segments: row.segments.map((segment) => ({ ...segment, value: round2(segment.value) })) })),
  };
}

export function groupedBarBlock(params: {
  id: string;
  title: string;
  unit?: string;
  axisMin?: number;
  axisMax?: number;
  series: { name: string; color: string }[];
  categories: { label: string; values: { series: string; value: number }[] }[];
}): ReportGroupedBarBlock {
  return {
    id: params.id,
    kind: "grouped-bar",
    title: params.title,
    unit: params.unit ?? "점",
    axisMin: params.axisMin ?? 0,
    axisMax: params.axisMax ?? 10,
    series: params.series.map((series) => ({ ...series })),
    categories: params.categories.map((category) => ({ ...category, values: category.values.map((value) => ({ ...value, value: round2(value.value) })) })),
  };
}

export function radarBlock(params: {
  id: string;
  title: string;
  axisMin?: number;
  axisMax?: number;
  indicators: string[];
  series: { name: string; color: string; values: number[] }[];
}): ReportRadarBlock {
  return {
    id: params.id,
    kind: "radar",
    title: params.title,
    axisMin: params.axisMin ?? 0,
    axisMax: params.axisMax ?? 10,
    indicators: [...params.indicators],
    series: params.series.map((series) => ({ ...series, values: series.values.map(round2) })),
  };
}

export function npsBlock(params: Omit<ReportNpsBlock, "kind">): ReportNpsBlock {
  return { ...params, kind: "nps" };
}

export function defaultQuadrantZones(): ReportQuadrantBlock["zones"] {
  // FGI CSV 기준: X=-5~-2/ -2~2/ 2~5, Y=0~6/ 6~8/ 8~10.
  return [
    { id: "top-left", title: "개선 필요성 적음", description: "우선순위 최하 · 추후 고도화", color: "#aebfe5", x0: -5, x1: -2, y0: 8, y1: 10 },
    { id: "top-middle", title: "개선 필요성 낮음", description: "우선순위 하 · 추후 고도화", color: "#dbe5f5", x0: -2, x1: 2, y0: 8, y1: 10 },
    { id: "top-right", title: "개선 필요성 낮음", description: "우선순위 중 · 추후 고도화", color: "#ffffff", x0: 2, x1: 5, y0: 8, y1: 10 },
    { id: "middle-left", title: "개선 권장", description: "우선순위 하 · 추후 고도화", color: "#dbe5f5", x0: -5, x1: -2, y0: 6, y1: 8 },
    { id: "middle-middle", title: "개선 필요", description: "우선순위 중 · 추후 고도화", color: "#ffffff", x0: -2, x1: 2, y0: 6, y1: 8 },
    { id: "middle-right", title: "중요 개선", description: "우선순위 상 · 고도화 필요", color: "#fde9dd", x0: 2, x1: 5, y0: 6, y1: 8 },
    { id: "bottom-left", title: "요소 제거 권장", description: "또는 개선 권장 · 우선순위 중 · 고도화 권장", color: "#ffffff", x0: -5, x1: -2, y0: 0, y1: 6 },
    { id: "bottom-middle", title: "중요 개선", description: "우선순위 상", color: "#fde9dd", x0: -2, x1: 2, y0: 0, y1: 6 },
    { id: "bottom-right", title: "긴급 개선", description: "우선순위 최상", color: "#f9c9a8", x0: 2, x1: 5, y0: 0, y1: 6 },
  ];
}

/**
 * 로컬스토리지에 남아 있는 이전 작업공간 초안에는 `zones` 필드가 없다.
 * 그 초안을 열어도 FGI 3×3 기준이 비거나 차트가 깨지지 않도록 현재 계약으로 보정한다.
 */
export function withDefaultQuadrantZones(block: ReportQuadrantBlock): ReportQuadrantBlock {
  return {
    ...block,
    zones: Array.isArray(block.zones) && block.zones.length > 0 ? block.zones : defaultQuadrantZones(),
    // 구 버전의 로컬 초안에는 10×10 셀 텍스트 정보가 없다. 빈 배열로 보정하면 항목명을
    // 자동 배치하는 기본 렌더링이 유지되며, 사용자가 칸을 눌러 바로 덮어쓸 수 있다.
    cellContents: Array.isArray(block.cellContents) ? block.cellContents : [],
  };
}

export function quadrantBlock(params: Omit<ReportQuadrantBlock, "kind" | "xLabel" | "yLabel" | "xMin" | "xMax" | "yMin" | "yMax" | "zones" | "cellContents"> & Partial<Pick<ReportQuadrantBlock, "xLabel" | "yLabel" | "xMin" | "xMax" | "yMin" | "yMax" | "zones" | "cellContents">>): ReportQuadrantBlock {
  return {
    ...params,
    kind: "quadrant",
    xLabel: params.xLabel ?? "상대 중요도",
    yLabel: params.yLabel ?? "만족도",
    xMin: params.xMin ?? -5,
    xMax: params.xMax ?? 5,
    yMin: params.yMin ?? 0,
    yMax: params.yMax ?? 10,
    items: params.items.map((item) => ({ ...item, importance: round2(item.importance), satisfaction: round2(item.satisfaction) })),
    zones: (params.zones ?? defaultQuadrantZones()).map((zone) => ({ ...zone })),
    cellContents: (params.cellContents ?? []).map((cell) => ({ ...cell })),
  };
}

export function priorityReferenceBlock(params: Omit<ReportPriorityReferenceBlock, "kind">): ReportPriorityReferenceBlock {
  return { ...params, kind: "priority-reference" };
}

export function polarityBlock(params: Omit<ReportPolarityBlock, "kind">): ReportPolarityBlock {
  return {
    ...params,
    kind: "polarity",
    positive: round2(params.positive),
    negative: round2(params.negative),
    neutral: round2(params.neutral),
  };
}

export function headingBlock(params: { id: string; variant: ReportHeadingBlock["variant"]; text: string; number?: string }): ReportHeadingBlock {
  return { id: params.id, kind: "heading", variant: params.variant, text: params.text, number: params.number };
}

export function textBlock(params: { id: string; label: string; html: string; pending?: boolean; styled?: boolean }): ReportTextBlock {
  return { id: params.id, kind: "text", label: params.label, html: params.html, pending: params.pending, styled: params.styled };
}

export function richStaticBlock(params: { id: string; html: string; summaryQuestionKey?: string; summaryKind?: "polarity" | "value" }): ReportRichStaticBlock {
  return { id: params.id, kind: "rich-static", html: params.html, summaryQuestionKey: params.summaryQuestionKey, summaryKind: params.summaryKind };
}

export const PENDING_QUALITATIVE_NOTICE =
  "정성 분석 승인 후 표시됩니다. 해당 문항의 카테고리·대표 인용문·인사이트가 체크포인트 승인을 거치면 이 영역에 채워집니다.";
