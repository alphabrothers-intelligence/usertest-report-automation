/**
 * 차트 축 규칙 — **웹 작업공간·PDF·DOCX가 같은 함수를 쓴다.**
 *
 * 원래 `lib/pdf/charts.tsx` 안에 있었는데, 그 파일은 `@react-pdf/renderer`를 import 하므로
 * 웹(브라우저) 코드에서 쓸 수 없었다. 그래서 웹 작업공간만 다른 축 규칙(0부터 시작하는
 * 기본값)을 쓰게 됐고, **같은 기능별 만족도가 웹에서는 0~9점, PDF에서는 4~8점으로 다르게
 * 보이는 문제**가 생겼다(2026-08-25 실측). 규칙을 이 파일 하나로 옮겨 세 렌더러가 공유한다.
 */

/**
 * 값 + 평균선이 함께 그려지는 세로 막대 차트의 y축 범위.
 *
 * **원본 보고서 양식(2026-07-23 사용자 결정: "원본과 동일하게 4~8점")**: 데이터에 딱 맞춘
 * 확대 축이 아니라, 정수 눈금(step 1)의 넉넉한 축을 쓴다(값이 5.85~7.20이면 y축 4~8).
 * 최솟값 아래로 약 1점 여백을 두고 정수로 내림, 최댓값 위로 약 1점 여백을 두고 정수로 올림 —
 * 그러면 눈금이 항상 4/5/6/7/8처럼 정수로 떨어지고, 어떤 raw data가 들어와도 같은 원리로
 * 원본과 같은 양식이 나온다.
 */
export function computeBarWithAverageRange(values: number[], average: number): [number, number] {
  const all = [...values, average];
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  const min = Math.max(0, Math.floor(dataMin) - 1);
  const max = Math.min(10, Math.floor(dataMax) + 1);
  return [min, max];
}
