// 정량 통계 기초 함수. LLM을 쓰지 않는 규칙 기반 계산(PRD 4.1절 설계 원칙).

export interface MeanSd {
  n: number;
  mean: number;
  sd: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 표본표준편차(ddof=1)를 사용한다 — 엑셀 STDEV, pandas 기본값과 동일한 관례. */
export function meanSd(values: number[]): MeanSd {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n, mean: round(mean), sd: 0 };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { n, mean: round(mean), sd: round(Math.sqrt(variance)) };
}

/** 0~10점 만족도 점수의 구간별 응답자 수(원본 "만족도 분포도" 세로 막대그래프용). 인덱스 0~10이
 * 각 점수의 응답 수다 — 0.5 이상 반올림하지 않고 정수 점수만 집계한다(설문이 정수 척도). */
export function scoreHistogram(values: number[], maxScore = 10): number[] {
  const counts = new Array(maxScore + 1).fill(0);
  for (const value of values) {
    const bucket = Math.round(value);
    if (bucket >= 0 && bucket <= maxScore) counts[bucket] += 1;
  }
  return counts;
}

export interface CategoryCount {
  label: string;
  count: number;
  percentage: number;
}

export const AGE_BRACKETS = ["10대", "20대", "30대", "40대 이상"] as const;

export function ageBracketLabel(age: number): (typeof AGE_BRACKETS)[number] {
  if (age < 20) return "10대";
  if (age < 30) return "20대";
  if (age < 40) return "30대";
  return "40대 이상";
}

/**
 * 나이를 평균±SD로만 보여주면 "어떤 연령대가 많은지" 한눈에 안 들어온다는 실측 피드백
 * (2026-07-20, 실제 보고서는 10대/20대/30대/40대 이상 구간별 분포 막대그래프로 보여줌).
 * categoryDistribution처럼 건수 내림차순이 아니라, 나이순 그대로(10대→40대 이상) 정렬한다 —
 * 실제 보고서 차트와 같은 순서라야 비교·해석이 자연스럽다.
 */
export function ageBracketDistribution(ages: (number | null)[]): CategoryCount[] {
  const counts = new Map<string, number>(AGE_BRACKETS.map((b) => [b, 0]));
  let total = 0;
  for (const age of ages) {
    if (age === null || Number.isNaN(age)) continue;
    const label = ageBracketLabel(age);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    total += 1;
  }
  return AGE_BRACKETS.map((label) => {
    const count = counts.get(label) ?? 0;
    return { label, count, percentage: total === 0 ? 0 : round((count / total) * 100, 1) };
  });
}

/**
 * 응답 선택지가 "1~2일 정도"/"1 ~ 2일 정도"(물결 앞뒤 공백)나 "5~6일"/"5~6일 정도"("정도"
 * 유무)처럼 같은 항목을 조금씩 다르게 표기한 원본이 섞여 있으면, categoryDistribution이
 * 문자열 그대로 카운트하기 때문에 같은 항목이 여러 개로 쪼개져 나온다(실측: 리바랩스 raw
 * data의 "일주일 기준 산책 빈도" 컬럼이 정확히 이 문제였다 — "1~2일 정도"(21건)와
 * "1 ~ 2일 정도"(16건)가 별개 항목으로 집계돼 응답 결과 차트에 같은 선택지가 두 번씩 나오는
 * 버그로 이어졌다, 2026-07-21). 공백을 지우고 끝의 "정도"를 뗀 값을 그룹핑 키로 쓰고,
 * 화면에 보여줄 라벨은 그 그룹 안에서 가장 많이 쓰인 원문 표기를 그대로 쓴다(임의로 어느 쪽이
 * "정답"인지 정하지 않기 위해). 6/8/…/16번 기능만족도 헤더에 이미 적용 중인 "느슨한 매칭"과
 * 같은 원칙 — 값이 원래 자유도가 있는 컬럼(범위형 선택지)에만 쓴다.
 */
export function normalizeRangeOptionLabel(v: string): string {
  return v.replace(/\s+/g, "").replace(/정도$/, "");
}

