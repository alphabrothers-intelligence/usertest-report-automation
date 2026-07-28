// DOCX 출력용 색상/폰트 상수 — lib/pdf/theme.ts와 같은 브랜드 컬러를 쓰되, docx 패키지는
// hex 앞에 "#"를 안 붙인다(react-pdf와 표기 관례가 다르다).
export const colors = {
  navy: "315C9C",
  navyLight: "5D76AD",
  chartBannerBg: "C5CFEA",
  bgAlt: "F4F4F5",
  border: "D4D4D8",
  subtext: "52525B",
  text: "18181B",
  white: "FFFFFF",
  positiveBg: "5D76AD",
  negativeBg: "FDE4D0",
  negativeText: "C2410C",
  neutralBg: "F4F4F5",
  insight: "159A78",
};

// Word는 PDF와 달리 폰트 파일을 문서에 내장하지 않고 열람 시점에 시스템 폰트를 이름으로
// 찾는다 — 그래서 lib/pdf/fonts.ts 같은 서브셋 폰트 등록이 필요 없다. "맑은 고딕"은
// Windows·Word 기본 한글 폰트라 담당자 대부분의 환경에서 바로 보인다(설치 안 된 환경에서는
// Word가 유사 폰트로 자동 대체).
export const FONT = "맑은 고딕";
