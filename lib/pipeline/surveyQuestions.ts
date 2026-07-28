// Ⅰ장 "3. 사용성 테스트 설문 항목" 표.
//
// **원칙(2026-07-23 사용자 지적): 문항은 반드시 실제 raw data 컬럼(=실제 설문 문항)에서
// 도출한다.** 예전엔 걷기앱 전용 문구("산책", "걷기 기반 서비스")를 하드코딩해서, 다른 raw
// data(다른 서비스)를 넣으면 그 데이터와 무관한 문항이 나왔다. 이제 raw data의 헤더 행을
// 그대로 읽어 문항을 만든다 — WALLA 59컬럼 스키마(lib/walla/schema.ts)가 각 컬럼의 역할(단계)을
// 고정하므로, 컬럼 인덱스로 단계를 매핑하고 문항 텍스트는 실제 헤더에서 가져온다. 헤더 텍스트가
// 곧 그 raw data의 실제 설문 문항이므로 어떤 프로젝트 raw data에도 정확히 맞는다.
//
// (실제 발행 보고서 5페이지의 설문 항목 표를 문자 그대로 베끼지 않는 이유는 그대로다 — 그 표는
// "핵심 요인" 단일 선택형 문항 하나를 6개 만족도 문항처럼 잘못 나열해뒀고 문항 번호도 본문과
// 어긋나 있었다. 우리는 raw data 컬럼이라는 ground truth에서 구성한다.)
export interface SurveyQuestionRow {
  stage: string;
  question: string;
}

/** 헤더 셀 텍스트를 한 줄 문항 문자열로 정리(줄바꿈·중복 공백 제거). */
function cleanHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * raw data 헤더 행에서 설문 문항 표를 구성한다. WALLA SW/App형 59컬럼 스키마의 고정 컬럼
 * 역할에 따라 단계를 매핑하고, 문항 텍스트는 실제 헤더에서 가져온다. "이유"·"리크루팅"·빈
 * 컬럼과 순위 세부 컬럼(18~23)은 개별 문항으로 넣지 않는다(순위는 하나의 문항으로 요약).
 */
export function buildSurveyQuestionRows(headerRow: unknown[]): SurveyQuestionRow[] {
  const rows: SurveyQuestionRow[] = [];
  const push = (stage: string, colIdx: number) => {
    const q = cleanHeader(headerRow[colIdx]);
    if (q) rows.push({ stage, question: q });
  };

  // 인적 사항 및 특성 조사 (cols 1~5)
  for (let c = 1; c <= 5; c++) push("인적 사항 및 특성 조사", c);

  // 기능별 고객 경험 평가 — 기능 만족도(짝수 6·8·10·12·14·16) + 중요 순위(18~23 요약)
  const featureCols: number[] = [];
  for (let c = 6; c <= 16; c += 2) {
    if (cleanHeader(headerRow[c])) {
      featureCols.push(c);
      push("기능별 고객 경험 평가", c);
    }
  }
  const rankCount = featureCols.length || 6;
  rows.push({
    stage: "기능별 고객 경험 평가",
    question: `기능 중 중요하다고 생각되는 순위를 1위부터 ${rankCount}위까지 순서대로 작성해주세요`,
  });

  // 유사 서비스 경험 조사 (cols 24~26)
  for (const c of [24, 25, 26]) push("유사 서비스 경험 조사", c);

  // 핵심구매요인 파악 (col 28)
  push("핵심구매요인 파악", 28);

  // 4대 가치 만족도 평가 (cols 30·32·34·36)
  for (const c of [30, 32, 34, 36]) push("4대 가치 만족도 평가", c);

  // 사용자 경험 품질 평가 (실용성/즐거움 8문항: 38·40·42·44·46·48·50·52)
  for (let c = 38; c <= 52; c += 2) push("사용자 경험 품질 평가", c);

  // 종합 만족도 (col 54)
  push("종합 만족도", 54);

  // 구매/추천 의향 조사 (col 56 = NPS)
  push("구매/추천 의향 조사", 56);

  // 개선 아이디어 (col 58)
  push("개선 아이디어", 58);

  return rows;
}
