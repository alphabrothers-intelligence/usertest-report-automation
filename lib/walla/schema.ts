// WALLA 표준 컬럼 스키마 (PRD 5.1절). SW/App형 v1의 유일한 Tier 1 입력 포맷.
// 기능명은 프로젝트마다 달라지므로 리터럴이 아니라 패턴으로 검증한다.
// 기능 만족도 문항 개수(N)도 프로젝트마다 다르다(2026-08-17 실측: 리바랩스 6개, 이젠오토 8개) —
// 6번 컬럼부터 "기능 만족도" 패턴이 연속으로 몇 개 나오는지 스캔해서 N을 감지하고, 순위(N개)·
// 뒤쪽 고정 블록(4대가치·UX품질 등)을 N에 맞춰 이어붙인다. UX품질(실용성/즐거움 4+4)·4대가치(4)·
// 순위 기반 핵심구매요소는 향후 raw data도 리바랩스 기준을 따를 예정이라(2026-08-17 사용자 확인)
// 고정 구조로 유지한다 — 가변화 대상은 기능 개수 하나뿐이다.

export const WALLA_COLUMN_COUNT = 59; // N=6(리바랩스) 기준 기본값. 실제 기대 개수는 ValidationResult.expectedColumnCount 참고.

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

const FEATURE_BLOCK_START = 6;

export interface FeatureBlockLayout {
  featureCount: number;
  featureCols: number[]; // 기능 만족도 컬럼 인덱스, 길이 featureCount
  rankCols: number[]; // 순위 응답 컬럼 인덱스, 길이 featureCount
  tailStart: number; // 순위 블록 다음(경험 유무 질문)부터 시작하는 고정 꼬리 블록의 첫 인덱스
}

/** 6번 컬럼부터 "기능 만족도" 패턴이 연속으로 몇 개 이어지는지 스캔해 기능 개수(N)를 감지한다. */
export function detectFeatureBlockLayout(headerRow: unknown[]): FeatureBlockLayout {
  let count = 0;
  while (pattern(/기능 만족도/)(normalizeHeader(headerRow[FEATURE_BLOCK_START + count * 2]))) {
    count++;
  }
  const featureCount = Math.max(count, 1); // ponytail: 0감지 시 검증이 자연스럽게 실패하도록 최소 1
  const featureCols = Array.from({ length: featureCount }, (_, i) => FEATURE_BLOCK_START + i * 2);
  const rankStart = FEATURE_BLOCK_START + featureCount * 2;
  const rankCols = Array.from({ length: featureCount }, (_, i) => rankStart + i);
  return { featureCount, featureCols, rankCols, tailStart: rankStart + featureCount };
}

// 순위 블록 다음부터 이어지는 고정 꼬리 블록(4대가치·UX품질·NPS 등) — tailStart 기준 상대 오프셋.
// 리바랩스 원본(N=6)에서 tailStart=24이므로, 아래 오프셋 + 24 = 원래 하드코딩 인덱스와 일치한다.
const TAIL_COLUMN_TEMPLATE: { offset: number; label: string; test: ColumnSpec["test"] }[] = [
  { offset: 0, label: "(제품명) 외 걷기 서비스 경험 유무", test: pattern(/경험 유무/) },
  { offset: 1, label: "사용해본 걷기 서비스", test: keyword("사용해본 걷기 서비스") },
  { offset: 2, label: "해당 서비스 만족도", test: keyword("해당 서비스 만족도") },
  { offset: 3, label: "이유", test: keyword("이유") },
  { offset: 4, label: "가장 영향을 미칠 수 있는 핵심 요인", test: keyword("가장 영향을 미칠 수 있는 핵심 요인") },
  { offset: 5, label: "이유", test: keyword("이유") },
  { offset: 6, label: "기능적 가치 만족도", test: keyword("기능적 가치 만족도") },
  { offset: 7, label: "이유", test: keyword("이유") },
  { offset: 8, label: "심미적 가치 만족도", test: keyword("심미적 가치 만족도") },
  { offset: 9, label: "이유", test: keyword("이유") },
  { offset: 10, label: "경제적 가치 만족도", test: keyword("경제적 가치 만족도") },
  { offset: 11, label: "이유", test: keyword("이유") },
  { offset: 12, label: "사회·공공적 이슈 가치 만족도", test: pattern(/가치 만족도/) },
  { offset: 13, label: "이유", test: keyword("이유") },
  ...([0, 1, 2, 3] as const).flatMap((i) => [
    { offset: 14 + i * 4, label: `실용성${i + 1})...`, test: pattern(new RegExp(`^실용성${i + 1}\\)`)) },
    { offset: 15 + i * 4, label: "이유", test: keyword("이유") },
    { offset: 16 + i * 4, label: `즐거움${i + 1})...`, test: pattern(new RegExp(`^즐거움${i + 1}\\)`)) },
    { offset: 17 + i * 4, label: "이유", test: keyword("이유") },
  ]),
  { offset: 30, label: "전반적인 만족도", test: keyword("전반적인 만족도") },
  { offset: 31, label: "이유", test: keyword("이유") },
  { offset: 32, label: "NPS", test: keyword("NPS") },
  { offset: 33, label: "이유", test: keyword("이유") },
  { offset: 34, label: "개선 아이디어 제안", test: keyword("개선 아이디어 제안") },
];

