import type { CategoryCount } from "@/lib/quant/basic";
import { computeBarWithAverageRange } from "@/lib/report/chartAxis";
import { chartBlock } from "@/lib/report/sections";

export function workspaceSlug(label: string): string {
  return label.replace(/\s+/g, "-").replace(/[^\w가-힣-]/g, "");
}

export function distributionChart(id: string, title: string, counts: CategoryCount[]): ReturnType<typeof chartBlock> {
  const items = counts.map((count) => ({ id: workspaceSlug(count.label), label: count.label, value: count.percentage }));
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
  const values = items.map((item) => item.mean);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const [axisMin, axisMax] = computeBarWithAverageRange(values, average);
  return chartBlock({
    id,
    title,
    unit,
    axisMin,
    axisMax,
    items: items.map((item) => ({ id: workspaceSlug(item.name), label: item.name, value: item.mean })),
  });
}
