"use client";

import { useRef } from "react";
import type { ReportPolarityBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

const colors = { positive: "#8da4e8", negative: "#ff9449", neutral: "#c8c8c8" };

export function EditablePolarityChart({ block }: { block: ReportPolarityBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const values = [
    { key: "positive" as const, label: "긍정", value: block.positive },
    { key: "negative" as const, label: "부정", value: block.negative },
    { key: "neutral" as const, label: "중립", value: block.neutral },
  ];
  const total = Math.max(0.01, values.reduce((sum, item) => sum + Math.max(0, item.value), 0));
  const width = 620, height = 156, x = 48, y = 64, chartWidth = 524, chartHeight = 38;
  let cursor = x;
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap gap-2" data-copy-ignore>
        <button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button>
      </div>
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
        <svg ref={svgRef} data-export-crop-top="32" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
          <g data-export-exclude><rect width={width} height="4" fill="#4fc8e8" /><rect y="4" width={width} height="27" fill="#c0cdef" />
          <text x={width / 2} y="23" textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">{block.title}</text></g>
          <rect x={x} y={y} width={chartWidth} height={chartHeight} fill="#f4f4f5" stroke="#a1a1aa" />
          {values.map((item) => { const segment = chartWidth * Math.max(0, item.value) / total; const current = cursor; cursor += segment; return <g key={item.key}><rect x={current} y={y} width={segment} height={chartHeight} fill={colors[item.key]} /><text x={current + segment / 2} y={y + 24} textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">{item.label} {item.value.toFixed(1)}%</text></g>; })}
          <text x={x} y="128" fontSize="11" fill="#52525b">긍정·부정·중립 응답 비율</text>
        </svg>
      </div>
    </section>
  );
}
