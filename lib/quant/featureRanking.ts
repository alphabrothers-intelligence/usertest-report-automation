/**
 * **"기능" 행을 만들 때의 유일한 기준.**
 *
 * `relativeImportance`는 raw data마다 **다른 것을 가리킨다** — 리바랩스는 기능 중요도 순위라
 * 기능명과 일치하지만, 케어클은 **핵심구매요소** 순위(사용 편의성·피부 개선 효과…)라 기능명
 * (SHOT·GLOW·EMS…)과 한 개도 안 겹친다. 그런데 Ⅸ장 요약 표·요약 재료·기능별 고객 제언 세
 * 곳이 전부 `relativeImportance`에서 행을 만들고 거기에 기능 만족도를 붙이고 있었다.
 * 그 결과 케어클 Ⅸ.1 표가 **구매요소 이름 + 만족도 0.00 + 비율 0.0%** 로 나갔다
 * (2026-09-11 실측).
 *
 * 그래서 행의 출처는 **항상 `featureSatisfaction`** 이고, 중요도는 **이름이 실제로 맞는
 * 항목에만** 붙인다. 하나도 안 맞으면 중요도는 없는 것으로 본다(열을 빼는 판단은 호출부 몫).
 */
import type { QuantStats } from "@/lib/quant/compute";

export type RankedFeature = {
  name: string;
  mean: number;
  sd: number;
  /** 이름이 맞는 상대중요도. 없으면 null — 0으로 채우면 없는 값을 말하는 셈이 된다. */
  importance: number | null;
};

export function rankedFeatures(stats: QuantStats): RankedFeature[] {
  const importanceByName = new Map(stats.relativeImportance.map((item) => [item.name, item.score]));
  // 같은 기능명이 여러 컬럼에 걸친 raw data가 있다(이젠오토 "셀프 정비 콘텐츠" 3개).
  // 그대로 두면 같은 행이 반복되므로 이름으로 합친다.
  const byName = new Map<string, RankedFeature>();
  for (const feature of stats.featureSatisfaction) {
    if (byName.has(feature.name)) continue;
    byName.set(feature.name, {
      name: feature.name,
      mean: feature.mean,
      sd: feature.sd,
      importance: importanceByName.get(feature.name) ?? null,
    });
  }
  const rows = [...byName.values()];
  // 중요도가 있으면 그 순서(원본 보고서 기준), 없으면 만족도 내림차순.
  return rows.some((row) => row.importance !== null)
    ? rows.sort((a, b) => (b.importance ?? -Infinity) - (a.importance ?? -Infinity))
    : rows.sort((a, b) => b.mean - a.mean);
}

/** 이 데이터에서 "상대중요도" 열·문구를 쓸 수 있는가. 기능명과 맞는 항목이 하나라도 있어야 한다. */
export function hasFeatureImportance(stats: QuantStats): boolean {
  return rankedFeatures(stats).some((row) => row.importance !== null);
}
