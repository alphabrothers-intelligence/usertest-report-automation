// Ⅰ장 "3. 사용성 테스트 설문 항목" 표. WALLA 표준 59컬럼 스키마(lib/walla/schema.ts)를
// 기준으로 결정론적으로 구성한다 — 특정 발행 보고서의 설문 설계 문서를 그대로 베끼지 않는다.
// 실제 리바랩스 보고서(2025.09.05자) 5페이지의 설문 항목 표를 대조하던 중, 그 표가 "핵심 요인"
// 단일 선택형 문항(원본 raw data 28번 컬럼) 하나를 마치 6개의 개별 만족도 문항(Q17~Q22)인 것처럼
// 잘못 나열해뒀고, 본문(30페이지)의 실제 결과 차트는 분포 하나뿐이라는 걸 확인했다(문항 번호도
// 설계표는 Q16, 본문은 Q13으로 서로 다름 — 그 표 자체가 내부적으로 어긋나 있다). 그 표를 문자
// 그대로 복제하면 다른 프로젝트 raw data에도 재사용할 수 없는 부정확한 틀이 되므로, 우리가 이미
// 검증해둔 59컬럼 스키마에서 새로 구성했다(2026-07-20).
export interface SurveyQuestionRow {
  stage: string;
  question: string;
}

export function buildSurveyQuestionRows(
  featureNames: string[],
  serviceName?: string,
): SurveyQuestionRow[] {
  const svc = serviceName?.trim() || "본 서비스";
  const rows: SurveyQuestionRow[] = [
    { stage: "인적사항 및 특성 조사", question: "나이를 입력해주세요" },
    { stage: "인적사항 및 특성 조사", question: "성별을 선택해주세요" },
    { stage: "인적사항 및 특성 조사", question: "현재 사용하시는 스마트폰 운영체제를 선택해주세요" },
    { stage: "인적사항 및 특성 조사", question: "하루 평균 걷는 시간은 어느 정도인가요?" },
    { stage: "인적사항 및 특성 조사", question: "일주일에 몇 일 정도 산책을 하시나요?" },
  ];

  for (const name of featureNames) {
    rows.push({ stage: "기능별 고객경험 평가", question: `'${name}' 기능의 만족도는 몇 점입니까?` });
  }
  rows.push({
    stage: "기능별 고객경험 평가",
    question: `${svc}의 기능 중 중요하다고 생각되는 순위를 1위부터 ${featureNames.length || 6}위까지 순서대로 작성해주세요`,
  });

  rows.push(
    { stage: "유사 서비스 경험 조사", question: `${svc} 외에 다른 걷기 기반 서비스를 사용해 보신 적이 있나요?` },
    { stage: "유사 서비스 경험 조사", question: "어떤 걷기 기반 서비스를 사용해 보셨나요?" },
    { stage: "유사 서비스 경험 조사", question: "경험하신 걷기 기반 서비스에 대해 얼마나 만족하시나요?" },
  );

  rows.push({
    stage: "핵심구매요인 파악",
    question: `${svc} 서비스를 이용 결정함에 있어서 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하십니까?`,
  });

  rows.push(
    { stage: "4대가치 만족도평가", question: `${svc}의 기능적 가치 영역에 대한 만족도는 몇 점입니까?` },
    { stage: "4대가치 만족도평가", question: `${svc}의 심미적 가치 영역에 대한 만족도는 몇 점입니까?` },
    { stage: "4대가치 만족도평가", question: `${svc}의 경제적 가치 영역에 대한 만족도는 몇 점입니까?` },
    { stage: "4대가치 만족도평가", question: `${svc}의 사회·공공적 가치 영역에 대한 만족도는 몇 점입니까?` },
  );

  const uxLabels = [
    "조작 편의성",
    "재미·흥미도",
    "게임 진행 자연스러움",
    "몰입도",
    "화면·메뉴 설계 품질",
    "재플레이 의지",
    "규칙·목표 이해 용이성",
    "차별성·독창성",
  ];
  for (const label of uxLabels) {
    rows.push({ stage: "사용자 경험 품질평가", question: `${svc}의 '${label}' 요소에 대한 만족도는 몇 점입니까?` });
  }

  rows.push({ stage: "종합만족도", question: `${svc}의 전반적인 만족도(종합 점수)는 몇 점입니까?` });
  rows.push({
    stage: "구매/추천 의향 조사",
    question: `본 서비스를 체험해보았을 때, ${svc}을(를) 지인(가족, 친구 등)에게 추천할 의향이 얼마나 있습니까?`,
  });
  rows.push({
    stage: "개선 아이디어",
    question: `${svc}을(를) 사용해본 경험을 바탕으로, 어떤 부분에서 개선이 필요하다고 느끼셨나요?`,
  });

  return rows;
}
