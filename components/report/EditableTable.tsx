"use client";

/**
 * 웹 작업공간에서 쓰는 편집 가능한 표. 숫자뿐 아니라 문자열 셀도 클릭해 수정할 수 있다.
 */
import { useState } from "react";
import type { ReportTableBlock } from "@/lib/report/sections";
import { DATA_TABLE, tablePalette } from "@/lib/report/sectionStyle";

/**
 * 원본 37쪽 실측(2026-08-25)에 맞춘 데이터 표.
 * - 표 제목은 표 **바깥 박스**가 아니라 **표의 첫 행**이다(원본은 제목행·헤더행·값행이 하나의
 *   테두리로 이어진다). 예전에는 제목을 별도 박스로 위에 띄워서 표가 두 덩어리로 보였다.
 * - 색·테두리·글자 크기는 리터럴을 쓰지 않고 sectionStyle.ts 토큰에서 가져온다.
 * - 계열(실용성/즐거움 등)마다 팔레트가 다르다 — `block.paletteIndex`로 고른다.
 */
/** 원본은 평균·표준편차 같은 소수를 항상 2자리로 쓴다(7.20, 6.35). 순위·응답자 수 같은
 * 정수는 그대로 둔다 — 1위가 "1.00"이 되면 안 되므로 정수/소수를 갈라서 처리한다. */
function formatCell(value: string | number): string {
  if (typeof value !== "number" || Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

export function EditableTable({ block, onChange }: { block: ReportTableBlock; onChange: (next: ReportTableBlock) => void }) {
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const palette = tablePalette(block.paletteIndex);
  const border = `${DATA_TABLE.borderWidth}pt solid ${palette.border}`;
  const cell = { border, fontSize: `${DATA_TABLE.fontSize}pt`, height: `${DATA_TABLE.rowHeight}pt` };

  function updateCell(rowIndex: number, colIndex: number, value: string | number) {
    const rows = block.rows.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row));
    onChange({ ...block, rows });
  }

  return (
    <div className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            {block.title && (
              <tr>
                <th colSpan={block.headers.length} style={{ ...cell, backgroundColor: palette.title }} className="text-center font-bold text-[#111827]">
                  {block.title}
                </th>
              </tr>
            )}
            <tr>
              {block.headers.map((header) => (
                <th key={header} style={{ ...cell, backgroundColor: palette.header }} className="px-3 text-center font-semibold text-[#111827]">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cellValue, colIndex) => {
                  const cellId = `${rowIndex}-${colIndex}`;
                  const isNumeric = typeof cellValue === "number";
                  // 원본은 머리글이 빈 첫 열(= "전체" 같은 라벨 열)을 헤더와 같은 색으로 칠한다.
                  // 머리글이 있는 일반 표(순위/기능/평균 …)는 첫 열도 흰색 그대로다.
                  const isLabelColumn = colIndex === 0 && block.headers[0] === "";
                  return (
                    <td
                      key={colIndex}
                      style={isLabelColumn ? { ...cell, backgroundColor: palette.header } : cell}
                      className={`px-3 text-center align-middle${isLabelColumn ? " font-semibold" : ""}`}
                    >
                      {editingCell === cellId ? (
                        <input
                          autoFocus
                          type={isNumeric ? "number" : "text"}
                          step={isNumeric ? "0.01" : undefined}
                          defaultValue={cellValue}
                          onBlur={(e) => { updateCell(rowIndex, colIndex, isNumeric ? Number(e.target.value) : e.target.value); setEditingCell(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="w-20 rounded border border-[#315c9c] px-1 py-0.5"
                        />
                      ) : (
                        <button type="button" onClick={() => setEditingCell(cellId)} className="rounded px-1 py-0.5 hover:bg-[#f5f1e9]">{formatCell(cellValue)}</button>
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
