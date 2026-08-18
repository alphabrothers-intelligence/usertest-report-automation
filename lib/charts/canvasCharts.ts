// 캔버스 기반 차트 렌더러(2026-07-23) — SVG 문자열(lib/docx/svgCharts.ts, 이전 방식)이 텍스트
// 폭을 estimateTextWidth()로 "추측"해야 했던 근본 문제를 해결한다. @napi-rs/canvas는 실제
// 폰트로 캔버스에 그리는 진짜 Canvas 2D 구현이라 `ctx.measureText()`로 **정확한** 텍스트 폭을
// 알 수 있다 — 그래서 사분면 그래프처럼 라벨이 계속 삐져나오던 차트도 추측이 아니라 실측값
// 기준으로 줄바꿈을 결정한다. 폰트는 이 프로젝트가 이미 쓰는 NotoSansKR WOFF를
// GlobalFonts.registerFromPath로 직접 등록한다(react-pdf의 lib/pdf/fonts.ts와 같은 원칙 —
// 시스템 폰트에 의존하지 않아 어떤 배포 환경에서도 동일하게 렌더링된다, 2026-07-23 로컬 실측
// 확인).
//
// DOCX(lib/docx/ReportDocx.ts)가 이 모듈을 전면적으로 쓴다. PDF는 사분면 그래프
// (ImportanceSatisfactionChart, 라벨 오버플로우가 가장 심했던 차트) 하나만 시험 삼아 이
// 방식으로 바꿔서 기존 SVG 기반 방식과 비교해볼 수 있게 했다(2026-07-23 사용자 요청 — "PDF는
// 예시를 보고 채택 여부 결정") — 다른 PDF 차트(막대·레이더 등)는 아직 손대지 않았다.
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import path from "node:path";

let fontsRegistered = false;
function ensureFonts(): void {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  GlobalFonts.registerFromPath(path.join(dir, "NotoSansKR-Regular.woff"), "NotoSansKR");
  GlobalFonts.registerFromPath(path.join(dir, "NotoSansKR-Bold.woff"), "NotoSansKR");
  fontsRegistered = true;
}

export interface CanvasChart {
  buffer: Buffer;
  width: number;
  height: number;
}

// 2x 오버샘플링 — 좌표 계산은 전부 "포인트" 단위 그대로 하고 캔버스 자체만 2배로 만들어
// ctx.scale(2,2)로 보정한다. 화면(문서)에 보일 물리적 크기는 width/height(포인트)를 그대로
// 쓰고, 픽셀 밀도만 높아져 선명해진다(react-pdf Image는 pt를 그대로 쓰고, DOCX는 pt→px 96/72
// 환산은 호출부에서 처리한다).
const SCALE = 2;

function makeCanvas(width: number, height: number): { ctx: SKRSContext2D; finish: () => CanvasChart } {
  ensureFonts();
  const canvas = createCanvas(Math.ceil(width * SCALE), Math.ceil(height * SCALE));
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { ctx, finish: () => ({ buffer: canvas.toBuffer("image/png"), width, height }) };
}

// 원본 발행 PDF 픽셀 샘플링 값(2026-07-22) — react-pdf theme.ts와 동일하게 유지한다.
export const colors = {
  navy: "#315c9c",
  navyLight: "#5c73aa",
  chartBannerBg: "#c0cdef",
  teal: "#90f7d5", // 응답 결과 막대 민트그린(원본 실측)
  tealDark: "#159a78",
  red: "#ef4444",
  text: "#18181b",
  subtext: "#52525b",
  border: "#d4d4d8",
  bgAlt: "#f4f4f5",
  white: "#ffffff",
};

export const GROUP_SERIES_PALETTE = ["#7fa6e0", "#f2b880", "#e8d97a", "#93cf8f", "#c99ee0", "#e88a9a"];
export const COMPOSITION_PALETTE = [
  "#ef4444",
  "#0d9488",
  "#3b82f6",
  "#84cc16",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#64748b",
];

