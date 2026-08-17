import type { CategoryCount } from "@/lib/quant/basic";
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
  return chartBlock({
    id,
    title,
    unit,
    items: items.map((item) => ({ id: workspaceSlug(item.name), label: item.name, value: item.mean })),
  });
}
