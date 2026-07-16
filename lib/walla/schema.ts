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

function literal(label: string): ColumnSpec["test"] {
  return (header) => header === label;
}

function pattern(regex: RegExp): ColumnSpec["test"] {
  return (header) => regex.test(header);
}

export const WALLA_COLUMNS: ColumnSpec[] = [
  { index: 0, label: "리크루팅", test: literal("리크루팅") },
  { index: 1, label: "나이", test: literal("나이") },
  { index: 2, label: "성별", test: literal("성별") },
  { index: 3, label: "운영체제", test: literal("운영체제") },
  { index: 4, label: "하루 평균 걷는 시간", test: literal("하루 평균 걷는 시간") },
  { index: 5, label: "일주일 기준 산책 빈도", test: literal("일주일 기준 산책 빈도") },
  // 6,8,10,12,14,16: '기능명' 기능 만족도 (기능명은 프로젝트마다 가변)
  ...[6, 8, 10, 12, 14, 16].map(
    (index): ColumnSpec => ({
      index,
      label: "'기능명' 기능 만족도",
      test: pattern(/기능 만족도$/),
    }),
  ),
  // 7,9,11,13,15,17: 이유 (기능 만족도 직후)
  ...[7, 9, 11, 13, 15, 17].map(
    (index): ColumnSpec => ({ index, label: "이유", test: literal("이유") }),
  ),
  // 18~23: 1위~6위
  ...[1, 2, 3, 4, 5, 6].map(
    (rank, i): ColumnSpec => ({
      index: 18 + i,
      label: `${rank}위`,
      test: literal(`${rank}위`),
    }),
  ),
  { index: 24, label: "(제품명) 외 걷기 서비스 경험 유무", test: pattern(/경험 유무$/) },
  { index: 25, label: "사용해본 걷기 서비스", test: literal("사용해본 걷기 서비스") },
  { index: 26, label: "해당 서비스 만족도", test: literal("해당 서비스 만족도") },
  { index: 27, label: "이유", test: literal("이유") },
  { index: 28, label: "가장 영향을 미칠 수 있는 핵심 요인", test: literal("가장 영향을 미칠 수 있는 핵심 요인") },
  { index: 29, label: "이유", test: literal("이유") },
  { index: 30, label: "기능적 가치 만족도", test: literal("기능적 가치 만족도") },
  { index: 31, label: "이유", test: literal("이유") },
  { index: 32, label: "심미적 가치 만족도", test: literal("심미적 가치 만족도") },
  { index: 33, label: "이유", test: literal("이유") },
  { index: 34, label: "경제적 가치 만족도", test: literal("경제적 가치 만족도") },
  { index: 35, label: "이유", test: literal("이유") },
  { index: 36, label: "사회·공공적 이슈 가치 만족도", test: pattern(/가치 만족도$/) },
  { index: 37, label: "이유", test: literal("이유") },
  // 38,42,46,50: 실용성1~4 / 39,43,47,51: 이유 / 40,44,48,52: 즐거움1~4 / 41,45,49,53: 이유
  ...[38, 42, 46, 50].map(
    (index, i): ColumnSpec => ({
      index,
      label: `실용성${i + 1})...`,
      test: pattern(new RegExp(`^실용성${i + 1}\\)`)),
    }),
  ),
  ...[39, 43, 47, 51].map(
    (index): ColumnSpec => ({ index, label: "이유", test: literal("이유") }),
  ),
  ...[40, 44, 48, 52].map(
    (index, i): ColumnSpec => ({
      index,
      label: `즐거움${i + 1})...`,
      test: pattern(new RegExp(`^즐거움${i + 1}\\)`)),
    }),
  ),
  ...[41, 45, 49, 53].map(
    (index): ColumnSpec => ({ index, label: "이유", test: literal("이유") }),
  ),
  { index: 54, label: "전반적인 만족도", test: literal("전반적인 만족도") },
  { index: 55, label: "이유", test: literal("이유") },
  { index: 56, label: "NPS", test: literal("NPS") },
  { index: 57, label: "이유", test: literal("이유") },
  { index: 58, label: "개선 아이디어 제안", test: literal("개선 아이디어 제안") },
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
