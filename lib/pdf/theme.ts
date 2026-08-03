import { StyleSheet } from "@react-pdf/renderer";

// 리바랩스·케어클 원본에서 추출한 공통 테마. PDF와 웹 편집 뷰어가 같은 토큰을 공유해야
// 화면에서 승인한 결과와 발행본의 인상이 달라지지 않는다.
// **색상값은 실제 발행 PDF(data/[알파브라더스] 리바랩스...pdf)를 150dpi로 래스터화해 픽셀
// 샘플링한 값이다(2026-07-22)** — 눈대중이 아니라 원본에서 직접 뽑았다:
//   섹션 헤더 제목 바 #5c73aa / 번호 뱃지 #dfeaf5 / 차트 배너 #c0cdef /
//   응답 막대 민트그린 #90f7d5 / Q 제목 밑줄 시안 #42c7f1.
export const colors = {
  navy: "#315c9c",
  navyLight: "#5c73aa", // 섹션 헤더 제목 바(원본 실측)
  headerBadgeBg: "#dfeaf5", // 섹션 헤더 번호 뱃지(원본 실측)
  chartBannerBg: "#c0cdef", // "[ 응답 결과 ]" 등 차트 배너 배경(원본 실측)
  teal: "#90f7d5", // 응답 결과 세로 막대 민트그린(원본 실측 — 기존 #34d7aa는 너무 진했다)
  tealDark: "#159a78",
  qUnderline: "#42c7f1", // Q 문항 제목 아래 굵은 시안 밑줄(원본 실측)
  amber: "#f59e0b",
  red: "#ef4444",
  text: "#18181b",
  subtext: "#52525b",
  border: "#d4d4d8",
  bgAlt: "#f4f4f5",
  white: "#ffffff",
};

export const styles = StyleSheet.create({
  page: {
    fontFamily: "Noto Sans KR",
    fontSize: 9,
    color: colors.text,
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionHeaderBadge: {
    color: colors.navy,
    backgroundColor: colors.headerBadgeBg,
    fontSize: 11,
    fontWeight: "bold",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  sectionHeaderTitle: {
    flex: 1,
    color: colors.white,
    fontSize: 11,
    fontWeight: "bold",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.navyLight,
  },
  subheading: {
    fontSize: 10,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 6,
  },
  // 문항 제목 스타일(예: "Q1. 나이를 입력해주세요") — 굵은 텍스트만 둔다. 시안 밑줄은
  // 뺐다(2026-07-22 요청): 바로 아래 응답 결과 차트 박스에 이미 시안색 상단 테두리가 있어
  // "문항 밑 시안선 + 차트 박스 위 시안선"이 두 줄로 보였다. 차트 박스 위 선 하나만 남긴다.
  qHeading: {
    fontSize: 10.5,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 6,
  },
  body: {
    fontSize: 9,
    lineHeight: 1.5,
    color: colors.text,
  },
  small: {
    fontSize: 8,
    color: colors.subtext,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRowLast: {
    flexDirection: "row",
  },
  tableHeaderCell: {
    flex: 1,
    backgroundColor: colors.bgAlt,
    fontSize: 8,
    fontWeight: "bold",
    padding: 5,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  tableCell: {
    flex: 1,
    fontSize: 8,
    padding: 5,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  categoryBlock: {
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 9,
    fontWeight: "bold",
    marginBottom: 2,
  },
  quote: {
    fontSize: 8.5,
    color: colors.subtext,
    marginLeft: 8,
    marginBottom: 1,
  },
  // 2026-08-03: 강조 텍스트에 색을 쓰지 않는다(사용자 지적 — 원본 발행 보고서는 강조를
  // 전부 검정 굵게/밑줄로만 표시하고 색은 전혀 쓰지 않는다). 예전엔 colors.tealDark(녹색)를
  // 썼는데 제거했다.
  insight: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 2,
  },
  footerRow: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  footerSide: {
    flex: 1,
    fontSize: 7,
    fontWeight: "bold",
    color: colors.subtext,
  },
  footerCenter: {
    flex: 1,
    fontSize: 7,
    color: colors.subtext,
    textAlign: "center",
  },
  placeholder: {
    fontSize: 9,
    color: colors.subtext,
  },
});
