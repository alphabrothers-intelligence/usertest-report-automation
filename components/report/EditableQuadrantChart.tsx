"use client";

/**
 * PDF `CanvasQuadrantChart`의 격자·색·라벨 배치 규칙을 웹에 그대로 옮긴 편집형 차트.
 *
 * 중요한 차이: 3×3 우선순위 표시는 "영역별 참고 지표"에서 설명하고, 실제 차트는 원본처럼
 * 10×10 격자와 기능명만 보인다. 모든 격자 칸은 클릭 가능하며, 선택하면 그 칸 위에서 바로
 * 문구를 입력할 수 있다. 저장되는 `cellContents`는 정량 값과 별도인 발표/보고서용 표시 문구다.
 */
import { useMemo, useRef, useState } from "react";
import type { ReportQuadrantBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

type Cell = { x: number; y: number };

function cellId({ x, y }: Cell) {
  return `${x}:${y}`;
}

function lineLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function snapToCell(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max - 1, Math.floor(value)));
}

function priorityColor(block: ReportQuadrantBlock, x: number, y: number) {
  // 기본 3×3 영역도 값으로 보관되어 있으므로, 우측 패널에서 바꾼 영역 색상이
  // 실제 10×10 격자에 즉시 반영된다. 범위 바깥은 원본처럼 흰색으로 둔다.
  return block.zones.find((zone) => x >= zone.x0 && x < zone.x1 && y >= zone.y0 && y < zone.y1)?.color ?? "#ffffff";
}

