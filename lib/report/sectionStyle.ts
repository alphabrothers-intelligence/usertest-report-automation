/** 원본 리바랩스 PDF 3쪽에서 벡터 도형/글자 좌표로 실측한 장 제목 규격(pt). */
export const SECTION_BANNER = {
  badgeWidth: 27.36,
  titleWidth: 199.08,
  height: 33.24,
  badgeFontSize: 14.04,
  titleFontSize: 15,
  marginBottom: 11.52,
  badgeBackground: "#dfeaf5",
  badgeColor: "#0b5b9a",
  titleBackground: "#5c73aa",
  titleColor: "#ffffff",
} as const;

/** 원본 PDF 3쪽의 `1 | 제품 소개` 절 제목 실측값. */
export const SUBSECTION_BANNER = {
  numberWidth: 37.44,
  height: 30,
  fontSize: 14.04,
  marginTop: 11.52,
  marginBottom: 11.64,
  borderWidth: 0.72,
  borderColor: "#6388e6",
  numberBackground: "#dfe6f7",
} as const;

/**
 * 원본 리바랩스 PDF 37쪽을 150dpi로 렌더해 픽셀 단위로 뽑은 본문 규격(2026-08-25).
 * 색은 이미지에서 직접 샘플링했고, 글자 크기는 `pdftotext -bbox`의 글리프 높이를
 * 장 제목(실측 16.6px ↔ 알려진 15pt)으로 보정한 비율(÷1.107)로 환산했다.
 *
 * **직접 색·크기를 리터럴로 쓰지 말고 이 토큰을 쓸 것** — 지금까지 같은 남색이
 * 파일마다 다른 값으로 흩어져 있어서(`#315c9c` 77곳, `#dfe6f7` 13곳 …) 원본과
 * 맞추려면 매번 전부 찾아 고쳐야 했다.
 */
export const REPORT_TEXT = {
  /** `Q18. 캣독런의 조작은 [불편하다 / 편하다]` */
  questionFontSize: 13,
  /** 문항 제목 아래 하늘색 밑줄 */
  questionUnderlineColor: "#42c7f1",
  questionUnderlineWidth: 2.9,
  /** 표 안 글자, 본문 */
  bodyFontSize: 11,
  /** `* 불편하다: 0점 / 편하다:10점` 척도 주석 */
  noteFontSize: 9,
  /** 푸터 `2025 by Alphabrothers` */
  footerFontSize: 8,
  pageNumberFontSize: 11.5,
  /** 본문 좌우 여백(595pt 폭 기준 실측 48pt) */
  pageMarginX: 48,
} as const;

/**
 * 데이터 표(L9) 규격. 원본은 **문항 계열(groupKey)마다 표 색을 바꾼다** — 37쪽에서
 * 실용성1·실용성2는 파랑, 즐거움1·즐거움2는 베이지로 번갈아 나오는 것이 아니라
 * 계열별로 고정돼 있음을 확인했다(Q18 파랑 / Q19 베이지 / Q20 파랑 / Q21 베이지).
 * 계열이 3개 이상인 raw data 를 만나면 이 팔레트를 순환해서 쓴다.
 */
export const DATA_TABLE = {
  /** 제목행·헤더행 높이(실측 48px @150dpi) */
  rowHeight: 23,
  borderWidth: 0.5,
  fontSize: REPORT_TEXT.bodyFontSize,
} as const;

export type TablePalette = { title: string; header: string; border: string };

export const TABLE_PALETTES: readonly TablePalette[] = [
  { title: "#c0cdef", header: "#dfe6f7", border: "#6182d6" }, // 실용성 계열
  { title: "#f5dca8", header: "#faedd2", border: "#f1cb7e" }, // 즐거움 계열
] as const;

/** 계열 이름(실용성/즐거움 등)을 원본 팔레트에 안정적으로 배정한다. 이름이 없으면 첫 팔레트. */
export function tablePalette(groupIndex: number | undefined): TablePalette {
  return TABLE_PALETTES[(groupIndex ?? 0) % TABLE_PALETTES.length];
}

/**
 * rich-static HTML 문자열로 그리는 표(workspace*.ts 30여 곳)가 `EditableTable`과 같은 서식을
 * 쓰도록 하는 인라인 CSS 조각. 그쪽은 React 컴포넌트가 아니라 문자열이라 토큰 값을 그대로
 * 못 쓰고 `style="..."` 문자열이 필요하다.
 *
 * 원본 3쪽·37쪽 실측 확인(2026-08-25): 개요 표든 문항 표든 테두리는 전부 팔레트 색
 * (#6182d6)이고 회색(#d4d4d8)이 아니다. 배경색은 표마다 다르지만(제목행 #c0cdef 또는
 * #dfe6f7) 테두리·글자 크기·행 높이는 문서 전체가 같다.
 */
export function dataTableCss(paletteIndex = 0) {
  const palette = tablePalette(paletteIndex);
  const base = `border:${DATA_TABLE.borderWidth}pt solid ${palette.border};height:${DATA_TABLE.rowHeight}pt;padding:3pt 6pt;font-size:${DATA_TABLE.fontSize}pt`;
  return {
    palette,
    /** 표가 아닌 박스(감정분석 패널 등)도 같은 테두리를 쓸 때 */
    border: `${DATA_TABLE.borderWidth}pt solid ${palette.border}`,
    /** `<table style="...">` */
    table: "border-collapse:collapse;width:100%;color:#111827",
    /** 표 첫 행(제목). 원본은 제목을 표 바깥 박스가 아니라 표의 첫 행으로 쓴다. */
    title: `${base};background-color:${palette.title};text-align:center;font-weight:700`,
    /** 머리글 행 / 라벨 열 */
    header: `${base};background-color:${palette.header};text-align:center;font-weight:700;vertical-align:middle`,
    /** 값 칸(가운데 정렬) */
    cell: `${base};text-align:center;vertical-align:middle`,
    /** 서술형 칸(왼쪽 정렬) */
    cellLeft: `${base};text-align:left;vertical-align:top;line-height:1.6`,
    /** 배경색만 바꿔 쓰는 경우(극성 표의 긍정/부정/중립 등) */
    cellWith: (background: string) => `${base};text-align:center;vertical-align:middle;background-color:${background}`,
  } as const;
}

const ROMAN_GLYPHS: Record<string, string> = {
  I: "Ⅰ", II: "Ⅱ", III: "Ⅲ", IV: "Ⅳ", V: "Ⅴ",
  VI: "Ⅵ", VII: "Ⅶ", VIII: "Ⅷ", IX: "Ⅸ",
};

export function sectionRomanGlyph(value: string): string {
  return ROMAN_GLYPHS[value] ?? value;
}
