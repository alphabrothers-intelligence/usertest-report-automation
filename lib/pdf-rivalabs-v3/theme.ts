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
    fontFamily: "Pretendard Report",
    // Regular은 본문·표·축 라벨에 쓰며, 기존 Noto Sans KR보다 자간이 안정적이어서 같은
    // 여백에서도 조금 더 크게 읽힌다. 원본의 맑은 고딕 계열 인상에 맞춰 9→9.2pt로 조정.
    fontSize: 11,
    color: colors.text,
    // 원본은 하단 푸터와 표 사이 여백이 더 촘촘하다. 글자 크기는 유지하면서 표 제목 띠가
    // 다음 페이지에 고립되지 않도록 상·하단 여백만 원본 수준으로 조정한다.
    paddingTop: 30,
    paddingBottom: 30,
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
    fontSize: 12,
    fontWeight: 700,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  sectionHeaderTitle: {
    // 원본의 장 제목 바는 본문 폭 전체가 아니라 약 305pt까지만 이어진다. flex:1로 두면
    // 화면 끝까지 늘어나 원본과 전혀 다른 인상이 되므로, 실제 측정 폭으로 고정한다.
    width: 269,
    color: colors.white,
    fontSize: 14,
    fontWeight: 700,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.navyLight,
  },
  subheading: {
    fontSize: 12.8,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 6,
  },
  // 문항 제목 스타일(예: "Q1. 나이를 입력해주세요") — 굵은 텍스트만 둔다. 시안 밑줄은
  // 뺐다(2026-07-22 요청): 바로 아래 응답 결과 차트 박스에 이미 시안색 상단 테두리가 있어
  // "문항 밑 시안선 + 차트 박스 위 시안선"이 두 줄로 보였다. 차트 박스 위 선 하나만 남긴다.
  qHeading: {
    // 질문 문항은 차트 제목보다 약하게 읽혀야 한다. 이전 14.8pt bold는 질문이 시각적
    // 주인공이 되어 아래 도표를 밀어냈으므로, 원본처럼 본문보다 조금 큰 12.8pt regular로 둔다.
    fontSize: 12.8,
    lineHeight: 1.4,
    fontWeight: "normal",
    marginTop: 12,
    marginBottom: 6,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.62,
    color: colors.text,
  },
  small: {
    fontSize: 10,
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
    fontSize: 10.4,
    fontWeight: "bold",
    padding: 5,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  tableCell: {
    flex: 1,
    fontSize: 10.4,
    padding: 5,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  categoryBlock: {
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 10.3,
    fontWeight: "bold",
    marginBottom: 2,
  },
  quote: {
    fontSize: 9.8,
    color: colors.subtext,
    marginLeft: 8,
    marginBottom: 1,
  },
  insight: {
    fontSize: 10.3,
    fontWeight: "bold",
    color: colors.tealDark,
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