function wrapLabel(text: string, maxChars = 8) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function EditableQuadrantChart({ block, onChange }: { block: ReportQuadrantBlock; onChange: (next: ReportQuadrantBlock) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);

  // PDF의 정사각형 plot을 그대로 유지한다. 브라우저 폭이 변해도 viewBox 비율은 유지된다.
  const width = 620;
  const height = 610;
  const left = 72;
  const top = 42;
  const plotSize = 500;
  const xRange = block.xMax - block.xMin || 1;
  const yRange = block.yMax - block.yMin || 1;
  const scaleX = (value: number) => left + ((value - block.xMin) / xRange) * plotSize;
  const scaleY = (value: number) => top + plotSize - ((value - block.yMin) / yRange) * plotSize;
  const cellWidth = plotSize / xRange;
  const cellHeight = plotSize / yRange;

  const cells = useMemo(() => {
    const result: Cell[] = [];
    for (let y = block.yMin; y < block.yMax; y += 1) {
      for (let x = block.xMin; x < block.xMax; x += 1) result.push({ x, y });
    }
    return result;
  }, [block.xMin, block.xMax, block.yMin, block.yMax]);

  const defaultTextByCell = useMemo(() => {
    const values = new Map<string, string[]>();
    for (const item of block.items) {
      const x = snapToCell(item.importance, block.xMin, block.xMax);
      const y = snapToCell(item.satisfaction, block.yMin, block.yMax);
      const id = cellId({ x, y });
      values.set(id, [...(values.get(id) ?? []), item.name]);
    }
    return values;
  }, [block.items, block.xMin, block.xMax, block.yMin, block.yMax]);

  const contentByCell = useMemo(() => new Map(block.cellContents.map((content) => [cellId(content), content.text])), [block.cellContents]);
  const selectedText = selectedCell ? (contentByCell.get(cellId(selectedCell)) ?? (defaultTextByCell.get(cellId(selectedCell)) ?? []).join("\n")) : "";

  function updateCell(cell: Cell, text: string) {
    const id = cellId(cell);
    const existing = block.cellContents.find((content) => content.id === id);
    const cellContents = existing
      ? block.cellContents.map((content) => content.id === id ? { ...content, text } : content)
      : [...block.cellContents, { id, ...cell, text }];
    onChange({ ...block, cellContents });
  }

  function cellBox(cell: Cell) {
    return {
      x: scaleX(cell.x),
      y: scaleY(cell.y + 1),
      width: cellWidth,
      height: cellHeight,
    };
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore>
        <button type="button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, `${block.title}.png`)} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">
          그래프 PNG 다운로드
        </button>
        <span className="text-xs text-[#70675e]">격자 칸을 눌러 문구를 직접 입력하세요.</span>
      </div>


      <div data-report-export="chart" data-report-export-name={block.title} className="relative overflow-hidden border border-[#bac7dd] bg-white">
        {/* 제목 띠는 보고서 화면에서만 보이고, PNG에는 export helper가 제거한다. */}
        <svg ref={svgRef} data-export-crop-top="30" viewBox={`0 0 ${width} ${height}`} className="block w-full" aria-label={block.title}>
          <g data-export-exclude>
            <rect x="0" y="0" width={width} height="4" fill="#4fc8e8" />
            <rect x="0" y="4" width={width} height="25" fill="#c0cdef" />
            <rect x="0.5" y="0.5" width={width - 1} height="28.5" fill="none" stroke="#315c9c" />
            <text x={width / 2} y="22" textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">{block.title}</text>
          </g>

          {cells.map((cell) => {
            const box = cellBox(cell);
            const isSelected = selectedCell?.x === cell.x && selectedCell?.y === cell.y;
            return <rect key={`cell-${cellId(cell)}`} x={box.x} y={box.y} width={box.width} height={box.height} fill={priorityColor(block, cell.x, cell.y)} stroke={isSelected ? "#315c9c" : "#9a9a9a"} strokeWidth={isSelected ? 2 : 0.45} className="cursor-text" onClick={() => setSelectedCell(cell)} />;
          })}

          <rect x={left} y={top} width={plotSize} height={plotSize} fill="none" stroke="#18181b" strokeWidth="1.2" pointerEvents="none" />
          {Array.from({ length: Math.round(xRange) + 1 }, (_, index) => block.xMin + index).map((value) => <text key={`x-${value}`} x={scaleX(value)} y={top + plotSize + 17} textAnchor="middle" fontSize="9" fill="#404040">{lineLabel(value)}</text>)}
          {Array.from({ length: Math.round(yRange) + 1 }, (_, index) => block.yMin + index).map((value) => <text key={`y-${value}`} x={left - 10} y={scaleY(value) + 3} textAnchor="end" fontSize="9" fill="#404040">{lineLabel(value)}</text>)}
          <text x={left + plotSize / 2} y={top + plotSize + 39} textAnchor="middle" fontSize="12" fontWeight="700" fill="#404040">{block.xLabel}</text>
          <text x="21" y={top + plotSize / 2} textAnchor="middle" fontSize="12" fontWeight="700" fill="#404040" transform={`rotate(-90 21 ${top + plotSize / 2})`}>{block.yLabel}</text>

          {cells.map((cell) => {
            const box = cellBox(cell);
            const text = contentByCell.get(cellId(cell)) ?? (defaultTextByCell.get(cellId(cell)) ?? []).join("\n");
            const lines = text.split("\n").flatMap((line) => wrapLabel(line));
            return lines.map((line, index) => <text key={`label-${cellId(cell)}-${index}`} x={box.x + box.width / 2} y={box.y + box.height / 2 + (index - (lines.length - 1) / 2) * 10} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#27272a" pointerEvents="none">{line}</text>);
          })}
        </svg>

        {selectedCell && (() => {
          const box = cellBox(selectedCell);
          return <textarea
            aria-label={`${selectedCell.x}, ${selectedCell.y} 사분면 칸 내용`}
            autoFocus
            value={selectedText}
            onChange={(event) => updateCell(selectedCell, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape") setSelectedCell(null); }}
            className="absolute resize-none border-2 border-[#315c9c] bg-white/95 p-1 text-center text-[11px] font-semibold leading-tight text-[#27272a] outline-none"
            style={{
              left: `${(box.x / width) * 100}%`, top: `${(box.y / height) * 100}%`,
              width: `${(box.width / width) * 100}%`, height: `${(box.height / height) * 100}%`,
            }}
          />;
        })()}
      </div>
    </section>
  );
}
