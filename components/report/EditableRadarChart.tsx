"use client";

/** PDF 사용자경험 품질 평가의 레이더 차트와 같은 데이터를 웹에서 편집·PNG 저장한다. */
import { useRef } from "react";
import type { ReportRadarBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

function point(cx: number, cy: number, radius: number, index: number, total: number): [number, number] {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function polygonPoints(cx: number, cy: number, radius: number, count: number) {
  return Array.from({ length: count }, (_, index) => point(cx, cy, radius, index, count).join(",")).join(" ");
}

export function EditableRadarChart({ block }: { block: ReportRadarBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const height = 360;
  const cx = width / 2;
  const cy = 194;
  const radius = 112;
  const range = block.axisMax - block.axisMin || 1;
  const levels = 5;

  return <section className="mb-5">
    <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore><button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}_레이더차트.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button></div>
    <div data-report-export="chart" data-report-export-name={`${block.title}_레이더차트`} className="border border-[#bac7dd] bg-white">
      <svg ref={svgRef} data-export-crop-top="29" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={`${block.title} 레이더 차트`}>
        <g data-export-exclude><rect x="0" y="0" width={width} height="4" fill="#4fc8e8" /><rect x="0" y="4" width={width} height="24" fill="#c0cdef" /><rect x="0.5" y="0.5" width={width - 1} height="27.5" fill="none" stroke="#315c9c" />
        <text x={cx} y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">[ {block.title} ]</text></g>
        {Array.from({ length: levels }, (_, index) => { const r = radius * (index + 1) / levels; return <polygon key={r} points={polygonPoints(cx, cy, r, block.indicators.length)} fill="none" stroke="#d9dfe9" />; })}
        {block.indicators.map((label, index) => { const [x, y] = point(cx, cy, radius, index, block.indicators.length); const [labelX, labelY] = point(cx, cy, radius + 25, index, block.indicators.length); return <g key={label}><line x1={cx} x2={x} y1={cy} y2={y} stroke="#d9dfe9" /><text x={labelX} y={labelY} textAnchor={labelX < cx - 8 ? "end" : labelX > cx + 8 ? "start" : "middle"} dominantBaseline="middle" fontSize="9" fill="#334155">{label}</text></g>; })}
        {block.series.map((series) => { const points = series.values.map((value, index) => { const scale = (value - block.axisMin) / range; return point(cx, cy, Math.max(0, scale) * radius, index, block.indicators.length).join(","); }).join(" "); return <g key={series.name}><polygon points={points} fill={series.color} fillOpacity="0.34" stroke={series.color} strokeWidth="2" />{series.values.map((value, index) => { const scale = (value - block.axisMin) / range; const [x, y] = point(cx, cy, Math.max(0, scale) * radius, index, block.indicators.length); return <circle key={index} cx={x} cy={y} r="3" fill={series.color} />; })}</g>; })}
        {Array.from({ length: levels }, (_, index) => <text key={index} x={cx + 4} y={cy - radius * (index + 1) / levels + 4} fontSize="8" fill="#64748b">{(block.axisMin + range * (index + 1) / levels).toFixed(2)}</text>)}
      </svg>
    </div>
  </section>;
}
