// PRD 3.2절(v1.4 신규) — 정성 분석(비용이 큰 단계) 착수 전, raw data를 바탕으로 보고서
// 목차·섹션이 어떤 근거로 채워질지 계획을 사용자에게 제시하고 동의를 받는다. 목차 구성 자체는
// lib/pdf/ReportDocument.tsx의 실제 섹션 순서(Ⅰ~Ⅸ, 표준스키마_SW앱형.pdf 기준)와 항상 일치해야
// 하므로, LLM이 매번 다르게 서술하지 않도록 규칙 기반으로 고정한다(4.1절 원칙과 동일한 이유).

export interface ReportPlanSection {
  numeral: string;
  title: string;
  source: string;
}

export function buildReportPlan(featureNames: string[]): ReportPlanSection[] {
  const featureList = featureNames.length > 0 ? featureNames.join("·") : "기능";

  return [
    { numeral: "I", title: "개요", source: "제품 정보 입력값(선택 입력) — 입력하지 않은 항목은 \"입력 필요\"로 표시" },
    { numeral: "II", title: "인적사항", source: "raw data 인적사항 컬럼(나이·성별·운영체제·걷기 습관) 집계" },
    {
      numeral: "III",
      title: "기능별 고객경험 평가",
      source: `${featureList} ${featureNames.length}개 기능의 만족도 통계 + 주관식 응답 정성 분석(긍정/부정/중립 분류 및 카테고리화)`,
    },
    { numeral: "IV", title: "핵심구매요소", source: "순위 응답 기반 상대중요도 산출 + 응답 분포" },
    { numeral: "V", title: "4대가치 만족도", source: "기능적·심미적·경제적·사회공공적 가치 통계 + 각 가치 주관식 응답 정성 분석" },
    { numeral: "VI", title: "UX 품질", source: "실용성1~4·즐거움1~4 만족도 통계" },
    { numeral: "VII", title: "교차분석", source: "연령대별·성별 기능/4대가치 만족도 차이" },
    {
      numeral: "VIII",
      title: "NPS·종합만족도",
      source: "NPS 계산 + 전반적 만족도 통계 + 관련 주관식 정성 분석 + 개선 아이디어 분류",
    },
    {
      numeral: "IX",
      title: "결론 및 제언",
      source: "결과요약 자동 생성 + 개발우선순위/기능개선 제언(검수 승인 필요) + 종합전략제언(담당자 입력)",
    },
  ];
}
