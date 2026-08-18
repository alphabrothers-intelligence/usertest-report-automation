/**
 * 리바랩스 원본 HWPX의 기능별 그래프 자산을 현재 DB 스냅샷으로 다시 그린다.
 *
 * 원본에서 image14~31은 기능 순서대로
 *   만족도 분포도 → 주요 키워드(워드클라우드) → 긍정/부정/중립 반원 도넛
 * 으로 배치되어 있다. 파일명과 가로세로 비율은 유지하고 그림 픽셀만 교체한다.
 * 이 스크립트는 분석을 다시 실행하지 않으며 input JSON만 읽는다.
 */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Polarity = "positive" | "negative" | "neutral";
type Category = { label: string; clauseCount: number; polarity: Polarity };
type FeaturePage = {
  sequence: number;
  feature: string;
  quantitative: { distribution: number[] };
  polarityAnalysis: null | {
    chart: { values: Array<{ label: string; count: number; percentage: number }> };
    groups: Array<{ polarity: Polarity; categories: Category[] }>;
  };
};
type ContentPlan = { featurePages: FeaturePage[] };

type AssetSlot = {
  binaryItemID: string;
  filename: string;
  kind: "histogram" | "wordcloud" | "donut";
  width: number;
  height: number;
};

const ASSET_SLOTS: AssetSlot[] = Array.from({ length: 6 }, (_, index) => {
  const image = 14 + index * 3;
  const donutHeight = index === 4 || index === 5 ? 3200 : 1600;
  const donutWidth = index === 4 ? 3116 : index === 5 ? 3048 : 2984;
  const slots: AssetSlot[] = [
    { binaryItemID: `image${image}`, filename: `image${image}.png`, kind: "histogram", width: 1664, height: 800 },
    { binaryItemID: `image${image + 1}`, filename: `image${image + 1}.png`, kind: "wordcloud", width: 1580, height: 1580 },
    { binaryItemID: `image${image + 2}`, filename: `image${image + 2}.png`, kind: "donut", width: donutWidth, height: donutHeight },
  ];
  return slots;
}).flat();

let fontRegistered = false;
function registerFont() {
  if (fontRegistered) return;
  const fontDir = path.join(process.cwd(), "public", "fonts");
  GlobalFonts.registerFromPath(path.join(fontDir, "NotoSansKR-Regular.woff"), "NotoSansKR");
  GlobalFonts.registerFromPath(path.join(fontDir, "NotoSansKR-Bold.woff"), "NotoSansKR");
  fontRegistered = true;
}

function canvas(width: number, height: number) {
  registerFont();
  const surface = createCanvas(width, height);
  const context = surface.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return { surface, context };
}

