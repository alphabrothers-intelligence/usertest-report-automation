import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

export type DistributionItem = { label: string; count: number; percent: number };
export type ScoreMetric = { name: string; mean: number; sd: number; distribution: DistributionItem[] };

export type CareclQuantStats = {
  respondentCount: number;
  rawRowCount: number;
  duplicateRowsRemoved: number;
  age: DistributionItem[];
  gender: DistributionItem[];
  skinType: DistributionItem[];
  priorDeviceUsage: DistributionItem[]; // Q4 (col7) 체험 전 다른 홈케어 디바이스 사용 빈도
  laserExperience: DistributionItem[]; // Q5 (col8) 피부과 레이저/고주파 시술 경험
  competitorExperience: DistributionItem[]; // Q6 (col25) 경쟁재 사용 경험 유무
  experiencedDevices: DistributionItem[]; // Q7 (col26) 사용해본 뷰티 디바이스 브랜드별 언급 수
  experiencedSatisfaction: ScoreMetric; // Q8 (col27) 경험 제품 만족도 분포
  usageCycle: DistributionItem[]; // Q18 (col29) 사용 주기
  usageDuration: DistributionItem[]; // Q19 (col30) 1회 사용 시간
  features: ScoreMetric[];
  journey: ScoreMetric[];
  coreFactors: { name: string; firstChoiceCount: number; percent: number; relativeImportance: number; rank: number }[];
  // 순위 위치별(1위~8위) 어떤 요인이 몇 명 선택됐는지 — 원본 36쪽 "핵심구매요소 조사 결과"
  // 가로 누적막대의 재료. segments는 factorOrder와 같은 순서(색 고정).
  coreFactorRankComposition: { rank: number; segments: { name: string; count: number; percent: number }[] }[];
  coreFactorOrder: string[];
  values: ScoreMetric[];
  overall: ScoreMetric;
  nps: { score: number; promoters: number; passives: number; detractors: number; average: number };
  // Ⅰ장 "설문 항목" 표 — raw data CSV 헤더의 실제 전체 문항에서 도출한다(하드코딩 금지,
  // 리바랩스 원칙과 동일). 단계별로 묶어 원본 보고서 설문 표 형식으로 렌더한다.
  survey: { stage: string; question: string }[];
};

const FEATURE_COLUMNS = [9, 11, 13, 15, 17, 19, 21, 23];
const FEATURE_NAMES = ["SHOT", "GLOW", "EMS", "모드 전환", "강도 조절", "LED 컬러 변경", "인터페이스", "보이스 알림"];
const JOURNEY_COLUMNS = [31, 32, 33, 34, 35];
const JOURNEY_NAMES = ["박스 첫인상", "박스 개봉", "첫 사용", "1주 사용 후", "2주 사용 후"];
const VALUE_COLUMNS = [44, 46, 48, 50];
const VALUE_NAMES = ["기능적 가치", "경제적 가치", "심미적 가치", "사회·공공적 가치"];

