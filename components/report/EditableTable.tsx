"use client";

/**
 * 웹 작업공간에서 쓰는 편집 가능한 표. 숫자뿐 아니라 문자열 셀도 클릭해 수정할 수 있다.
 */
import { useState } from "react";
import type { ReportTableBlock } from "@/lib/report/sections";

export function EditableTable({ block, onChange }: { block: ReportTableBlock; onChange: (next: ReportTableBlock) => void }) {
  const [editingCell, setEditingCell] = useState<string | null>(null);

  function updateCell(rowIndex: number, colIndex: number, value: string | number) {
    const rows = block.rows.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row));
    onChange({ ...block, rows });
  }

  return (
    <div className="mb-4">
      {/* 참고 이미지(FGI Transcript Studio)의 밴드형 섹션 제목과 통일감을 주기 위해, 배경 없는
          텍스트 한 줄이었던 표 제목을 차트 밴드와 같은 스타일(#c0cdef 배경 + 네이비 테두리)의
          박스로 바꿨다(2026-07-26). 표는 복사·직접 수정용으로 두고 PNG 내보내기는 차트만 제공한다. */}
      <div className="mb-2 flex items-center gap-2">
        {block.title && (
          <p className="flex-1 border border-[#315c9c] bg-[#c0cdef] py-1.5 text-center text-sm font-bold text-[#111827]">
            [ {block.title} ]
          </p>
        )}
      </div>
      <div className="overflow-x-auto border border-[#d4d4d8]">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            {/* bg: #c0cdef(차트 배너색) → #f4f4f5(PDF 표준 표 헤더색, lib/pdf/theme.ts의
                bgAlt) — 2026-07-25 정합성 수정. 이 표는 범용 표(핵심기능표 등)라 PDF의
                표준 표 헤더 회색이 맞다(파란 라벨은 OverviewTable 같은 예외 케이스). */}
            <tr className="bg-[#f4f4f5]">
              {block.headers.map((header) => (
                <th key={header} className="border-b border-r border-[#d4d4d8] px-3 py-2 text-left font-semibold text-[#111827] last:border-r-0">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => {
                  const cellId = `${rowIndex}-${colIndex}`;
                  const isNumeric = typeof cell === "number";
                  return (
                    <td key={colIndex} className="border-r border-t border-[#d4d4d8] px-3 py-2 align-top last:border-r-0">
                      {editingCell === cellId ? (
                        <input
                          autoFocus
                          type={isNumeric ? "number" : "text"}
                          step={isNumeric ? "0.01" : undefined}
                          defaultValue={cell}
                          onBlur={(e) => { updateCell(rowIndex, colIndex, isNumeric ? Number(e.target.value) : e.target.value); setEditingCell(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="w-20 rounded border border-[#315c9c] px-1 py-0.5"
                        />
                      ) : (
                        <button type="button" onClick={() => setEditingCell(cellId)} className="rounded px-1 py-0.5 text-left hover:bg-[#f5f1e9]">{cell}</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