function drawHistogram(distribution: number[], width: number, height: number): Buffer {
  const { surface, context } = canvas(width, height);
  const margin = { left: width * 0.075, right: width * 0.035, top: height * 0.12, bottom: height * 0.19 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = Array.from({ length: 11 }, (_, index) => Math.max(0, distribution[index] ?? 0));
  const max = Math.max(5, ...values);
  const yMax = Math.ceil(max / 5) * 5;

  context.strokeStyle = "#d9e0e5";
  context.lineWidth = Math.max(1, width / 1100);
  context.font = `${Math.round(width / 42)}px NotoSansKR`;
  context.fillStyle = "#6b7280";
  context.textAlign = "right";
  for (let tick = 0; tick <= yMax; tick += Math.max(1, yMax / 5)) {
    const y = margin.top + plotHeight - (tick / yMax) * plotHeight;
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.stroke();
    context.fillText(String(tick), margin.left - width * 0.012, y + width / 120);
  }

  const slotWidth = plotWidth / values.length;
  values.forEach((value, index) => {
    const barWidth = slotWidth * 0.6;
    const x = margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const barHeight = (value / yMax) * plotHeight;
    const y = margin.top + plotHeight - barHeight;
    context.fillStyle = value === max ? "#078c44" : "#2ed6a4";
    context.fillRect(x, y, barWidth, Math.max(1, barHeight));
    context.fillStyle = "#334155";
    context.font = `bold ${Math.round(width / 40)}px NotoSansKR`;
    context.textAlign = "center";
    if (value > 0) context.fillText(String(value), x + barWidth / 2, y - height * 0.025);
    context.font = `${Math.round(width / 38)}px NotoSansKR`;
    context.fillText(String(index), x + barWidth / 2, height - margin.bottom + height * 0.09);
  });
  context.fillStyle = "#475569";
  context.font = `${Math.round(width / 38)}px NotoSansKR`;
  context.textAlign = "center";
  context.fillText("만족도 점수", width / 2, height - height * 0.035);
  return surface.toBuffer("image/png");
}

function textColor(index: number): string {
  return ["#4b55a3", "#3f9f8f", "#6e8d28", "#a0568d", "#1e7da8", "#b87721"][index % 6];
}

function drawWordCloud(categories: Category[], width: number, height: number): Buffer {
  const { surface, context } = canvas(width, height);
  const words = [...categories]
    .sort((a, b) => b.clauseCount - a.clauseCount || a.label.localeCompare(b.label, "ko"))
    // 템플릿의 정사각형 그림칸에 실제로 읽히는 밀도로 제한한다.
    // 많은 키워드를 억지로 넣어 서로 겹치게 하는 것보다, 상위 12개를 명확히 보이는 편이 낫다.
    .slice(0, 12);
  const max = Math.max(1, ...words.map((word) => word.clauseCount));
  const columns = 3;
  const rows = 4;
  words.forEach((word, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = width * ((column + 0.5) / columns);
    const y = height * ((row + 0.55) / rows);
    const fontSize = Math.round(width * (0.028 + (word.clauseCount / max) * 0.028));
    context.font = `${index < 4 ? "bold " : ""}${fontSize}px NotoSansKR`;
    context.fillStyle = textColor(index);
    context.textAlign = "center";
    // 셀 폭을 넘는 긴 카테고리명은 폰트를 줄여 같은 행에서만 렌더링한다.
    const maxWidth = width * 0.30;
    let adjustedSize = fontSize;
    while (adjustedSize > width * 0.014 && context.measureText(word.label).width > maxWidth) {
      adjustedSize -= 2;
      context.font = `${index < 4 ? "bold " : ""}${adjustedSize}px NotoSansKR`;
    }
    context.fillText(word.label, x, y);
  });
  return surface.toBuffer("image/png");
}

function drawDonut(values: Array<{ label: string; count: number; percentage: number }>, width: number, height: number): Buffer {
  const { surface, context } = canvas(width, height);
  const colors = ["#829ce7", "#ff944c", "#bdbdbd"];
  const cx = width * 0.38;
  const cy = height * 0.78;
  const outer = Math.min(width * 0.25, height * 0.57);
  const inner = outer * 0.57;
  const total = Math.max(1, values.reduce((sum, value) => sum + Math.max(0, value.count), 0));
  let angle = Math.PI;
  values.forEach((value, index) => {
    const fraction = Math.max(0, value.count) / total;
    const next = angle + fraction * Math.PI;
    context.beginPath();
    context.arc(cx, cy, outer, angle, next);
    context.arc(cx, cy, inner, next, angle, true);
    context.closePath();
    context.fillStyle = colors[index];
    context.fill();
    if (fraction >= 0.06) {
      const mid = (angle + next) / 2;
      const radius = (outer + inner) / 2;
      context.fillStyle = "#ffffff";
      context.font = `bold ${Math.round(width / 42)}px NotoSansKR`;
      context.textAlign = "center";
      context.fillText(`${(fraction * 100).toFixed(1)}%`, cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius + width / 120);
    }
    angle = next;
  });
  values.forEach((value, index) => {
    const x = width * 0.77;
    const y = height * (0.32 + index * 0.14);
    context.fillStyle = colors[index];
    context.fillRect(x, y - width * 0.015, width * 0.025, width * 0.025);
    context.fillStyle = "#475569";
    context.font = `${Math.round(width / 45)}px NotoSansKR`;
    context.textAlign = "left";
    context.fillText(value.label, x + width * 0.04, y + width * 0.006);
  });
  return surface.toBuffer("image/png");
}

function categoriesOf(page: FeaturePage): Category[] {
  return page.polarityAnalysis?.groups.flatMap((group) => group.categories) ?? [];
}

function chartValuesOf(page: FeaturePage) {
  return page.polarityAnalysis?.chart.values ?? [
    { label: "긍정", count: 0, percentage: 0 },
    { label: "부정", count: 0, percentage: 0 },
    { label: "중립", count: 0, percentage: 0 },
  ];
}

async function main() {
  const [inputPath, outputDir] = process.argv.slice(2);
  if (!inputPath || !outputDir) throw new Error("사용법: tsx render-rivalabs-db-chart-assets.ts <content-plan.json> <output-dir>");
  const plan = JSON.parse(await readFile(inputPath, "utf8")) as ContentPlan;
  if (plan.featurePages.length !== 6) throw new Error(`리바랩스 원본 그래프는 기능 6개가 필요합니다. 현재 ${plan.featurePages.length}개입니다.`);
  await mkdir(outputDir, { recursive: true });
  const assets: Array<AssetSlot & { feature: string }> = [];
  for (const page of plan.featurePages) {
    const slots = ASSET_SLOTS.slice((page.sequence - 1) * 3, page.sequence * 3);
    for (const slot of slots) {
      const buffer = slot.kind === "histogram"
        ? drawHistogram(page.quantitative.distribution, slot.width, slot.height)
        : slot.kind === "wordcloud"
          ? drawWordCloud(categoriesOf(page), slot.width, slot.height)
          : drawDonut(chartValuesOf(page), slot.width, slot.height);
      await writeFile(path.join(outputDir, slot.filename), buffer);
      assets.push({ ...slot, feature: page.feature });
    }
  }
  await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({
    source: inputPath,
    generatedAt: new Date().toISOString(),
    assets,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ outputDir, assets: assets.length }, null, 2));
}

void main();