// 설문 항목 표 — raw data 헤더 컬럼에서 실제 문항을 뽑는다. 순위(36)·NPS(54) 컬럼은 헤더에
// 문항 텍스트가 없어(값이 "1위"/"NPS") 라벨을 지정한다. 나머지는 헤더 원문을 그대로 쓴다.
const SURVEY_SPEC: { stage: string; col: number; label?: string }[] = [
  ...[4, 5, 6, 7, 8, 25, 26, 27, 28].map((col) => ({ stage: "인적 사항 및\n특성 · 경험 조사", col })),
  ...[9, 11, 13, 15, 17, 19, 21, 23].map((col) => ({ stage: "기능별\n고객경험 평가", col })),
  ...[29, 30, 31, 32, 33, 34, 35].map((col) => ({ stage: "고객 여정 기반\n경험 평가", col })),
  { stage: "핵심구매요인 파악", col: 36, label: "테크핏 이용에 가장 영향을 미칠 수 있는 핵심 요인의 중요 순위(1위~8위)를 작성해주세요" },
  ...[44, 45, 46, 47, 48, 49, 50, 51].map((col) => ({ stage: "가치 만족도 평가", col })),
  // 원본 설문은 구매 의향(Q34)·추천 의향(Q35)을 별도 문항으로 물었으나 raw data 내보내기가
  // 이 둘을 단일 "NPS" 컬럼(54)으로 합쳤다(그래서 raw data 컬럼은 36개). 설문 항목 표는
  // "응답자에게 실제로 물어본 문항" 목록이므로 원본처럼 두 줄로 복원한다 — 문항 텍스트는
  // raw data에 없어 원본 설문 문구를 쓴다(순위·NPS 라벨 예외와 같은 사유). NPS 계산값은
  // 그대로 단일 컬럼에서 산출한다.
  { stage: "구매/추천\n의향 조사", col: 54, label: "본 제품을 체험해보았을 때, 테크핏 뷰티 디바이스를 사용하실 의향이 얼마나 있습니까?" },
  { stage: "구매/추천\n의향 조사", col: 54, label: "본 제품을 체험해보았을 때, 테크핏 뷰티 디바이스를 지인에게 추천할 의향이 얼마나 있습니까?" },
  { stage: "종합 만족도", col: 52 },
  { stage: "개선 아이디어", col: 56 },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asNumber(value: unknown) {
  // 빈 응답을 Number("")=0으로 착각하지 않도록 먼저 걸러낸다 — 경험자만 답하는 문항(Q8
  // 경험 제품 만족도 등)에서 무응답이 0점으로 집계되던 버그(2026-07-24).
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function makeDistribution(values: unknown[], normalizer: (value: string) => string = (value) => value): DistributionItem[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = normalizer(String(raw ?? "").trim());
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: total ? round((count / total) * 100, 1) : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

function scoreMetric(name: string, rows: unknown[][], column: number): ScoreMetric {
  const values = rows.map((row) => asNumber(row[column])).filter((value): value is number => value !== null);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const sd = values.length > 1
    ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))
    : 0;
  const distribution = makeDistribution(values.map(String), (value) => value).sort((a, b) => Number(a.label) - Number(b.label));
  return { name, mean: round(mean), sd: round(sd), distribution };
}

// Q7(사용해본 뷰티 디바이스, col26)은 자유 서술이라 브랜드 키워드로 언급 수를 집계한다.
// 한 응답이 여러 브랜드를 적으면 각각 1씩 센다(원본 8쪽도 언급 수 기준). 어느 브랜드도
// 매칭 안 되는 비어있지 않은 응답(시술·저가·범용 갈바닉 등)은 "기타"로 묶는다.
const DEVICE_BRANDS: { name: string; re: RegExp }[] = [
  { name: "메디큐브", re: /메디큐브/ },
  { name: "엘지(LG)", re: /프라엘/ },
  { name: "뉴스킨", re: /뉴스킨/ },
  { name: "세라젬", re: /세라젬/ },
  { name: "셀리턴", re: /셀리턴/ },
  { name: "쿼드쎄라", re: /쿼드쎄라/ },
  { name: "바나브", re: /바나브/ },
  { name: "오큐라", re: /오큐라/ },
  { name: "듀얼소닉", re: /듀얼소[닉딕]/ },
];
function deviceDistribution(values: unknown[]): DistributionItem[] {
  const counts = new Map<string, number>();
  let etc = 0;
  for (const raw of values) {
    const value = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const hits = DEVICE_BRANDS.filter((b) => b.re.test(value));
    if (hits.length === 0) etc += 1;
    else hits.forEach((b) => counts.set(b.name, (counts.get(b.name) ?? 0) + 1));
  }
  const total = [...counts.values()].reduce((sum, v) => sum + v, 0) + etc;
  const items = [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: total ? round((count / total) * 100, 1) : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
  if (etc > 0) items.push({ label: "기타", count: etc, percent: total ? round((etc / total) * 100, 1) : 0 });
  return items;
}

function ageBand(value: string) {
  const age = asNumber(value);
  if (age === null) return value;
  if (age < 30) return "20대 이하";
  if (age < 40) return "30대";
  if (age < 50) return "40대";
  return "50대 이상";
}

/**
 * 케어클 CSV의 27행 중 휴대폰 뒷번호가 중복된 두 행을 제거한다.
 * 익스포트가 최신 응답부터 정렬돼 있으므로, 각 번호의 첫 행을 유지한다. 원본 발행본의
 * 25명 기준과 일치하며, 필터 기준을 알 수 없었던 과거 수작업 결과를 숨기지 않기 위해
 * rawRowCount/duplicateRowsRemoved도 결과에 노출한다.
 *
 * **정량 수치는 raw data 계산을 신뢰한다(2026-07-24 사용자 결정, CLAUDE.md 원칙과 동일).**
 * 원본 발행 보고서 일부 수치는 raw data와 정합하지 않는다 — 예: 원본 나이 차트는 40대 8·
 * 50대 8이지만 raw data 실제 나이는 40대 4·50대 12로(행을 빼도 재현 불가) 원본 쪽 오류로
 * 추정되고, 원본 NPS 평균 6.44도 중복 2행 제거로는 산술적으로 재현되지 않는다(전체 27행 합
 * 172, 6.44×25=161이 되려면 뺀 2행 합이 11이어야 하나 중복쌍 합은 13·14뿐). 따라서 이
 * 렌더러는 원본 숫자에 억지로 맞추지 않고 raw data에서 결정론적으로 계산한 값을 쓴다 —
 * 다른 raw data가 들어와도 항상 같은 방식으로 올바르게 계산된다.
 */
export function computeCareclQuantStats(rawPath?: string): CareclQuantStats {
  const dataDir = path.join(process.cwd(), "data");
  // macOS export 파일명은 NFD 조합으로 저장될 수 있어, 코드에 적은 NFC "케어클"과
  // 문자열 비교가 실패한다. 정규화해서 찾으면 개발/배포 파일시스템 차이에도 안전하다.
  const source = rawPath ?? path.join(
    dataDir,
    readdirSync(dataDir).find((file) => file.normalize("NFC").includes("케어클") && file.endsWith(".csv"))
      ?? "[케어클] 사용성테스트 raw data.csv",
  );
  const workbook = XLSX.read(readFileSync(source), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
  const headerRow = matrix[0] ?? [];
  const survey = SURVEY_SPEC.map((spec) => ({
    stage: spec.stage,
    question: spec.label ?? String(headerRow[spec.col] ?? "").replace(/\s+/g, " ").trim(),
  }));
  const rows = matrix.slice(1);
  const seenPhones = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    const phone = String(row[3] ?? "").trim();
    if (!phone || seenPhones.has(phone)) return false;
    seenPhones.add(phone);
    return true;
  });

  const n = Math.max(uniqueRows.length, 1);
  const ITEM_COUNT = 8; // 핵심구매요소 항목 수 N (순위 1~8)
  const coreCounts = new Map<string, number>();
  const rankTotals = new Map<string, number>(); // 정렬 tie-break 보조용(가중 합)
  const rankSum = new Map<string, number>(); // 순위 합(FGI 상대중요도 계산용)
  const rankRespCount = new Map<string, number>(); // 순위를 매긴 응답자 수
  // rankAtPosition[pos].get(name) = pos위(0-index)에 name을 고른 응답자 수
  const rankAtPosition: Map<string, number>[] = Array.from({ length: ITEM_COUNT }, () => new Map<string, number>());
  uniqueRows.forEach((row) => {
    for (let rank = 0; rank < ITEM_COUNT; rank += 1) {
      const name = String(row[36 + rank] ?? "").trim();
      if (!name) continue;
      if (rank === 0) coreCounts.set(name, (coreCounts.get(name) ?? 0) + 1);
      rankTotals.set(name, (rankTotals.get(name) ?? 0) + (9 - (rank + 1)));
      rankSum.set(name, (rankSum.get(name) ?? 0) + (rank + 1));
      rankRespCount.set(name, (rankRespCount.get(name) ?? 0) + 1);
      rankAtPosition[rank].set(name, (rankAtPosition[rank].get(name) ?? 0) + 1);
    }
  });
  // 요인 표시 순서: 1위 비율 내림차순으로 고정(색·범례·누적막대가 모두 같은 순서를 공유).
  const factorNames = [...new Set([...coreCounts.keys(), ...rankTotals.keys()])].sort(
    (a, b) => (coreCounts.get(b) ?? 0) - (coreCounts.get(a) ?? 0) || (rankTotals.get(b) ?? 0) - (rankTotals.get(a) ?? 0),
  );
  const coreFactorsRaw = factorNames.map((name) => {
    const firstChoiceCount = coreCounts.get(name) ?? 0;
    // 상대중요도 = FGI 공식(lib/quant/basic.ts와 동일): 5 − 10×(평균순위−1)/(N−1).
    const cnt = rankRespCount.get(name) ?? 0;
    const avgRank = cnt ? (rankSum.get(name) ?? 0) / cnt : ITEM_COUNT;
    const relativeImportance = cnt ? round(5 - (10 * (avgRank - 1)) / (ITEM_COUNT - 1), 2) : 0;
    return { name, firstChoiceCount, percent: round((firstChoiceCount / n) * 100, 1), relativeImportance };
  });
  // 표준 경쟁 순위(동점은 같은 순위, 다음 순위는 건너뜀) — 원본은 0%인 요인들을 모두 같은
  // 순위로 표기한다.
  const coreFactors = coreFactorsRaw.map((f) => {
    const tieStart = coreFactorsRaw.findIndex((g) => g.firstChoiceCount === f.firstChoiceCount);
    return { ...f, rank: tieStart + 1 };
  });
  const coreFactorRankComposition = rankAtPosition.map((posMap, i) => ({
    rank: i + 1,
    segments: factorNames.map((name) => {
      const count = posMap.get(name) ?? 0;
      return { name, count, percent: round((count / n) * 100, 1) };
    }),
  }));

  const npsValues = uniqueRows.map((row) => asNumber(row[54])).filter((value): value is number => value !== null);
  const promoters = npsValues.filter((value) => value >= 9).length;
  const passives = npsValues.filter((value) => value >= 7 && value <= 8).length;
  const detractors = npsValues.filter((value) => value <= 6).length;
  const npsTotal = Math.max(npsValues.length, 1);
  const nps = {
    score: round(((promoters - detractors) / npsTotal) * 100, 0),
    promoters: round((promoters / npsTotal) * 100, 1),
    passives: round((passives / npsTotal) * 100, 1),
    detractors: round((detractors / npsTotal) * 100, 1),
    average: round(npsValues.reduce((sum, value) => sum + value, 0) / npsTotal),
  };

  return {
    respondentCount: uniqueRows.length,
    rawRowCount: rows.length,
    duplicateRowsRemoved: rows.length - uniqueRows.length,
    age: makeDistribution(uniqueRows.map((row) => row[4]), ageBand),
    gender: makeDistribution(uniqueRows.map((row) => row[5])),
    skinType: makeDistribution(uniqueRows.map((row) => row[6])),
    priorDeviceUsage: makeDistribution(uniqueRows.map((row) => row[7])),
    laserExperience: makeDistribution(uniqueRows.map((row) => row[8])),
    competitorExperience: makeDistribution(uniqueRows.map((row) => row[25])),
    experiencedDevices: deviceDistribution(uniqueRows.map((row) => row[26])),
    experiencedSatisfaction: scoreMetric("경험 제품 만족도", uniqueRows, 27),
    usageCycle: makeDistribution(uniqueRows.map((row) => row[29])),
    usageDuration: makeDistribution(uniqueRows.map((row) => row[30])),
    features: FEATURE_COLUMNS.map((column, index) => scoreMetric(FEATURE_NAMES[index], uniqueRows, column)),
    journey: JOURNEY_COLUMNS.map((column, index) => scoreMetric(JOURNEY_NAMES[index], uniqueRows, column)),
    coreFactors,
    coreFactorRankComposition,
    coreFactorOrder: factorNames,
    values: VALUE_COLUMNS.map((column, index) => scoreMetric(VALUE_NAMES[index], uniqueRows, column)),
    overall: scoreMetric("전반적 만족도", uniqueRows, 52),
    nps,
    survey,
  };
}