function niceStep(max: number): number {
  if (max <= 0) return 1;
  const rough = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * magnitude;
}

function drawBanner(ctx: SKRSContext2D, title: string, width: number): void {
  ctx.fillStyle = colors.chartBannerBg;
  ctx.fillRect(0, 0, width, 20);
  ctx.fillStyle = colors.navy;
  ctx.font = "bold 10px NotoSansKR";
  ctx.textAlign = "center";
  ctx.fillText(title, width / 2, 14);
}

/** 세로쓰기 축 제목 — **실측 버그(2026-07-23, 사용자 재현)**: `ctx.rotate()`로 텍스트를 진짜
 * 90도 회전시키면 "만족도" 같은 한글 글자가 완전히 다른 글자처럼 깨져 나온다는 게
 * @napi-rs/canvas(Skia 기반)에서 확인됐다 — 회전 없이 그대로 그리면 정상인데 회전만 시키면
 * 깨진다(최소 재현 스크립트로 확인). react-pdf의 `transform:"rotate()"`가 똑같은 부류의
 * 문제를 겪어서(CLAUDE.md 기록: "세로쓰기는 글자를 한 자씩 개별 Text로 줄바꿈해 쌓는 방식이
 * 훨씬 안정적") 이미 이 프로젝트가 검증해둔 해법이 있다 — 렌더러(react-pdf/캔버스)가 달라도
 * "진짜 회전 텍스트는 못 믿는다"는 교훈은 그대로 적용된다. 진짜로 회전시키는 대신 글자를
 * 한 자씩 세로로 쌓아서 그린다.
 */
function drawVerticalText(
  ctx: SKRSContext2D,
  text: string,
  cx: number,
  cy: number,
  fontSize: number,
  color: string,
  bold = false,
): void {
  ctx.save();
  ctx.font = `${bold ? "bold " : ""}${fontSize}px NotoSansKR`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  const lineHeight = fontSize + 2;
  const chars = [...text].filter((c) => c !== " ");
  let y = cy - (chars.length * lineHeight) / 2 + lineHeight / 2 + fontSize / 2 - 1;
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    y += lineHeight;
  }
  ctx.restore();
}

