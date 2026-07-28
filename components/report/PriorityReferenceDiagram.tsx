"use client";

/** 원본 보고서의 사분면 뒤 "영역별 참고 지표"를 웹 문서에도 유지한다.
 * 사분면 수치는 별도 차트에서 조정하고, 이 블록은 판정 기준을 명확히 전달하는 용도다. */
import type { ReportPriorityReferenceBlock } from "@/lib/report/sections";
import { useRef } from "react";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

const levels = [
  ["최상", "긴급 개선", "#f9c9a8"],
  ["상", "중요 개선", "#fde9dd"],
  ["중", "개선 권장 or 제외 권장", "#ffffff"],
  ["하", "개선 권장 or 필요성 낮음", "#dbe5f5"],
  ["최하", "필요성 적음", "#aebfe5"],
] as const;

const notes = [
  ["#f9c9a8", "중요도가 높으나 만족도가 낮으므로 긴급 개선 필요"],
  ["#fde9dd", "중요도가 높으나 만족도가 보통이므로 중요 개선 필요"],
  ["#ffffff", "중요도가 보통이나 만족도가 낮으므로 중요 개선 필요"],
  ["#ffffff", "중요도가 높으나 만족도가 높으므로 개선 필요성 낮음"],
  ["#dbe5f5", "중요도가 보통이고 만족도가 높으므로 추후 고도화"],
  ["#aebfe5", "중요도가 낮으나 만족도가 높으므로 개선 필요성 낮음"],
] as const;

export function PriorityReferenceDiagram({ block }: { block: ReportPriorityReferenceBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <section className="mb-6">
      <div className="mb-2 flex justify-end" data-copy-ignore><button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">참고 지표 PNG 다운로드</button></div>
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#d4d4d8] bg-white p-4">
        <h4 className="-mx-4 -mt-4 mb-4 border-b border-[#d4d4d8] bg-[#ececec] py-1.5 text-center text-sm font-bold text-[#111827]">{block.title}</h4>
        <div className="grid gap-4 md:grid-cols-[minmax(220px,0.9fr)_minmax(270px,1.1fr)]">
          <div className="mx-auto w-full max-w-[270px]">
            <svg ref={svgRef} viewBox="0 0 270 288" className="block w-full" aria-label={block.title}>
              <rect width="270" height="288" fill="#fff" />
              {["#aebfe5", "#dbe5f5", "#dbe5f5", "#dbe5f5", "#ffffff", "#fde9dd", "#ffffff", "#fde9dd", "#f9c9a8"].map((color, index) => {
                const col = index % 3, row = Math.floor(index / 3); const label = index === 0 ? "개선 필요성 적음" : index === 2 ? "개선 필요성 낮음" : index === 5 ? "중요 개선" : index === 8 ? "긴급 개선" : "";
                return <g key={index}><rect x={18 + col * 76} y={10 + row * 76} width="76" height="76" fill={color} stroke="#64748b" /><text x={56 + col * 76} y={49 + row * 76} textAnchor="middle" fontSize="8" fontWeight="700" fill="#334155">{label}</text></g>;
              })}
              <rect x="18" y="10" width="228" height="228" fill="none" stroke="#111827" strokeWidth="1.5" />
              <text x="132" y="262" textAnchor="middle" fontSize="12" fontWeight="700" fill="#111827">상대 중요도</text>
              <text x="10" y="124" textAnchor="middle" fontSize="12" fontWeight="700" fill="#111827" transform="rotate(-90 10 124)">만족도</text>
            </svg>
          </div>
          <div>
            <div className="border border-[#a1a1aa] text-xs">
              <div className="grid grid-cols-[88px_1fr] bg-[#ececec] font-bold"><span className="border-r border-[#a1a1aa] px-2 py-1 text-center">우선순위</span><span className="px-2 py-1 text-center">개선 필요성</span></div>
              {levels.map(([level, description, color]) => <div key={level} className="grid grid-cols-[88px_1fr] border-t border-[#a1a1aa]"><span className="flex items-center gap-2 border-r border-[#a1a1aa] px-2 py-1"><i className="h-3 w-3" style={{ backgroundColor: color }} />{level}</span><span className="px-2 py-1 text-center">{description}</span></div>)}
            </div>
            <div className="mt-3 space-y-1.5 text-xs leading-5 text-[#111827]">
              {notes.map(([color, text]) => <p key={text} className="flex gap-2"><i className="mt-1 h-3 w-3 shrink-0 border border-[#a1a1aa]" style={{ backgroundColor: color }} /><span>{text}</span></p>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