export function categoryDistribution(
  values: (string | null)[],
  normalizeKey?: (v: string) => string,
): CategoryCount[] {
  const counts = new Map<string, number>();
  const variantCounts = new Map<string, Map<string, number>>();
  let total = 0;
  for (const v of values) {
    if (v === null || v === "") continue;
    const key = normalizeKey ? normalizeKey(v) : v;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
    if (normalizeKey) {
      const variants = variantCounts.get(key) ?? new Map<string, number>();
      variants.set(v, (variants.get(v) ?? 0) + 1);
      variantCounts.set(key, variants);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const label = normalizeKey
        ? [...variantCounts.get(key)!.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : key;
      return {
        label,
        count,
        percentage: total === 0 ? 0 : round((count / total) * 100, 1),
      };
    })
    .sort((a, b) => b.count - a.count);
}

export interface CrossTabRow {
  label: string; // 1차 변수 값(예: 성별)
  segments: { name: string; count: number }[]; // 2차 변수 값별 건수(예: 연령대)
}

/**
 * 두 범주형 변수의 교차표를 만든다(실제 발행 보고서의 "성별×연령대" 누적 막대그래프 형식,
 * 2026-07-21 실측 대조 — Ⅱ장 인적사항의 Q2 성별 응답 바로 아래에 나온다). 1차 변수(성별)를
 * 행으로, 2차 변수(연령대)를 각 행 안의 색상 구간으로 삼아 건수를 센다. 둘 다 값이 있는
 * 응답만 집계한다(연령 미기재 등은 제외).
 */
export function crossTabCount(
  primary: (string | null)[],
  secondary: (string | null)[],
  secondaryOrder: string[],
): CrossTabRow[] {
  const primaryValues = [...new Set(primary.filter((v): v is string => v !== null))];
  return primaryValues.map((label) => {
    const counts = new Map<string, number>(secondaryOrder.map((s) => [s, 0]));
    primary.forEach((p, i) => {
      if (p !== label) return;
      const s = secondary[i];
      if (s === null) return;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    });
    return { label, segments: secondaryOrder.map((s) => ({ name: s, count: counts.get(s) ?? 0 })) };
  });
}

/**
 * 핵심구매요소/기능 상대중요도 산출식 — 알파브라더스 FGI 원본 산식으로 확정
 * (`data/FGI_데이터_정리_및_그래프_생성.xlsx`의 상대중요도 K열 수식, 2026-07-24 대조):
 *
 *   상대중요도 = 5 − 10 × (평균 우선순위 − 1) / (항목 수 − 1)
 *
 * 즉 평균 순위 1위(가장 중요)면 +5, 꼴찌(N위)면 −5로 **항목 수 N과 무관하게 항상 ±5**
 * 범위에 선형 매핑된다. 이 값이 사분면(중요도-만족도) 그래프의 X축이 된다.
 *
 * **이전 산식 `(N+1) − 2×평균순위`는 N=6일 때만 이 FGI 공식과 동일**하고(그래서 리바랩스
 * 6개 기능에서는 값이 바뀌지 않는다) N이 다르면 ±(N−1) 범위로 어긋났다 — 어떤 raw data가
 * 들어와도 FGI 기준(±5)으로 나오도록 일반화했다.
 */
export function relativeImportance(
  rankRows: string[][], // 응답자별 [1위,2위,...,n위] 항목명 배열
  candidateNames: string[],
): { name: string; score: number }[] {
  const itemCount = candidateNames.length; // 항목 수 N = 최대 순위
  const rankSum = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const ranks of rankRows) {
    ranks.forEach((name, i) => {
      if (!name) return;
      rankSum.set(name, (rankSum.get(name) ?? 0) + (i + 1)); // i+1 = 응답자가 매긴 순위
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
  }

  return candidateNames.map((name) => {
    const count = counts.get(name) ?? 0;
    if (count === 0 || itemCount <= 1) return { name, score: 0 };
    const avgRank = (rankSum.get(name) ?? 0) / count;
    const score = 5 - (10 * (avgRank - 1)) / (itemCount - 1);
    return { name, score: round(score) };
  });
}

export interface RankPositionComposition {
  rank: number; // 1위, 2위, ...
  segments: { name: string; percentage: number }[]; // 0%는 제외(막대에 안 그려짐)
}

/**
 * Q12(기능 중요도 순위) 응답을 순위 위치별로 쪼개, 각 순위에서 어떤 항목이 얼마나 많이
 * 선택됐는지 비율로 계산한다(실제 보고서의 "1위~n위 응답자 구성" 가로 누적 막대그래프,
 * 2026-07-21 실측 대조). relativeImportance가 응답자 개인별 점수를 항목 단위로 집계하는 것과
 * 달리, 이건 순위 위치 단위로 항목 구성비를 본다 — 같은 rank 원본 데이터를 다른 축으로 자른다.
 */
export function rankPositionComposition(
  rankRows: string[][], // 응답자별 [1위,2위,...,n위] 항목명 배열
  candidateNames: string[],
): RankPositionComposition[] {
  const total = rankRows.length;
  return candidateNames.map((_, i) => {
    const counts = new Map<string, number>();
    for (const ranks of rankRows) {
      const name = ranks[i];
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const segments = candidateNames
      .map((name) => ({
        name,
        percentage: total === 0 ? 0 : round(((counts.get(name) ?? 0) / total) * 100, 1),
      }))
      .filter((s) => s.percentage > 0);
    return { rank: i + 1, segments };
  });
}

export interface NpsResult {
  n: number;
  promoterPct: number;
  passivePct: number;
  detractorPct: number;
  npsScore: number;
  rawMean: number;
}

/** 표준 NPS 계산: 9~10 추천고객, 7~8 중립고객, 0~6 비추천고객. */
export function computeNps(scores: number[]): NpsResult {
  const n = scores.length;
  const promoters = scores.filter((s) => s >= 9).length;
  const passives = scores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = scores.filter((s) => s <= 6).length;

  const promoterPct = n === 0 ? 0 : round((promoters / n) * 100, 1);
  const passivePct = n === 0 ? 0 : round((passives / n) * 100, 1);
  const detractorPct = n === 0 ? 0 : round((detractors / n) * 100, 1);

  return {
    n,
    promoterPct,
    passivePct,
    detractorPct,
    npsScore: round(promoterPct - detractorPct, 1),
    rawMean: n === 0 ? 0 : round(scores.reduce((a, b) => a + b, 0) / n),
  };
}
