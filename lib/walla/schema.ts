// WALLA 표준 59컬럼 스키마 (PRD 5.1절). SW/App형 v1의 유일한 Tier 1 입력 포맷.
// 기능명(6개)은 프로젝트마다 달라지므로 리터럴이 아니라 패턴으로 검증한다.

export const WALLA_COLUMN_COUNT = 59;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ColumnSpec {
  index: number;
  label: string;
  test: (header: string) => boolean;
}

// header가 정해진 핵심 문구(label)를 "포함"하면 통과한다. 예전엔 정확히 일치(header === label)만
// 통과시켰지만 — 담당자가 raw data 헤더에 요약 라벨("나이") 대신 실제 전체 문항("나이를
// 입력해주세요")을 넣을 수 있도록 포함 검사로 완화했다(2026-07-23, PRD 5.1절 결정). 요약 라벨은
// 전체 문항의 부분 문자열이므로(예: "나이" ⊂ "나이를 입력해주세요") 기존 raw data도 그대로
// 통과한다(golden 회귀 유지). 열의 "위치(index)"는 여전히 고정 검사하므로 열 역할은 유지되고,
// 엉뚱한 파일은 여전히 걸러진다 — 완화된 것은 "그 위치의 문구가 토씨까지 같아야 한다"는 조건뿐이다.
function keyword(label: string): ColumnSpec["test"] {
  return (header) => header.includes(label);
}

function pattern(regex: RegExp): ColumnSpec["test"] {
  return (header) => regex.test(header);
}

export const WALLA_COLUMNS: ColumnSpec[] = [
  { index: 0, label: "리크루팅", test: keyword("리크루팅") },
  { index: 1, label: "나이", test: keyword("나이") },
  { index: 2, label: "성별", test: keyword("성별") },
  { index: 3, label: "운영체제", test: keyword("운영체제") },
  { index: 4, label: "하루 평균 걷는 시간", test: keyword("하루 평균 걷는 시간") },
  { index: 5, label: "일주일 기준 산책 빈도", test: keyword("일주일 기준 산책 빈도") },
  // 6,8,10,12,14,16: '기능명' 기능 만족도 (기능명은 프로젝트마다 가변)
  ...[6, 8, 10, 12, 14, 16].map(
    (index): ColumnSpec => ({
      index,
      label: "'기능명' 기능 만족도",
      test: pattern(/기능 만족도/),
    }),
  ),
  // 7,9,11,13,15,17: 이유 (기능 만족도 직후)
  ...[7, 9, 11, 13, 15, 17].map(
    (index): ColumnSpec => ({ index, label: "이유", test: keyword("이유") }),
  ),
  // 18~23: 1위~6위
  ...[1, 2, 3, 4, 5, 6].map(
    (rank, i): ColumnSpec => ({
      index: 18 + i,
      label: `${rank}위`,
      test: keyword(`${rank}위`),
    }),
  ),
  { index: 24, label: "(제품명) 외 걷기 서비스 경험 유무", test: pattern(/경험 유무/) },
  { index: 25, label: "사용해본 걷기 서비스", test: keyword("사용해본 걷기 서비스") },
  { index: 26, label: "해당 서비스 만족도", test: keyword("해당 서비스 만족도") },
  { index: 27, label: "이유", test: keyword("이유") },
  { index: 28, label: "가장 영향을 미칠 수 있는 핵심 요인", test: keyword("가장 영향을 미칠 수 있는 핵심 요인") },
  { index: 29, label: "이유", test: keyword("이유") },
  { index: 30, label: "기능적 가치 만족도", test: keyword("기능적 가치 만족도") },
  { index: 31, label: "이유", test: keyword("이유") },
  { index: 32, label: "심미적 가치 만족도", test: keyword("심미적 가치 만족도") },
  { index: 33, label: "이유", test: keyword("이유") },
  { index: 34, label: "경제적 가치 만족도", test: keyword("경제적 가치 만족도") },
  { index: 35, label: "이유", test: keyword("이유") },
  { index: 36, label: "사회·공공적 이슈 가치 만족도", test: pattern(/가치 만족도/) },
  { index: 37, label: "이유", test: keyword("이유") },
  // 38,42,46,50: 실용성1~4 / 39,43,47,51: 이유 / 40,44,48,52: 즐거움1~4 / 41,45,49,53: 이유
  ...[38, 42, 46, 50].map(
    (index, i): ColumnSpec => ({
      index,
      label: `실용성${i + 1})...`,
      test: pattern(new RegExp(`^실용성${i + 1}\\)`)),
    }),
  ),
  ...[39, 43, 47, 51].map(
    (index): ColumnSpec => ({ index, label: "이유", test: keyword("이유") }),
  ),
  ...[40, 44, 48, 52].map(
    (index, i): ColumnSpec => ({
      index,
      label: `즐거움${i + 1})...`,
      test: pattern(new RegExp(`^즐거움${i + 1}\\)`)),
    }),
  ),
  ...[41, 45, 49, 53].map(
    (index): ColumnSpec => ({ index, label: "이유", test: keyword("이유") }),
  ),
  { index: 54, label: "전반적인 만족도", test: keyword("전반적인 만족도") },
  { index: 55, label: "이유", test: keyword("이유") },
  { index: 56, label: "NPS", test: keyword("NPS") },
  { index: 57, label: "이유", test: keyword("이유") },
  { index: 58, label: "개선 아이디어 제안", test: keyword("개선 아이디어 제안") },
];

