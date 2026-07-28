"use client";

/**
 * PDF `RankCompositionChart`의 웹 편집 대응물.
 * 각 순위행은 응답자 구성비(합계 100%)를 가로 누적 막대로 보여주며, 값·색상은 웹 초안에서만
 * 수정할 수 있다. 저장 이미지는 이 SVG 자체를 PNG로 변환하므로 보고서에 바로 삽입 가능하다.
 */
import { useRef } from "react";
import type { ReportRankCompositionBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

/** SVG는 CSS flex-wrap을 쓸 수 없으므로, 한글 라벨 폭을 안전 쪽으로 추정해 범례 줄을 나눈다. */
function legendRows(candidates: ReportRankCompositionBlock["candidates"], maxWidth: number) {
  const rows: { candidate: ReportRankCompositionBlock["candidates"][number]; x: number }[][] = [[]];
  let x = 0;
  for (const candidate of candidates) {
    const estimatedWidth = 18 + [...candidate.name].length * 8.5;
    if (x > 0 && x + estimatedWidth > maxWidth) {
      rows.push([]);
      x = 0;
    }
    rows.at(-1)?.push({ candidate, x });
    x += estimatedWidth;
  }
  return rows;
}

export function EditableRankCompositionChart({ block }: { block: ReportRankCompositionBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 620;
  const left = 48;
  const chartWidth = 548;
  const rowHeight = 30;
  const legends = legendRows(block.candidates, chartWidth);
  const top = 40 + legends.length * 16;
  const height = top + block.rows.length * rowHeight + 38;
  const colors = new Map(block.candidates.map((candidate) => [candidate.name, candidate.color]));

  async function download() {
    if (svgRef.current) await downloadSvgAsPng(svgRef.current, `${block.title}.png`);
  }

  return (
    <section className="mb-5">
      <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore>
        <button type="button" onClick={() => void download()} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">
          PNG 다운로드
        </button>
      </div>
      <div data-report-export="chart" data-report-export-name={block.title} className="border border-[#bac7dd] bg-white">
        <svg ref={svgRef} data-export-crop-top="29" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
          <g data-export-exclude><rect x="0" y="0" width={width} height="4" fill="#4fc8e8" />
          <rect x="0" y="4" width={width} height="24" fill="#c0cdef" />
          <rect x="0.5" y="0.5" width={width - 1} height="27.5" fill="none" stroke="#315c9c" />
          <text x={width / 2} y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">[ {block.title} ]</text></g>
          {legends.flatMap((row, rowIndex) =>
            row.map(({ candidate, x }) => (
              <g key={candidate.name} transform={`translate(${left + x},${42 + rowIndex * 16})`}>
                <rect width="10" height="10" fill={candidate.color} />
                <text x="14" y="9" fontSize="9" fill="#334155">{candidate.name}</text>
              </g>
            )),
          )}
          {block.rows.map((row, rowIndex) => {
            const y = top + rowIndex * rowHeight;
            let x = left;
            return (
              <g key={row.rank}>
                <text x={left - 10} y={y + 16} textAnchor="end" fontSize="10" fill="#334155">{row.rank}위</text>
                <rect x={left} y={y} width={chartWidth} height="20" fill="#f3f4f6" />
                {row.segments.map((segment) => {
                  const segmentWidth = (segment.percentage / 100) * chartWidth;
                  const node = <rect key={segment.name} x={x} y={y} width={segmentWidth} height="20" fill={colors.get(segment.name) ?? "#94a3b8"} />;
                  x += segmentWidth;
                  return node;
                })}
              </g>
            );
          })}
          {Array.from({ length: 11 }, (_, index) => {
            const value = index * 10;
            const x = left + (value / 100) * chartWidth;
            return <text key={value} x={x} y={height - 9} textAnchor={value === 0 ? "start" : value === 100 ? "end" : "middle"} fontSize="9" fill="#64748b">{value}</text>;
          })}
        </svg>
      </div>
    </section>
  );
}
