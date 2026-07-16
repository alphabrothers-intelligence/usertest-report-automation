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

export interface CategoryCount {
  label: string;
  count: number;
  percentage: number;
}

export function categoryDistribution(values: (string | null)[]): CategoryCount[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const v of values) {
    if (v === null || v === "") continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    total += 1;
  }
  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percentage: total === 0 ? 0 : round((count / total) * 100, 1),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 핵심구매요소 상대중요도 산출식 (PRD 6.8절, raw data 역산으로 확정).
 * 개인별 점수 = (후보 항목 수 + 1) − 2 × 응답자가 매긴 순위
 * 상대중요도(항목별) = 전체 응답자의 개인별 점수 평균
 */
export function relativeImportance(
  rankRows: string[][], // 응답자별 [1위,2위,...,n위] 항목명 배열
  candidateNames: string[],
): { name: string; score: number }[] {
  const candidateCount = candidateNames.length;
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const ranks of rankRows) {
    ranks.forEach((name, i) => {
      if (!name) return;
      const rank = i + 1;
      const points = candidateCount + 1 - 2 * rank;
      totals.set(name, (totals.get(name) ?? 0) + points);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
  }

  return candidateNames.map((name) => {
    const total = totals.get(name) ?? 0;
    const count = counts.get(name) ?? 0;
    return { name, score: count === 0 ? 0 : round(total / count) };
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
