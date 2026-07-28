"use client";

/** 원본 VIII장의 NPS 0~10 등급·산식 안내를 편집 가능한 SVG로 재현한다. */
import { useRef } from "react";
import type { ReportNpsBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

export function EditableNpsChart({ block }: { block: ReportNpsBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const height = 295;
  const start = 72;
  const cell = 43;

  return <section className="mb-5">
    <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore><button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</button></div>
    <div data-report-export="chart" data-report-export-name="NPS_지수" className="border border-[#bac7dd] bg-white">
      <svg ref={svgRef} data-export-crop-top="33" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label="NPS 지수">
        <g data-export-exclude><rect x="0" y="0" width={width} height="4" fill="#4fc8e8" /><rect x="0" y="4" width={width} height="28" fill="#dfe7f6" /><rect x="0.5" y="0.5" width={width - 1} height="31.5" fill="none" stroke="#6388e6" />
        <text x="12" y="23" fontSize="15" fontWeight="700" fill="#6c82aa">{block.title}</text></g>
        <text x={start + cell * 3.5} y="61" textAnchor="middle" fontSize="11" fill="#9ca3af">비구매/비추천 고객</text><text x={start + cell * 7.5} y="61" textAnchor="middle" fontSize="11" fill="#777">중립 고객</text><text x={start + cell * 9.5} y="61" textAnchor="middle" fontSize="11" fill="#111827">추천/구매 고객</text>
        {Array.from({ length: 11 }, (_, score) => { const x = start + score * cell; const tone = score <= 6 ? "#d8d8d8" : score <= 8 ? "#9f9f9f" : "#111111"; return <g key={score}><circle cx={x + cell / 2} cy="90" r="11" fill={tone} opacity={score <= 6 ? 0.55 : 1} /><rect x={x} y="109" width={cell - 1} height="26" fill={tone} /><text x={x + cell / 2} y="127" textAnchor="middle" fontSize="12" fontWeight="700" fill={score >= 7 ? "#fff" : "#334155"}>{score}</text></g>; })}
        <text x={start} y="153" fontSize="11" fill="#475569">추천/구매하고 싶지 않다</text><text x={start + cell * 11} y="153" textAnchor="end" fontSize="11" fill="#475569">추천/구매하고 싶다</text>
        <rect x="78" y="177" width="464" height="72" fill="#f3f3f3" />
        <text x="180" y="211" textAnchor="middle" fontSize="16" fontWeight="700" fill="#111827">NPS</text><text x="250" y="211" textAnchor="middle" fontSize="16" fill="#a1a1aa">=</text><text x="360" y="211" textAnchor="middle" fontSize="15" fontWeight="700" fill="#111827">추천고객 비율</text><text x="438" y="211" textAnchor="middle" fontSize="16" fill="#a1a1aa">−</text><text x="500" y="211" textAnchor="middle" fontSize="15" fontWeight="700" fill="#111827">비추천 고객 비율</text>
        <text x="180" y="232" textAnchor="middle" fontSize="10" fill="#475569">(Net Promoter Score)</text><text x="360" y="232" textAnchor="middle" fontSize="10" fill="#475569">Promoters (%)</text><text x="500" y="232" textAnchor="middle" fontSize="10" fill="#475569">Detractors (%)</text>
      </svg>
    </div>
  </section>;
}
