"use client";

/** PDF `GroupedBarChart`의 웹 편집 버전. 비교 집단별 색상·점수를 바꾸고 PNG로 바로 저장한다. */
import { useRef } from "react";
import type { ReportGroupedBarBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

const safeTick = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

export function EditableGroupedBarChart({ block }: { block: ReportGroupedBarBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const height = 330;
  const left = 54;
  const top = 60;
  const plotWidth = 545;
  const plotHeight = 215;
  const range = block.axisMax - block.axisMin || 1;
  const ticks = Array.from({ length: 6 }, (_, index) => block.axisMin + (range / 5) * index);

  return <section className="mb-5">
    <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore>
      <button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button>
    </div>
    <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
      <svg ref={svgRef} data-export-crop-top="29" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
        <g data-export-exclude><rect x="0" y="0" width={width} height="4" fill="#4fc8e8" /><rect x="0" y="4" width={width} height="24" fill="#c0cdef" /><rect x="0.5" y="0.5" width={width - 1} height="27.5" fill="none" stroke="#315c9c" />
        <text x={width / 2} y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">[ {block.title} ]</text></g>
        {block.series.map((series, index) => <g key={series.name} transform={`translate(${Math.max(70, width / 2 - block.series.length * 50) + index * 100},42)`}><rect width="10" height="10" fill={series.color} /><text x="14" y="9" fontSize="9" fill="#334155">{series.name}</text></g>)}
        {ticks.map((tick) => { const y = top + plotHeight - ((tick - block.axisMin) / range) * plotHeight; return <g key={tick}><line x1={left} x2={left + plotWidth} y1={y} y2={y} stroke="#d9dfe9" /><text x={left - 8} y={y + 4} textAnchor="end" fontSize="9" fill="#64748b">{safeTick(tick)}</text></g>; })}
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} stroke="#7b8798" /><line x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} stroke="#7b8798" />
        {block.categories.map((category, categoryIndex) => { const slot = plotWidth / Math.max(1, block.categories.length); const gap = 2; const widthPerBar = Math.min(24, (slot * 0.78 - gap * (block.series.length - 1)) / Math.max(1, block.series.length)); const groupWidth = widthPerBar * block.series.length + gap * (block.series.length - 1); const groupX = left + categoryIndex * slot + (slot - groupWidth) / 2; return <g key={category.label}>{block.series.map((series, seriesIndex) => { const value = category.values.find((item) => item.series === series.name)?.value ?? 0; const barHeight = Math.max(0, ((value - block.axisMin) / range) * plotHeight); const x = groupX + seriesIndex * (widthPerBar + gap); const y = top + plotHeight - barHeight; return <g key={series.name}><rect x={x} y={y} width={widthPerBar} height={barHeight} fill={series.color} /><text x={x + widthPerBar / 2} y={Math.max(y + 11, top + 10)} textAnchor="middle" fontSize="8" fontWeight="700" fill="#172033">{value.toFixed(2)}</text></g>; })}<text x={left + categoryIndex * slot + slot / 2} y={top + plotHeight + 16} textAnchor="middle" fontSize="8.5" fill="#334155">{category.label}</text></g>; })}
        <text x="18" y={top + plotHeight / 2} textAnchor="middle" fontSize="9" fill="#475569" transform={`rotate(-90 18 ${top + plotHeight / 2})`}>만족도 평균</text>
      </svg>
    </div>
  </section>;
}
