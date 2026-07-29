/**
 * 웹 보고서와 PDF 렌더러가 공통으로 쓰는 SVG 차트 생성기.
 * 데이터 속성(data-report-chart)을 함께 넣어, 웹 편집기의 우측 패널에서
 * 본문에 포함된 차트도 원본 값·축·범례를 다시 편집할 수 있게 한다.
 */

export type PolarityKey = "positive" | "negative" | "neutral";

const POLARITY_ORDER: PolarityKey[] = ["positive", "negative", "neutral"];
const DEFAULT_LABEL: Record<PolarityKey, string> = { positive: "긍정", negative: "부정", neutral: "중립" };
const DEFAULT_COLOR: Record<PolarityKey, string> = { positive: "#5b73c4", negative: "#e07a3f", neutral: "#b8b8b8" };

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function polarXY(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

export type DonutOptions = {
  labels?: Partial<Record<PolarityKey, string>>;
  colors?: Partial<Record<PolarityKey, string>>;
  ariaLabel?: string;
};

/** 원본 보고서의 주관식 응답 감정 분석 반원 도넛. */
export function donutSvg(counts: Record<string, number>, options: DonutOptions = {}): string {
  const labels = { ...DEFAULT_LABEL, ...options.labels };
  const colors = { ...DEFAULT_COLOR, ...options.colors };
  const values: Record<PolarityKey, number> = {
    positive: Math.max(0, Number(counts.positive) || 0),
    negative: Math.max(0, Number(counts.negative) || 0),
    neutral: Math.max(0, Number(counts.neutral) || 0),
  };
  const cx = 125, cy = 126, R = 100, Ri = 58;
  const total = values.positive + values.negative + values.neutral;
  if (total <= 0) return "";
  const paths: string[] = [];
  const labelsSvg: string[] = [];
  let a = 180;
  for (const pol of POLARITY_ORDER) {
    const frac = values[pol] / total;
    if (frac <= 0) continue;
    const a0 = a;
    const a1 = a - frac * 180;
    const [ox0, oy0] = polarXY(cx, cy, R, a0);
    const [ox1, oy1] = polarXY(cx, cy, R, a1);
    const [ix1, iy1] = polarXY(cx, cy, Ri, a1);
    const [ix0, iy0] = polarXY(cx, cy, Ri, a0);
    paths.push(`<path d="M ${ox0.toFixed(1)} ${oy0.toFixed(1)} A ${R} ${R} 0 0 1 ${ox1.toFixed(1)} ${oy1.toFixed(1)} L ${ix1.toFixed(1)} ${iy1.toFixed(1)} A ${Ri} ${Ri} 0 0 0 ${ix0.toFixed(1)} ${iy0.toFixed(1)} Z" fill="${colors[pol]}"/>`);
    const [lx, ly] = polarXY(cx, cy, (R + Ri) / 2, (a0 + a1) / 2);
    labelsSvg.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${(frac * 100).toFixed(1)}%</text>`);
    a = a1;
  }
  const legend = POLARITY_ORDER.map((pol, index) => {
    const y = 55 + index * 21;
    return `<rect x="252" y="${y - 9}" width="10" height="10" fill="${colors[pol]}"/><text x="268" y="${y}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="11" fill="#4b5563">${labels[pol]}</text>`;
  }).join("");
  return `<svg data-report-chart="polarity-donut" data-positive="${values.positive}" data-negative="${values.negative}" data-neutral="${values.neutral}" data-positive-label="${escapeAttribute(labels.positive)}" data-negative-label="${escapeAttribute(labels.negative)}" data-neutral-label="${escapeAttribute(labels.neutral)}" data-positive-color="${colors.positive}" data-negative-color="${colors.negative}" data-neutral-color="${colors.neutral}" viewBox="0 0 330 145" width="100%" style="max-width:330px" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeAttribute(options.ariaLabel ?? "주관식 응답 감정 분석: 긍정, 부정, 중립 비율")}">${paths.join("")}${labelsSvg.join("")}${legend}</svg>`;
}

