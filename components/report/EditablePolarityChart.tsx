"use client";

import { useRef } from "react";
import type { ReportPolarityBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

const defaultColors = { positive: "#8da4e8", negative: "#ff9449", neutral: "#c8c8c8" };

function polarXY(cx: number, cy: number, radius: number, degree: number) {
  const radians = (degree * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy - radius * Math.sin(radians) };
}

function halfDonutPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startDegree: number,
  endDegree: number,
) {
  const outerStart = polarXY(cx, cy, outerRadius, startDegree);
  const outerEnd = polarXY(cx, cy, outerRadius, endDegree);
  const innerEnd = polarXY(cx, cy, innerRadius, endDegree);
  const innerStart = polarXY(cx, cy, innerRadius, startDegree);
  return `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y} Z`;
}

export function EditablePolarityChart({ block }: { block: ReportPolarityBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const values = [
    { key: "positive" as const, label: block.positiveLabel || "긍정", value: block.positive, color: block.positiveColor || defaultColors.positive },
    { key: "negative" as const, label: block.negativeLabel || "부정", value: block.negative, color: block.negativeColor || defaultColors.negative },
    { key: "neutral" as const, label: block.neutralLabel || "중립", value: block.neutral, color: block.neutralColor || defaultColors.neutral },
  ];
  const total = Math.max(0.01, values.reduce((sum, item) => sum + Math.max(0, item.value), 0));
  const width = 620;
  const height = 300;
  const cx = 250;
  const cy = 242;
  const outerRadius = 176;
  const innerRadius = 104;
  let cursorDegree = 180;
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap gap-2" data-copy-ignore>
        <button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button>
      </div>
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
        <svg ref={svgRef} data-export-crop-top="32" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={`${block.title} 긍정, 부정, 중립 응답 비율`}>
          <g data-export-exclude><rect width={width} height="4" fill="#4fc8e8" /><rect y="4" width={width} height="27" fill="#c0cdef" />
          <text x={width / 2} y="23" textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">{block.title}</text></g>
          {values.map((item) => {
            const amount = Math.max(0, item.value);
            const startDegree = cursorDegree;
            const endDegree = cursorDegree - (180 * amount) / total;
            cursorDegree = endDegree;
            const labelPoint = polarXY(cx, cy, (outerRadius + innerRadius) / 2, (startDegree + endDegree) / 2);
            return <g key={item.key}>
              <path d={halfDonutPath(cx, cy, outerRadius, innerRadius, startDegree, endDegree)} fill={item.color} stroke="#ffffff" strokeWidth="2" />
              {amount > 0 && <text x={labelPoint.x} y={labelPoint.y + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="#ffffff">{amount.toFixed(1)}%</text>}
            </g>;
          })}
          {values.map((item, index) => <g key={`${item.key}-legend`}>
            <rect x="475" y={108 + index * 28} width="14" height="14" rx="1" fill={item.color} />
            <text x="497" y={120 + index * 28} fontSize="13" fill="#303030" fontFamily="Malgun Gothic, Pretendard, sans-serif">{item.label}</text>
          </g>)}
        </svg>
      </div>
    </section>
  );
}
