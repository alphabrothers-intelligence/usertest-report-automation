import type { CategoryCount } from "@/lib/quant/basic";
import type { QuantStats } from "@/lib/quant/compute";
import { computeBarWithAverageRange } from "@/lib/report/chartAxis";
import { chartBlock, rankCompositionBlock, tableBlock, type ReportBlock } from "@/lib/report/sections";

export function workspaceSlug(label: string): string {
  return label.replace(/\s+/g, "-").replace(/[^\w가-힣-]/g, "");
}

/**
 * 차트 항목 id. **라벨이 겹쳐도 id는 겹치지 않게** 뒤에 순번을 붙인다.
 *
 * raw data에 같은 이름의 문항이 여러 개 들어 있는 경우가 실제로 있다 — 이젠오토는 설문
 * 작성자가 문항을 복사해 쓰고 이름을 안 고쳐서 `'셀프 정비 콘텐츠' 기능…` 문항이 4개다
 * (헤더에 `(copy)(copy)`가 그대로 남아 있다). 그대로 두면 React가 같은 key를 가진 자식을
 * 만나 **항목이 중복되거나 통째로 사라진다**(2026-08-28 이젠오토 화면에서 실제로 발생).
 *
 * 이름을 우리가 고쳐 붙이지는 않는다 — 중복은 raw data의 사실이고, 그것을 담당자에게 보여
 * 주는 것은 확인 카드의 몫이다. 여기서는 **화면이 깨지지 않게만** 한다.
 */
function uniqueItemIds(labels: string[]): string[] {
  const used = new Map<string, number>();
  return labels.map((label) => {
    const base = workspaceSlug(label);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  });
}

export function distributionChart(id: string, title: string, counts: CategoryCount[]): ReturnType<typeof chartBlock> {
  const ids = uniqueItemIds(counts.map((count) => count.label));
  const items = counts.map((count, index) => ({ id: ids[index], label: count.label, value: count.percentage }));
  const dataMax = Math.max(...items.map((item) => item.value), 0);
  const axisMax = Math.min(100, Math.ceil(dataMax / 5) * 5 + 5);
  return chartBlock({ id, title, unit: "%", axisMax, items });
}

export function meanChart(
  id: string,
  title: string,
  items: { name: string; mean: number }[],
  unit = "점",
): ReturnType<typeof chartBlock> {
  // **축 규칙은 PDF 렌더러와 같은 것을 쓴다**(`computeBarWithAverageRange`, lib/pdf/charts.tsx).
  // 예전엔 웹만 chartBlock 기본값(0부터 시작하는 niceAxisMax)을 써서, 같은 기능별 만족도가
  // 웹에서는 0~9점, PDF에서는 4~8점(원본과 동일)으로 다르게 보였다(2026-08-25 실측).
  // 원본은 정수 눈금의 넉넉한 축이다 — 최솟값 아래로 1점 내림, 최댓값 위로 1점 올림.
  const itemIds = uniqueItemIds(items.map((item) => item.name));
  const values = items.map((item) => item.mean);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const [axisMin, axisMax] = computeBarWithAverageRange(values, average);
  return chartBlock({
    id,
    title,
    unit,
    axisMin,
    axisMax,
    items: items.map((item, index) => ({ id: itemIds[index], label: item.name, value: item.mean })),
  });
}

/**
 * 중요도 순위 도표 한 벌(순위 구성 누적막대 + 순위 종합 표).
 *
 * **같은 raw data 안에서도 이 순위가 "기능"인지 "핵심구매요소"인지가 다르다**(케어클은
 * 구매요소, 리바랩스는 기능 — `lib/quant/featureRanking.ts` 주석). 그래서 어느 장이 이 도표를
 * 가져갈지는 호출부가 정하고, 그리는 방법은 여기 한 곳에 둔다 — 두 벌로 두면 한쪽만 고쳐진다.
 */
export function importanceRankBlocks(stats: QuantStats, params: {
  idPrefix: string;
  compositionTitle: string;
  tableTitle: string;
  itemHeader: string;
}): ReportBlock[] {
  const rankedImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const segmentNames = [...new Set(stats.rankPositionComposition.flatMap((row) => row.segments.map((segment) => segment.name)))];
  if (rankedImportance.length === 0 || stats.rankPositionComposition.length === 0) return [];
  const palette = ["#ff7b7b", "#58b1cf", "#9bcdb8", "#5fc5c1", "#c890d5", "#ffe39a", "#aeb8c8", "#f5ad80"];
  return [
    rankCompositionBlock({
      id: `${params.idPrefix}-rank-composition`,
      title: params.compositionTitle,
      candidates: segmentNames.map((name, index) => ({ name, color: palette[index % palette.length] })),
      rows: stats.rankPositionComposition.map((row) => ({
        rank: row.rank,
        segments: segmentNames.map((name) => ({ name, percentage: row.segments.find((segment) => segment.name === name)?.percentage ?? 0 })),
      })),
    }),
    tableBlock({
      id: `${params.idPrefix}-importance-table`,
      title: params.tableTitle,
      headers: ["순위", params.itemHeader, "상대 중요도"],
      rows: rankedImportance.map((item, index) => [`${index + 1}위`, item.name, item.score]),
    }),
  ];
}
