// PRD 3.2절(v1.4 신규) — 정성 분석(비용이 큰 단계) 착수 전, raw data를 바탕으로 보고서
// 목차·섹션이 어떤 근거로 채워질지 계획을 사용자에게 제시하고 동의를 받는다. 목차 구성 자체는
// lib/pdf/ReportDocument.tsx의 실제 섹션 순서(Ⅰ~Ⅸ, 표준스키마_SW앱형.pdf 기준)와 항상 일치해야
// 하므로, LLM이 매번 다르게 서술하지 않도록 규칙 기반으로 고정한다(4.1절 원칙과 동일한 이유).
//
// title은 반드시 lib/pdf/sectionsQuant.tsx·sectionsQualitative.tsx의 <SectionHeader title="...">
// 문자열과 정확히 같아야 한다 — 채팅 목차 카드·PDF 목차 페이지·PDF 본문 섹션 헤더 세 곳이
// 전부 이 파일을 (직접 또는 lib/pdf/ReportDocument.tsx의 목차 페이지를 통해) 같이 쓰므로,
// 여기서만 다르게 써두면 실제 발행 보고서에서 목차와 본문 제목이 어긋나 보이는 문제가 생긴다
// (2026-07-20, "설문 항목" 표를 만들다가 실제 리바랩스 보고서 자체에 이런 문항번호 불일치가
// 있는 걸 발견하고 나서 특히 더 신경 쓰게 된 부분).

export interface ReportPlanSection {
  numeral: string;
  title: string;
  source: string;
  /**
   * 실제 보고서 목차처럼 개조식 소목차 리스트(2026-07-20 추가) — 채팅 목차 카드와
   * lib/pdf/ReportDocument.tsx의 목차 페이지가 이 배열을 공유해서 쓴다. 한 문단짜리
   * source만으로는 실제 보고서 목차와 나란히 비교하기 어렵다는 피드백 반영 — "실제
   * 보고서 목차를 보면 개조식으로 되어 있어서 보기 편하다"는 지적이 정확히 이 부분이다.
   */
  subitems: string[];
}

export function buildReportPlan(featureNames: string[]): ReportPlanSection[] {
  const featureList = featureNames.length > 0 ? featureNames.join("·") : "기능";

  return [
    {
      numeral: "I",
      title: "개요",
      source:
        "제품 소개(제품 정보 입력값, 선택 입력) + 사용성 테스트 진행 일정(선택 입력) + 사용성 테스트 설문 항목(WALLA 표준 스키마 기반 자동 구성) — 입력하지 않은 항목은 \"입력 필요\"로 표시",
      subitems: ["제품 소개", "사용성 테스트 진행 일정", "사용성 테스트 설문 항목"],
    },
    {
      numeral: "II",
      title: "인적 사항 및 특성 조사",
      source: "raw data 인적사항 컬럼(나이·성별·운영체제·걷기 습관) 집계",
      subitems: ["나이·성별·운영체제·걷기 습관 분포", "유사 서비스 경험"],
    },
    {
      numeral: "III",
      title: "기능별 고객 경험 평가",
      source: `${featureList} ${featureNames.length}개 기능의 만족도 통계 + 주관식 응답 정성 분석(긍정/부정/중립 분류 및 카테고리화)`,
      subitems: ["기능별 고객 경험 조사 결과", "기능별 고객 경험 분석"],
    },
    {
      numeral: "IV",
      title: "핵심구매요소",
      source: "순위 응답 기반 상대중요도 산출 + 응답 분포",
      subitems: ["핵심구매요소 조사 결과", "핵심구매요소 분석"],
    },
    {
      numeral: "V",
      title: "4대 가치 만족도",
      source: "기능적·심미적·경제적·사회공공적 가치 통계 + 각 가치 주관식 응답 정성 분석",
      subitems: ["4대 가치 만족도 조사 결과", "4대 가치 만족도 조사 결과 분석"],
    },
    {
      numeral: "VI",
      title: "사용자 경험 품질 평가",
      source: "실용성1~4·즐거움1~4 만족도 통계",
      subitems: ["사용자 경험 품질 평가 결과", "사용자 경험 품질 평가 결과 분석"],
    },
    {
      numeral: "VII",
      title: "교차 분석",
      source: "연령대별·성별 기능/4대가치 만족도 차이",
      subitems: ["교차 분석 결과 및 분석"],
    },
    {
      // 원본 목차는 "Ⅷ. 종합 만족도 및 NPS 지수"다(2026-07-22 원본 대조 — 기존 "NPS
      // 종합만족도 및 개선아이디어"는 원본과 어긋났다). 소목차도 원본대로 "1. 종합 만족도 및
      // NPS 지수 / 2. 개선 아이디어".
      numeral: "VIII",
      title: "종합 만족도 및 NPS 지수",
      source: "NPS 계산 + 전반적 만족도 통계 + 관련 주관식 정성 분석 + 개선 아이디어 분류",
      subitems: ["종합 만족도 및 NPS 지수", "개선 아이디어"],
    },
    {
      numeral: "IX",
      title: "종합 결과 및 제언",
      source: "결과요약 자동 생성 + 개발우선순위/기능개선 제언(검수 승인 필요) + 종합전략제언(담당자 입력)",
      subitems: ["사용성테스트 결과 요약", "개선 전략 제언", "기능별 고객 제언 종합"],
    },
  ];
}
