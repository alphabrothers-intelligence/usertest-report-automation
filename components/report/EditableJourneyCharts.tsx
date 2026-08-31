"use client";

/**
 * 고객 여정 단계(S4)의 짝을 이루는 두 차트 — 케어클 원본 34쪽을 150dpi로 렌더해 실측했다.
 *
 * - `EditableJourneyLineChart`(L13): 시점별 평균 만족도 추이. 점마다 값 라벨.
 * - `EditableWaterfallChart`(L13a): 구간별 증감. 0 기준 위아래 막대.
 *
 * 둘을 한 파일에 둔 이유는 카탈로그가 "L13을 만들면 L13a를 항상 같이 만든다. 단독으로 쓰지
 * 않는다"고 못박고 있어서다 — 색·여백 규칙도 공유한다.
 *
 * 색은 원본 픽셀에서 직접 뽑았다(PRD 2.2.4 규칙 1): 꺾은선 #667eea, 그래프 배경 #eff1fd,
 * 상승 막대 #71bf73, 하락 막대 #f6695f(가장 큰 하락) / #ffad33(그 외 하락).
 */
import { useRef } from "react";
import type { ReportJourneyLineBlock, ReportWaterfallBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";
import { tablePalette } from "@/lib/report/sectionStyle";

const LINE_COLOR = "#667eea";
const PLOT_BG = "#eff1fd";
const RISE = "#71bf73";
/** 원본은 하락 막대를 두 색으로 그린다(-1.92 빨강 / -0.32 주황). 표본이 한 장뿐이라 규칙을
 * 단정할 수 없어, **가장 크게 떨어진 구간 하나만 빨강**으로 정했다 — 이 차트의 목적 자체가
 * "어느 구간에서 얼마나 떨어졌는지"를 보여주는 것이라(카탈로그) 항목 수·값 범위와 무관하게
 * 항상 그 한 구간이 드러난다. 값 크기 기준(예: 1점 이상)으로 하면 낙폭이 고른 raw data에서
 * 강조가 통째로 사라진다. */
const FALL_MAX = "#f6695f";
const FALL = "#ffad33";

/** 제목 배너(원본 라벤더 띠). 다른 차트 컴포넌트와 같은 규격이라 PNG 저장 시 제외된다. */
function Banner({ title, width }: { title: string; width: number }) {
  return (
    <g data-export-exclude>
      <rect x="0" y="0" width={width} height="4" fill="#4fc8e8" />
      <rect x="0" y="4" width={width} height="24" fill={tablePalette(0).title} />
      <rect x="0.5" y="0.5" width={width - 1} height="27.5" fill="none" stroke="#315c9c" />
      <text x={width / 2} y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">[ {title} ]</text>
    </g>
  );
}

function DownloadBar({ onDownload }: { onDownload: () => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore>
      <button type="button" onClick={onDownload} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button>
    </div>
  );
}

export function EditableJourneyLineChart({ block }: { block: ReportJourneyLineBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const left = 52;
  const right = 24;
  const top = 56;
  const plotHeight = 210;
  const height = top + plotHeight + 44;
  const plotWidth = width - left - right;
  const ticks = Array.from({ length: block.axisMax - block.axisMin + 1 }, (_, i) => block.axisMin + i);
  const y = (value: number) => top + plotHeight - ((value - block.axisMin) / (block.axisMax - block.axisMin)) * plotHeight;
  // 점이 하나뿐이면 0으로 나누게 되므로 가운데에 놓는다.
  const x = (index: number) => block.points.length < 2
    ? left + plotWidth / 2
    : left + (index / (block.points.length - 1)) * plotWidth;

  return (
    <section className="mb-5">
      <DownloadBar onDownload={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} />
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
        <svg ref={svgRef} data-export-crop-top="29" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
          <Banner title={block.title} width={width} />
          <rect x={left} y={top} width={plotWidth} height={plotHeight} fill={PLOT_BG} />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="#ffffff" />
              <text x={left - 8} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="#64748b">{tick}</text>
            </g>
          ))}
          <polyline
            fill="none"
            stroke={LINE_COLOR}
            strokeWidth="2"
            points={block.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")}
          />
          {block.points.map((point, index) => (
            <g key={`${point.label}-${index}`}>
              <circle cx={x(index)} cy={y(point.value)} r="3.5" fill="#ffffff" stroke={LINE_COLOR} strokeWidth="2" />
              <text x={x(index)} y={y(point.value) - 9} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={LINE_COLOR}>
                {point.value.toFixed(2)}{block.unit}
              </text>
              <text x={x(index)} y={top + plotHeight + 15} textAnchor="middle" fontSize="8.5" fill="#475569">{point.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

export function EditableWaterfallChart({ block }: { block: ReportWaterfallBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const left = 56;
  const right = 24;
  const top = 50;
  const plotHeight = 220;
  const height = top + plotHeight + 62;
  const plotWidth = width - left - right;
  const deltas = block.steps.map((step) => step.delta);
  // 0을 반드시 포함하는 축. 원본(케어클 34쪽)은 -1.92~+0.36 데이터에 0.5 간격 -2.0~+0.6을
  // 썼다 — 눈금 5칸 안팎이 되도록 간격을 고르면 같은 결과가 나온다. 데이터 최대·최소를
  // 기준으로 간격을 잡으면(예전 방식) -3.0~+2.0처럼 헐거워져 작은 증감이 안 보인다.
  const dataMin = Math.min(...deltas, 0);
  const dataMax = Math.max(...deltas, 0);
  const step = niceStep((dataMax - dataMin) / 5 || 0.1);
  // 데이터가 눈금선에 딱 걸리면 막대 밖 값 라벨이 축 경계에 잘리므로 한 칸 더 준다.
  const max = Math.ceil(dataMax / step) * step + (Math.abs(dataMax % step) < 1e-9 && dataMax > 0 ? step : 0);
  const min = Math.floor(dataMin / step) * step - (Math.abs(dataMin % step) < 1e-9 && dataMin < 0 ? step : 0);
  const y = (value: number) => top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const zeroY = y(0);
  const slot = plotWidth / Math.max(block.steps.length, 1);
  const barWidth = Math.min(72, slot * 0.62);
  const biggestFall = Math.min(...deltas, 0);
  const ticks: number[] = [];
  for (let value = min; value <= max + 1e-9; value += step) ticks.push(Number(value.toFixed(4)));

  return (
    <section className="mb-5">
      <DownloadBar onDownload={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} />
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
        <svg ref={svgRef} data-export-crop-top="29" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
          <Banner title={block.title} width={width} />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#94a3b8" : "#eef1f6"} />
              <text x={left - 8} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="#64748b">
                {tick > 0 ? "+" : ""}{tick.toFixed(1)}{block.unit}
              </text>
            </g>
          ))}
          {block.steps.map((entry, index) => {
            const centerX = left + slot * index + slot / 2;
            const rises = entry.delta >= 0;
            const barTop = rises ? y(entry.delta) : zeroY;
            const barHeight = Math.abs(y(entry.delta) - zeroY);
            // 라벨은 막대 바깥 끝(원본과 동일) — 상승은 위, 하락은 아래.
            const labelY = rises ? barTop - 5 : barTop + barHeight + 12;
            return (
              <g key={`${entry.label}-${index}`}>
                <rect
                  x={centerX - barWidth / 2}
                  y={barTop}
                  width={barWidth}
                  height={barHeight}
                  fill={rises ? RISE : entry.delta === biggestFall ? FALL_MAX : FALL}
                />
                <text x={centerX} y={labelY} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={rises ? RISE : entry.delta === biggestFall ? FALL_MAX : FALL}>
                  {entry.delta > 0 ? "+" : ""}{entry.delta.toFixed(2)}{block.unit}
                </text>
                {/* 구간 이름과 값을 한 줄에 붙이면 옆 칸 라벨과 겹친다(실측) — 두 줄로 나눈다. */}
                <text x={centerX} y={height - 24} textAnchor="middle" fontSize="8" fill="#475569">{entry.label}</text>
                <text x={centerX} y={height - 13} textAnchor="middle" fontSize="8" fill="#475569">
                  ({entry.delta > 0 ? "+" : ""}{entry.delta.toFixed(2)})
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/** 1·2·5×10ⁿ 중 요청 간격 이상인 가장 작은 "예쁜" 눈금 간격. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const candidate of [1, 2, 5, 10]) {
    if (candidate * magnitude >= raw) return candidate * magnitude;
  }
  return 10 * magnitude;
}