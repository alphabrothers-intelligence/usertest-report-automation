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

const ROMAN_GLYPHS: Record<string, string> = {
  I: "Ⅰ", II: "Ⅱ", III: "Ⅲ", IV: "Ⅳ", V: "Ⅴ",
  VI: "Ⅵ", VII: "Ⅶ", VIII: "Ⅷ", IX: "Ⅸ",
};

export function sectionRomanGlyph(value: string): string {
  return ROMAN_GLYPHS[value] ?? value;
}