// ── 세로 막대그래프 ──────────────────────────────────────────────────────
export function renderVerticalBarChart(
  items: { label: string; value: number }[],
  max: number,
  unit = "",
  title = "[ 응답 결과 ]",
): CanvasChart {
  const width = 460;
  const chartHeight = 240;
  const marginLeft = 46;
  const marginTop = 34;
  const marginBottom = 38;
  const plotWidth = width - marginLeft - 10;
  const height = marginTop + chartHeight + marginBottom;
  const { ctx, finish } = makeCanvas(width, height);

  const dataMax = Math.max(...items.map((i) => i.value), 0);
  const zoomedMax = Math.min(max, dataMax > 0 ? dataMax : max);
  const step = niceStep(Math.max(zoomedMax, 0.1));
  const topGridValue = Math.min(max, Math.ceil(zoomedMax / step) * step + step);
  const gridValues: number[] = [];
  for (let v = 0; v <= topGridValue + 1e-6; v += step) gridValues.push(v);

  drawBanner(ctx, title, width);
  const barSlot = plotWidth / items.length;
  const barWidth = barSlot * 0.55;

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.5;
  ctx.font = "8px NotoSansKR";
  ctx.fillStyle = colors.subtext;
  ctx.textAlign = "right";
  for (const v of gridValues) {
    const y = marginTop + chartHeight - (v / topGridValue) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(marginLeft, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(v)}${unit}`, marginLeft - 6, y + 3);
  }

  items.forEach((item, i) => {
    const barHeight = topGridValue === 0 ? 0 : Math.max(0, Math.min(1, item.value / topGridValue)) * chartHeight;
    const x = marginLeft + i * barSlot + (barSlot - barWidth) / 2;
    const y = marginTop + chartHeight - barHeight;
    ctx.fillStyle = colors.teal;
    ctx.fillRect(x, y, barWidth, Math.max(1, barHeight));
    ctx.fillStyle = colors.text;
    ctx.font = "bold 9px NotoSansKR";
    ctx.textAlign = "center";
    ctx.fillText(`${item.value}${unit}`, x + barWidth / 2, y - 4);
    ctx.font = "7.5px NotoSansKR";
    ctx.fillText(item.label, x + barWidth / 2, marginTop + chartHeight + 14);
  });
  return finish();
}

// ── 세로 막대그래프 + 전체 평균선 ────────────────────────────────────────
export function renderVerticalBarChartWithAverage(
  items: { label: string; value: number }[],
  min: number,
  max: number,
  unit: string,
  title: string,
  average: number,
  yAxisTitle?: string,
): CanvasChart {
  const width = 460;
  const chartHeight = 240;
  const marginLeft = yAxisTitle ? 56 : 46;
  const marginTop = 34;
  const marginBottom = 44;
  const plotWidth = width - marginLeft - 10;
  const height = marginTop + chartHeight + marginBottom;
  const { ctx, finish } = makeCanvas(width, height);

  const range = max - min || 1;
  const step = niceStep(range);
  const gridValues: number[] = [];
  for (let v = min; v <= max + 1e-6; v += step) gridValues.push(Math.round(v * 100) / 100);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const barSlot = plotWidth / sorted.length;
  const barWidth = barSlot * 0.55;
  const avgY = marginTop + chartHeight - ((average - min) / range) * chartHeight;

  drawBanner(ctx, title, width);

  ctx.font = "8px NotoSansKR";
  ctx.fillStyle = colors.teal;
  ctx.fillRect(marginLeft - 40, marginTop, 12, 12);
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.fillText("개별 값", marginLeft - 24, marginTop + 10);
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(marginLeft + 70, marginTop + 6);
  ctx.lineTo(marginLeft + 90, marginTop + 6);
  ctx.stroke();
  ctx.fillText(`전체 평균 ${average}${unit}`, marginLeft + 94, marginTop + 10);

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = colors.subtext;
  ctx.textAlign = "right";
  for (const v of gridValues) {
    const y = marginTop + chartHeight - ((v - min) / range) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(marginLeft, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();
    ctx.fillText(`${v}${unit}`, marginLeft - 6, y + 3);
  }

  sorted.forEach((item, i) => {
    const barHeight = Math.max(0, Math.min(1, (item.value - min) / range)) * chartHeight;
    const x = marginLeft + i * barSlot + (barSlot - barWidth) / 2;
    const y = marginTop + chartHeight - barHeight;
    ctx.fillStyle = colors.teal;
    ctx.fillRect(x, y, barWidth, Math.max(1, barHeight));
    ctx.fillStyle = colors.text;
    ctx.font = "bold 9px NotoSansKR";
    ctx.textAlign = "center";
    ctx.fillText(String(item.value), x + barWidth / 2, y - 4);
    ctx.font = "7.5px NotoSansKR";
    ctx.fillText(item.label, x + barWidth / 2, marginTop + chartHeight + 14);
  });

  // 평균선은 막대보다 나중에 그려서 위에 보이게 한다(PDF와 같은 순서 원칙).
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(marginLeft, avgY);
  ctx.lineTo(width - 10, avgY);
  ctx.stroke();

  if (yAxisTitle) {
    drawVerticalText(ctx, yAxisTitle, 14, marginTop + chartHeight / 2, 8, colors.subtext);
  }
  return finish();
}

// ── 레이더 차트 ────────────────────────────────────────────────────────
function radarGeometry(ctx: SKRSContext2D, n: number, size: number, labels: string[], fontSize = 8) {
  const radius = size / 2 - 10;
  ctx.font = `${fontSize}px NotoSansKR`;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const lx = radius * 1.28 * Math.cos(angle);
    const ly = radius * 1.28 * Math.sin(angle);
    const w = ctx.measureText(labels[i] ?? "").width;
    const isMiddle = Math.abs(lx) < 4;
    mx = Math.max(mx, Math.abs(lx) + (isMiddle ? w / 2 : w) - size / 2);
    my = Math.max(my, Math.abs(ly) + fontSize - size / 2);
  }
  mx = Math.max(14, Math.ceil(mx) + 6);
  my = Math.max(14, Math.ceil(my) + 6);
  return { radius, canvasWidth: size + mx * 2, canvasHeight: size + my * 2 };
}

export function renderRadarChart(
  axes: { label: string; value: number }[],
  min: number,
  max: number,
  gridLevels: number,
  size = 200,
  color = colors.tealDark,
): CanvasChart {
  const n = axes.length;
  if (n < 3) return { buffer: Buffer.alloc(0), width: 1, height: 1 };
  // 측정용 임시 캔버스(여백 계산에 실제 폰트 메트릭이 필요해서 캔버스를 먼저 하나 만든다).
  const probe = makeCanvas(10, 10);
  const { canvasWidth, canvasHeight, radius } = radarGeometry(probe.ctx, n, size, axes.map((a) => a.label));

  const { ctx, finish } = makeCanvas(canvasWidth, canvasHeight);
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pointFor = (i: number, frac: number) => {
    const a = angleFor(i);
    const r = radius * frac;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const valueFrac = (v: number) => (max === min ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min))));

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.6;
  for (let level = 1; level <= gridLevels; level++) {
    const frac = level / gridLevels;
    ctx.beginPath();
    axes.forEach((_, i) => {
      const p = pointFor(i, frac);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  axes.forEach((_, i) => {
    const p = pointFor(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  const dataPts = axes.map((a, i) => pointFor(i, valueFrac(a.value)));
  ctx.beginPath();
  dataPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = color + "59"; // ~35% opacity
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = color;
  dataPts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.font = "8px NotoSansKR";
  ctx.fillStyle = colors.text;
  axes.forEach((a, i) => {
    const lp = pointFor(i, 1.28);
    ctx.textAlign = Math.abs(lp.x - cx) < 4 ? "center" : lp.x > cx ? "left" : "right";
    ctx.fillText(a.label, lp.x, lp.y);
  });
  return finish();
}

export function renderRadarOverlay(
  axes: string[],
  series: { name: string; color: string; values: number[] }[],
  min: number,
  max: number,
  gridLevels: number,
  size = 200,
): CanvasChart {
  const n = axes.length;
  if (n < 3) return { buffer: Buffer.alloc(0), width: 1, height: 1 };
  const probe = makeCanvas(10, 10);
  const { canvasWidth, canvasHeight, radius } = radarGeometry(probe.ctx, n, size, axes);
  const legendHeight = 24;

  const { ctx, finish } = makeCanvas(canvasWidth, canvasHeight + legendHeight);
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pointFor = (i: number, frac: number) => {
    const a = angleFor(i);
    const r = radius * frac;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const valueFrac = (v: number) => (max === min ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min))));

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.6;
  for (let level = 1; level <= gridLevels; level++) {
    const frac = level / gridLevels;
    ctx.beginPath();
    axes.forEach((_, i) => {
      const p = pointFor(i, frac);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  axes.forEach((_, i) => {
    const p = pointFor(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  for (const s of series) {
    ctx.beginPath();
    axes.forEach((_, i) => {
      const p = pointFor(i, valueFrac(s.values[i] ?? min));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = s.color + "2e"; // ~18%
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ctx.font = "8px NotoSansKR";
  ctx.fillStyle = colors.text;
  axes.forEach((label, i) => {
    const lp = pointFor(i, 1.28);
    ctx.textAlign = Math.abs(lp.x - cx) < 4 ? "center" : lp.x > cx ? "left" : "right";
    ctx.fillText(label, lp.x, lp.y);
  });

  const legendY = canvasHeight + 14;
  let lx = cx - (series.length * 90) / 2;
  ctx.textAlign = "left";
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, legendY - 9, 9, 9);
    ctx.fillStyle = colors.text;
    ctx.fillText(s.name, lx + 13, legendY);
    lx += 90;
  }
  return finish();
}

// ── 클러스터 세로 막대그래프 ──────────────────────────────────────────────
export function renderGroupedBarChart(
  categories: string[],
  series: { name: string; color: string; values: number[] }[],
  min: number,
  max: number,
  unit = "",
): CanvasChart {
  const width = 460;
  const chartHeight = 220;
  const marginLeft = 46;
  const marginTop = 26;
  const marginBottom = 44;
  const plotWidth = width - marginLeft - 10;
  const height = marginTop + chartHeight + marginBottom;
  const { ctx, finish } = makeCanvas(width, height);
  const range = max - min || 1;
  const step = niceStep(range);
  const gridValues: number[] = [];
  for (let v = min; v <= max + 1e-6; v += step) gridValues.push(Math.round(v * 100) / 100);

  const groupSlot = plotWidth / categories.length;
  const barWidth = (groupSlot * 0.7) / series.length;

  ctx.font = "8px NotoSansKR";
  ctx.textAlign = "left";
  let lx = width / 2 - (series.length * 80) / 2;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 6, 9, 9);
    ctx.fillStyle = colors.text;
    ctx.fillText(s.name, lx + 13, 14);
    lx += 80;
  }

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = colors.subtext;
  ctx.textAlign = "right";
  for (const v of gridValues) {
    const y = marginTop + chartHeight - ((v - min) / range) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(marginLeft, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();
    ctx.fillText(`${v}${unit}`, marginLeft - 6, y + 3);
  }

  categories.forEach((cat, ci) => {
    const groupX = marginLeft + ci * groupSlot + (groupSlot - barWidth * series.length) / 2;
    series.forEach((s, si) => {
      const value = s.values[ci] ?? min;
      const frac = Math.max(0, Math.min(1, (value - min) / range));
      const barHeight = frac * chartHeight;
      const x = groupX + si * barWidth;
      const y = marginTop + chartHeight - barHeight;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y, barWidth - 1, Math.max(1, barHeight));
      ctx.fillStyle = colors.text;
      ctx.font = "bold 6.5px NotoSansKR";
      ctx.textAlign = "center";
      ctx.fillText(String(value), x + barWidth / 2, y - 3);
    });
    ctx.font = "7.5px NotoSansKR";
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    ctx.fillText(cat, groupX + (barWidth * series.length) / 2, marginTop + chartHeight + 14);
  });
  return finish();
}

// ── 순위 구성비 가로 누적 막대 ─────────────────────────────────────────────
export function renderRankComposition(
  compositions: { rank: number; segments: { name: string; percentage: number }[] }[],
  candidateNames: string[],
): CanvasChart {
  const width = 460;
  const rowHeight = 20;
  const marginLeft = 36;
  const marginTop = 30;
  const plotWidth = width - marginLeft - 10;
  const height = marginTop + compositions.length * rowHeight + 20;
  const { ctx, finish } = makeCanvas(width, height);
  const colorFor = (name: string) => COMPOSITION_PALETTE[candidateNames.indexOf(name) % COMPOSITION_PALETTE.length];

  ctx.font = "7px NotoSansKR";
  let lx = 10;
  let ly = 12;
  ctx.textAlign = "left";
  for (const name of candidateNames) {
    const w = 11 + ctx.measureText(name).width + 14;
    if (lx + w > width - 10) {
      lx = 10;
      ly += 12;
    }
    ctx.fillStyle = colorFor(name);
    ctx.fillRect(lx, ly - 8, 8, 8);
    ctx.fillStyle = colors.text;
    ctx.fillText(name, lx + 11, ly);
    lx += w;
  }

  const bodyTop = ly + 10;
  compositions.forEach((comp, i) => {
    const y = bodyTop + i * rowHeight;
    ctx.fillStyle = colors.text;
    ctx.textAlign = "right";
    ctx.fillText(`${comp.rank}위`, marginLeft - 6, y + rowHeight / 2 + 3);
    let x = marginLeft;
    for (const seg of comp.segments) {
      const segWidth = (seg.percentage / 100) * plotWidth;
      ctx.fillStyle = colorFor(seg.name);
      ctx.fillRect(x, y + 2, segWidth, rowHeight - 6);
      x += segWidth;
    }
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(marginLeft, y + 2, plotWidth, rowHeight - 6);
  });
  return { buffer: finish().buffer, width, height: bodyTop + compositions.length * rowHeight + 10 };
}

// ── 성별×연령대 교차표 가로 누적 막대 ───────────────────────────────────────
export function renderCrossTabStackedBar(
  rows: { label: string; segments: { name: string; count: number }[] }[],
  categories: string[],
  maxValue: number,
  unit = "명",
): CanvasChart {
  const width = 440;
  const rowHeight = 22;
  const marginLeft = 36;
  const marginTop = 20;
  const plotWidth = width - marginLeft - 10;
  const height = marginTop + rows.length * rowHeight + 16;
  const { ctx, finish } = makeCanvas(width, height);
  const colorFor = (name: string) => COMPOSITION_PALETTE[categories.indexOf(name) % COMPOSITION_PALETTE.length];

  ctx.font = "7px NotoSansKR";
  ctx.textAlign = "left";
  let lx = 10;
  for (const name of categories) {
    ctx.fillStyle = colorFor(name);
    ctx.fillRect(lx, 4, 8, 8);
    ctx.fillStyle = colors.text;
    ctx.fillText(name, lx + 11, 12);
    lx += 11 + ctx.measureText(name).width + 14;
  }

  rows.forEach((row, i) => {
    const y = marginTop + i * rowHeight;
    ctx.fillStyle = colors.text;
    ctx.textAlign = "right";
    ctx.fillText(row.label, marginLeft - 6, y + rowHeight / 2 + 3);
    let x = marginLeft;
    for (const seg of row.segments) {
      if (seg.count <= 0) continue;
      const segWidth = (seg.count / maxValue) * plotWidth;
      ctx.fillStyle = colorFor(seg.name);
      ctx.fillRect(x, y + 3, segWidth, rowHeight - 8);
      if (segWidth > 16) {
        ctx.fillStyle = colors.white;
        ctx.font = "7px NotoSansKR";
        ctx.textAlign = "center";
        ctx.fillText(`${seg.count}${unit}`, x + segWidth / 2, y + rowHeight / 2 + 3);
        ctx.textAlign = "right";
      }
      x += segWidth;
    }
  });
  return finish();
}

// ── 중요도-만족도 사분면 산점도 ──────────────────────────────────────────────
const PRIORITY_LEVELS = [
  { score: 2, color: "#f8cbad" },
  { score: 1, color: "#fce4d6" },
  { score: 0, color: "#ffffff" },
  { score: -1, color: "#d9e1f2" },
  { score: -2, color: "#b4c6e7" },
];

export function renderQuadrantChart(
  items: { name: string; importance: number; satisfaction: number }[],
  width = 460,
  height = 440,
): CanvasChart {
  const { ctx, finish } = makeCanvas(width, height);
  const marginLeft = 40;
  const marginTop = 16;
  const marginBottom = 34;
  const marginRight = 14;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  const [xMin, xMax] = [-5, 5];
  const [yMin, yMax] = [0, 10];
  const xScale = (v: number) => marginLeft + ((v - xMin) / (xMax - xMin)) * plotWidth;
  const yScale = (v: number) => marginTop + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  const colBands = [
    { x0: xMin, x1: -2, score: 0 },
    { x0: -2, x1: 2, score: 1 },
    { x0: 2, x1: xMax, score: 2 },
  ];
  const rowBands = [
    { y0: 8, y1: yMax, score: 0 },
    { y0: 6, y1: 8, score: 1 },
    { y0: yMin, y1: 6, score: 2 },
  ];
  for (const col of colBands) {
    for (const row of rowBands) {
      const score = col.score + row.score - 2;
      const level = PRIORITY_LEVELS.find((p) => p.score === score)!;
      ctx.fillStyle = level.color;
      const x = xScale(col.x0);
      const y = yScale(row.y1);
      const w = xScale(col.x1) - xScale(col.x0);
      const h = yScale(row.y0) - yScale(row.y1);
      ctx.fillRect(x, y, w, h);
    }
  }

  ctx.strokeStyle = "#9a9a9a";
  ctx.lineWidth = 0.4;
  ctx.font = "7px NotoSansKR";
  ctx.fillStyle = colors.text;
  for (let v = xMin; v <= xMax; v++) {
    ctx.beginPath();
    ctx.moveTo(xScale(v), marginTop);
    ctx.lineTo(xScale(v), height - marginBottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(String(v), xScale(v), height - marginBottom + 12);
  }
  for (let v = yMin; v <= yMax; v++) {
    ctx.beginPath();
    ctx.moveTo(marginLeft, yScale(v));
    ctx.lineTo(width - marginRight, yScale(v));
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(String(v), marginLeft - 6, yScale(v) + 3);
  }
  // 중앙(상대 중요도 0) 세로선 — 중요도 양/음 기준선이라 다른 격자선보다 약간 굵게 긋되,
  // 너무 진하지 않은 중간 회색으로 둔다(2026-07-22 "굵은 선이 너무 짙다, 옅게" 재요청).
  ctx.strokeStyle = "#8a8a8a";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(xScale(0), marginTop);
  ctx.lineTo(xScale(0), height - marginBottom);
  ctx.stroke();

  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 1;
  ctx.strokeRect(marginLeft, marginTop, plotWidth, plotHeight);

  // **핵심 개선**: SVG 버전은 estimateTextWidth()로 폭을 "추측"했지만, 여기는 실제 캔버스
  // 폰트로 ctx.measureText()를 불러 정확한 값을 쓴다 — 그래서 긴 기능명도 실측 기준으로
  // 정확히 줄바꿈되고, 칸을 벗어나는 일이 구조적으로 없다.
  const cellWidth = plotWidth / (xMax - xMin);
  const maxLineWidth = cellWidth * 0.85;
  const lineHeight = 8;
  ctx.font = "bold 7px NotoSansKR";
  function wrapLabel(name: string): string[] {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines: string[] = [];
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (ctx.measureText(candidate).width > maxLineWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
    return lines;
  }

  // **실측 버그(2026-07-23, 사용자 재현)**: "가운데 아니면 바로 아래" 두 자리만 시도하는
  // 방식은 항목 2개가 겹칠 때만 통한다 — 값이 비슷한 기능이 3개 이상 몰리면(예: 여러 기능의
  // 중요도·만족도가 다 6점대로 비슷한 실제 데이터) 전부 같은 두 자리를 놓고 다투다 결국
  // 겹쳐서 글자가 뭉개진다(스트레스 테스트로 재현: 클러스터 6개 중 4개가 같은 자리에 겹침).
  // **해결**: 겹치면 자리를 딱 한 번 바꾸는 게 아니라, 겹치지 않을 때까지 계속 아래로
  // 밀어내는 방식으로 바꿨다 — 항목이 몇 개가 몰리든 결국 세로로 쌓여서 절대 겹치지 않는다
  // (대신 몰린 항목일수록 원래 데이터 위치에서 세로로 조금 멀어질 수 있다는 트레이드오프는
  // 감수한다 — 안 겹치는 게 우선이다). 위쪽(만족도 높은) 항목부터 순서대로 배치해서, 나중에
  // 처리되는 항목이 이미 배치된 것들을 피해 아래로 밀려나는 식으로 안정적으로 수렴한다.
  // **라벨을 데이터가 속한 격자 "칸의 중앙"에 스냅한다(2026-07-22, 사용자 명시 요청 —
  // "가장 가까운 칸으로 텍스트를 넣어볼까요?").** 예전엔 정확한 좌표(예: importance=0.23)에
  // 중심을 둬서 세로 격자선(x=0)을 걸쳐 텍스트가 칸 경계를 넘어 보였다. 칸 중앙(예: 0→0.5,
  // -2.58→-2.5)에 두면 라벨이 항상 한 칸 안에 깔끔히 들어간다. wrapLabel이 칸 폭(cellWidth*
  // 0.85)에 맞춰 줄바꿈하므로 칸을 넘지 않는다.
  const cellCenter = (v: number, lo: number, hi: number) =>
    Math.max(lo + 0.5, Math.min(hi - 0.5, Math.floor(v) + 0.5));
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const overlap = (a: (typeof placed)[number], b: (typeof placed)[number]) =>
    a.x0 - 2 < b.x1 && a.x1 + 2 > b.x0 && a.y0 - 1 < b.y1 && a.y1 + 1 > b.y0;
  ctx.textAlign = "center";
  const order = [...items].sort((a, b) => yScale(a.satisfaction) - yScale(b.satisfaction));
  const cellH = plotHeight / (yMax - yMin); // 한 칸 세로 픽셀 — 겹칠 때 한 칸씩 이동
  for (const it of order) {
    const px = xScale(cellCenter(it.importance, xMin, xMax));
    const py = yScale(cellCenter(it.satisfaction, yMin, yMax));
    const lines = wrapLabel(it.name);
    const halfW = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) / 2 : 0;
    const halfH = ((lines.length - 1) / 2) * lineHeight + lineHeight / 2;
    const bboxAt = (centerY: number) => ({
      x0: px - halfW,
      x1: px + halfW,
      y0: centerY - halfH,
      y1: centerY + halfH,
    });
    // 같은 칸에 두 항목이 겹치면(다른 raw data에서 가능) 한 칸씩 위/아래로 밀어 가장 가까운
    // 빈 칸을 찾는다 — 플롯 세로 경계 안으로 clamp.
    const topLimit = marginTop + halfH + 1;
    const botLimit = marginTop + plotHeight - halfH - 1;
    const fits = (cy: number) => cy >= topLimit && cy <= botLimit && !placed.some((p) => overlap(bboxAt(cy), p));
    let centerY = py;
    if (!fits(centerY)) {
      let best: number | null = null;
      for (let k = 1; k <= yMax - yMin; k++) {
        for (const cand of [py + k * cellH, py - k * cellH]) {
          if (fits(cand)) {
            best = cand;
            break;
          }
        }
        if (best !== null) break;
      }
      centerY = best ?? Math.min(botLimit, Math.max(topLimit, py));
    }
    placed.push(bboxAt(centerY));
    const offsets = lines.map((_, li) => (li - (lines.length - 1) / 2) * lineHeight);
    lines.forEach((line, li) => ctx.fillText(line, px, centerY + offsets[li]));
  }

  drawVerticalText(ctx, "만족도", marginLeft - 28, marginTop + plotHeight / 2, 8, colors.subtext, true);
  ctx.save();
  ctx.font = "bold 8px NotoSansKR";
  ctx.fillStyle = colors.subtext;
  ctx.textAlign = "center";
  ctx.fillText("상대 중요도", marginLeft + plotWidth / 2, height - 4);
  ctx.restore();

  return finish();
}

