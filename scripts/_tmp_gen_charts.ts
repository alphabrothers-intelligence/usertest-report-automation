import { renderQuadrantChart } from "../lib/charts/canvasCharts";
import { writeFileSync, readFileSync } from "fs";

type QuantChartInput = {
  relativeImportance: Array<{ name: string; score: number }>;
  featureSatisfaction: Array<{ name: string; mean: number }>;
};

const quant = JSON.parse(readFileSync("/tmp/hwpx_poc2/quant.json", "utf-8")) as QuantChartInput;
const ranked = [...quant.relativeImportance].sort((a, b) => b.score - a.score);
const satisfactionByName = new Map<string, number>(quant.featureSatisfaction.map((feature) => [feature.name, feature.mean]));

const chart = renderQuadrantChart(
  ranked.map((item) => ({ name: item.name, importance: item.score, satisfaction: satisfactionByName.get(item.name) ?? 0 })),
  920,
  880,
);
writeFileSync("/tmp/hwpx_poc2/quadrant.png", chart.buffer);
console.log("wrote quadrant.png", chart.width, chart.height, chart.buffer.length, "bytes");