function buildWallaColumns(layout: FeatureBlockLayout): ColumnSpec[] {
  return [
    { index: 0, label: "리크루팅", test: keyword("리크루팅") },
    { index: 1, label: "나이", test: keyword("나이") },
    { index: 2, label: "성별", test: keyword("성별") },
    { index: 3, label: "운영체제", test: keyword("운영체제") },
    { index: 4, label: "하루 평균 걷는 시간", test: keyword("하루 평균 걷는 시간") },
    { index: 5, label: "일주일 기준 산책 빈도", test: keyword("일주일 기준 산책 빈도") },
    ...layout.featureCols.flatMap((index): ColumnSpec[] => [
      { index, label: "'기능명' 기능 만족도", test: pattern(/기능 만족도/) },
      { index: index + 1, label: "이유", test: keyword("이유") },
    ]),
    ...layout.rankCols.map(
      (index, i): ColumnSpec => ({ index, label: `${i + 1}위`, test: keyword(`${i + 1}위`) }),
    ),
    ...TAIL_COLUMN_TEMPLATE.map(
      ({ offset, label, test }): ColumnSpec => ({ index: layout.tailStart + offset, label, test }),
    ),
  ];
}

export interface ColumnValidationError {
  index: number;
  expected: string;
  actual: string;
}

export interface ValidationResult {
  valid: boolean;
  columnCount: number;
  expectedColumnCount: number;
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
  const layout = detectFeatureBlockLayout(trimmed);
  const expectedColumnCount = layout.tailStart + TAIL_COLUMN_TEMPLATE.length;
  const errors: ColumnValidationError[] = [];

  if (trimmed.length !== expectedColumnCount) {
    errors.push({
      index: -1,
      expected: `컬럼 개수 ${expectedColumnCount}개(기능 만족도 ${layout.featureCount}개 기준)`,
      actual: `컬럼 개수 ${trimmed.length}개`,
    });
  }

  for (const spec of buildWallaColumns(layout)) {
    const actual = normalizeHeader(trimmed[spec.index]);
    if (!spec.test(actual)) {
      errors.push({
        index: spec.index,
        expected: spec.label,
        actual: actual || "(비어있음)",
      });
    }
  }

  return { valid: errors.length === 0, columnCount: trimmed.length, expectedColumnCount, errors };
}

/** 기능 만족도 컬럼들의 실제 기능명을 헤더 텍스트에서 추출한다 (예: "'펫과의 산책' 기능 만족도" → "펫과의 산책"). */
export function extractFeatureNames(headerRow: unknown[]): string[] {
  return detectFeatureBlockLayout(headerRow).featureCols.map((index) => {
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
  const { tailStart } = detectFeatureBlockLayout(headerRow);
  const parse = (index: number, prefix: string) => {
    const header = normalizeHeader(headerRow[index]);
    const match = header.match(new RegExp(`^${prefix}\\d\\)\\s*(.+)$`));
    return match ? match[1] : header;
  };
  return {
    usability: [14, 18, 22, 26].map((offset) => parse(tailStart + offset, "실용성")),
    fun: [16, 20, 24, 28].map((offset) => parse(tailStart + offset, "즐거움")),
  };
}
