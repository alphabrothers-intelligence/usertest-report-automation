"use client";

/**
 * 성별×연령대처럼 "행별 구성"을 보여주는 원본 보고서형 가로 누적 막대.
 * SVG 자체를 PNG로 저장하므로, 브라우저 화면과 한글 문서에 삽입할 이미지가 같은 모양으로 유지된다.
 */
import { useRef } from "react";
import type { ReportStackedBarBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

function tickValues(max: number) {
  const step = max <= 20 ? 5 : max <= 50 ? 10 : 20;
  const roundedMax = Math.ceil(max / step) * step;
  return Array.from({ length: roundedMax / step + 1 }, (_, i) => i * step);
}

export function EditableStackedBarChart({ block }: { block: ReportStackedBarBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const left = 64;
  const chartWidth = 520;
  const rowHeight = 48;
  const top = 62;
  const ticks = tickValues(block.axisMax);
  const axisMax = ticks.at(-1) ?? block.axisMax;
  const height = top + block.rows.length * rowHeight + 43;
  const colors = new Map(block.categories.map((category) => [category.name, category.color]));

  return (
    <section className="mb-5">
      <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore>
        <button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button>
      </div>
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
        <svg ref={svgRef} data-export-crop-top="29" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
          <g data-export-exclude><rect x="0" y="0" width={width} height="4" fill="#4fc8e8" />
          <rect x="0" y="4" width={width} height="24" fill="#c0cdef" />
          <rect x="0.5" y="0.5" width={width - 1} height="27.5" fill="none" stroke="#315c9c" />
          <text x={width / 2} y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">[ {block.title} ]</text></g>
          {block.categories.map((category, index) => <g key={category.name} transform={`translate(${left + index * 108}, 42)`}><rect width="10" height="10" fill={category.color} /><text x="14" y="9" fontSize="9" fill="#334155">{category.name}</text></g>)}
          {ticks.map((tick) => { const x = left + (tick / axisMax) * chartWidth; return <g key={tick}><line x1={x} x2={x} y1={top - 5} y2={height - 27} stroke="#e3e7ee" /><text x={x} y={height - 9} textAnchor="middle" fontSize="9" fill="#64748b">{tick}</text></g>; })}
          {block.rows.map((row, rowIndex) => {
            const y = top + rowIndex * rowHeight;
            let x = left;
            return <g key={row.label}><text x={left - 10} y={y + 16} textAnchor="end" fontSize="11" fontWeight="600" fill="#334155">{row.label}</text><rect x={left} y={y} width={chartWidth} height="24" fill="#f7f8fa" />{row.segments.map((segment) => { const segmentWidth = (segment.value / axisMax) * chartWidth; const node = <g key={segment.name}><rect x={x} y={y} width={segmentWidth} height="24" fill={colors.get(segment.name) ?? "#94a3b8"} />{segmentWidth > 28 && <text x={x + segmentWidth / 2} y={y + 16} textAnchor="middle" fontSize="10" fontWeight="700" fill="#273244">{segment.value}{block.unit}</text>}</g>; x += segmentWidth; return node; })}</g>;
          })}
          <text x={left + chartWidth / 2} y={height - 25} textAnchor="middle" fontSize="10" fill="#475569">응답자 수</text>
        </svg>
      </div>
    </section>
  );
}