export interface ColumnValidationError {
  index: number;
  expected: string;
  actual: string;
}

export interface ValidationResult {
  valid: boolean;
  columnCount: number;
  errors: ColumnValidationError[];
}

/**
 * 시트의 마지막 컬럼들이 완전히 빈 값이면(엑셀 서식 잔여 컬럼) 무시한다.
 */
function trimTrailingEmptyColumns(headerRow: unknown[]): unknown[] {
  const trimmed = [...headerRow];
  while (trimmed.length > 0 && normalizeHeader(trimmed[trimmed.length - 1]) === "") {
    trimmed.pop();
  }
  return trimmed;
}

export function validateWallaHeaderRow(headerRow: unknown[]): ValidationResult {
  const trimmed = trimTrailingEmptyColumns(headerRow);
  const errors: ColumnValidationError[] = [];

  if (trimmed.length !== WALLA_COLUMN_COUNT) {
    errors.push({
      index: -1,
      expected: `컬럼 개수 ${WALLA_COLUMN_COUNT}개`,
      actual: `컬럼 개수 ${trimmed.length}개`,
    });
  }

  for (const spec of WALLA_COLUMNS) {
    const actual = normalizeHeader(trimmed[spec.index]);
    if (!spec.test(actual)) {
      errors.push({
        index: spec.index,
        expected: spec.label,
        actual: actual || "(비어있음)",
      });
    }
  }

  return { valid: errors.length === 0, columnCount: trimmed.length, errors };
}

/** 6,8,10,12,14,16번 컬럼의 실제 기능명을 헤더 텍스트에서 추출한다 (예: "'펫과의 산책' 기능 만족도" → "펫과의 산책"). */
export function extractFeatureNames(headerRow: unknown[]): string[] {
  return [6, 8, 10, 12, 14, 16].map((index) => {
    const header = normalizeHeader(headerRow[index]);
    const match = header.match(/^[‘'](.+?)[’']/);
    return match ? match[1] : header;
  });
}

/**
 * 38/42/46/50(실용성1~4), 40/44/48/52(즐거움1~4) 컬럼 헤더에는 "실용성1)조작 편의성"처럼
 * 실제 문항 이름이 괄호 뒤에 붙어있다(실측: 리바랩스 raw data 확인, 2026-07-21). 지금까지는
 * 이 접미사를 버리고 "실용성1"이라는 일반 라벨만 써왔는데 — 실제 발행 보고서는 이 접미사를
 * 방사형 차트 축 이름으로 그대로 쓴다(예: "조작 편의성", "게임 진행 자연스러움"). 기능명
 * (extractFeatureNames)과 같은 원리로, 프로젝트마다 달라지는 실제 문항명을 헤더에서 추출한다.
 */
export function extractUxQualityNames(headerRow: unknown[]): { usability: string[]; fun: string[] } {
  const parse = (index: number, prefix: string) => {
    const header = normalizeHeader(headerRow[index]);
    const match = header.match(new RegExp(`^${prefix}\\d\\)\\s*(.+)$`));
    return match ? match[1] : header;
  };
  return {
    usability: [38, 42, 46, 50].map((index) => parse(index, "실용성")),
    fun: [40, 44, 48, 52].map((index) => parse(index, "즐거움")),
  };
}