export type HistogramOptions = {
  xLabel?: string;
  yLabel?: string;
  barColor?: string;
  peakColor?: string;
  /** 사용자가 우측 패널에서 지정한 Y축 상한. 실제 최대 응답수보다 작게는 내려가지 않는다. */
  yMax?: number;
  /** Y축 구간 수(눈금은 구간 수 + 1개). */
  tickCount?: number;
  ariaLabel?: string;
};

/** 원본 보고서의 0~10점 만족도 분포도. */
export function satisfactionHistogramSvg(distribution: number[], options: HistogramOptions = {}): string {
  const values = Array.from({ length: 11 }, (_, index) => Math.max(0, Number(distribution[index]) || 0));
  const width = 560, height = 280;
  const margin = { top: 18, right: 18, bottom: 46, left: 52 };
  const maxCount = Math.max(1, ...values);
  const automaticMax = Math.max(5, Math.ceil(maxCount / 5) * 5);
  const requestedYMax = Number(options.yMax);
  // 데이터 막대가 축 밖으로 나가지 않도록, 입력값이 실제 최댓값보다 낮으면 자동 범위를 유지한다.
  const yMax = Number.isFinite(requestedYMax) ? Math.max(maxCount, requestedYMax) : automaticMax;
  const tickCount = Math.max(2, Math.min(10, Math.round(Number(options.tickCount) || 5)));
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const slot = plotW / values.length;
  const barW = slot * 0.68;
  const baseY = margin.top + plotH;
  const xLabel = options.xLabel ?? "만족도 점수";
  const yLabel = options.yLabel ?? "응답자 수";
  const barColor = options.barColor ?? "#2ed6a4";
  const peakColor = options.peakColor ?? "#078c44";
  const grid: string[] = [];
  for (let index = 0; index <= tickCount; index += 1) {
    const tick = (yMax * index) / tickCount;
    const y = baseY - (tick / yMax) * plotH;
    grid.push(`<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${width - margin.right}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/><text x="${margin.left - 8}" y="${(y + 4).toFixed(1)}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="10" text-anchor="end" fill="#6b7280">${Number.isInteger(tick) ? tick : tick.toFixed(1)}</text>`);
  }
  const parts = values.map((count, i) => {
    const cx = margin.left + slot * i + slot / 2;
    const h = (count / yMax) * plotH;
    const y = baseY - h;
    const valueLabel = count > 0 ? `<text x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="#4b5563">${count}</text>` : "";
    return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${count === maxCount && count > 0 ? peakColor : barColor}"/>${valueLabel}<text x="${cx.toFixed(1)}" y="${(baseY + 18).toFixed(1)}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="11" text-anchor="middle" fill="#4b5563">${i}</text>`;
  });
  return `<svg data-report-chart="satisfaction-histogram" data-distribution="${values.join(",")}" data-x-label="${escapeAttribute(xLabel)}" data-y-label="${escapeAttribute(yLabel)}" data-bar-color="${barColor}" data-peak-color="${peakColor}" data-y-max="${yMax}" data-tick-count="${tickCount}" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeAttribute(options.ariaLabel ?? "만족도 점수별 응답자 수 분포")}">${grid.join("")}<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${baseY}" stroke="#9ca3af"/><line x1="${margin.left}" y1="${baseY}" x2="${width - margin.right}" y2="${baseY}" stroke="#9ca3af"/>${parts.join("")}<text x="${width / 2}" y="${height - 8}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="12" text-anchor="middle" fill="#4b5563">${xLabel}</text><text x="16" y="${height / 2}" font-family="'맑은 고딕','Malgun Gothic',sans-serif" font-size="12" text-anchor="middle" fill="#4b5563" transform="rotate(-90 16 ${height / 2})">${yLabel}</text></svg>`;
}
