import { renderQuadrantChart } from "../lib/charts/canvasCharts";
import { writeFileSync, readFileSync } from "fs";

const quant = JSON.parse(readFileSync("/tmp/hwpx_poc2/quant.json", "utf-8"));
const ranked = [...quant.relativeImportance].sort((a: any, b: any) => b.score - a.score);
const satisfactionByName = new Map(quant.featureSatisfaction.map((f: any) => [f.name, f.mean]));

const chart = renderQuadrantChart(
  ranked.map((r: any) => ({ name: r.name, importance: r.score, satisfaction: satisfactionByName.get(r.name) ?? 0 })),
  920,
  880,
);
writeFileSync("/tmp/hwpx_poc2/quadrant.png", chart.buffer);
console.log("wrote quadrant.png", chart.width, chart.height, chart.buffer.length, "bytes");
