import type { QuantStats } from "@/lib/quant/compute";

/** 사분면이 성립하려면 **항목마다 상대중요도와 만족도가 둘 다** 있어야 한다. 최소 3개. */
export const MIN_QUADRANT_ITEMS = 3;

/**
 * 중요도-만족도 사분면(L6)에 찍을 점. **짝이 맞는 항목만** 돌려주고, 3개 미만이면 빈 배열이다.
 *
 * 순위 문항과 만족도 문항의 **항목이 서로 다른** raw data가 있다 — 케어클은 핵심구매요소가
 * 순위만, 기능이 만족도만 있고, 이젠오토는 순위 문항 자체가 없다. 그런 데이터에서 짝을 안
 * 맞추고 그리면 만족도가 전부 0이 되어 **점이 바닥에 깔린 가짜 사분면**이나 **점이 하나도 없는
 * 빈 격자**가 나온다(2026-08-28·31 담당자 지적). 원본 보고서에도 그 장에는 사분면이 없다.
 *
 * **조건은 여기 한 곳에만 둔다.** Ⅲ장(기능별)과 Ⅸ장(결과 요약)이 같은 사분면을 각자 그리는데,
 * 예전에는 Ⅲ장에만 가드가 있어서 Ⅸ장에 빈 격자가 남았다 — 같은 판정을 두 곳에 두면 반드시
 * 한쪽만 고치게 된다.
 */
export function quadrantItems(stats: QuantStats): { name: string; importance: number; satisfaction: number }[] {
  const items = [...stats.relativeImportance]
    .sort((a, b) => b.score - a.score)
    .map((item) => ({ item, feature: stats.featureSatisfaction.find((feature) => feature.name === item.name) }))
    .filter((pair) => pair.feature !== undefined)
    .map(({ item, feature }) => ({ name: item.name, importance: item.score, satisfaction: feature!.mean }));

  return items.length >= MIN_QUADRANT_ITEMS ? items : [];
}