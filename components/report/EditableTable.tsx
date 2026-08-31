"use client";

/**
 * 웹 작업공간에서 쓰는 편집 가능한 표. 숫자뿐 아니라 문자열 셀도 클릭해 수정할 수 있다.
 */
import { useState } from "react";
import type { ReportTableBlock } from "@/lib/report/sections";
import { DATA_TABLE, REPORT_TEXT, tablePalette } from "@/lib/report/sectionStyle";

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

/**
 * NPS 치환 구간 색(레이아웃 L27). 원본 범례 그대로 — 9~10점 긍정(파랑) / 8~7점 중립(흰색) /
 * 0~6점 부정(주황). 최고·최저 강조가 아니라 **값 자체**로 결정되므로 raw data가 바뀌어도
 * 같은 기준이 유지된다(투블럭 원본 19쪽 실측: 8.27은 중립이라 흰색이다).
 */
function npsBandColor(value: string | number): string | undefined {
  if (typeof value !== "number") return undefined;
  if (value >= 9) return "#dce7fa";
  if (value >= 7) return undefined;
  return "#fde4d0";
}

/** 원본 범례. "■"는 서브셋 폰트에 없어 텍스트로 넣으면 깨지므로 색 사각형을 직접 그린다
 * (CLAUDE.md의 특수문자 사고와 같은 이유).
 *
 * 크기·간격을 Tailwind 클래스가 아니라 인라인 스타일로 준다 — 이 컴포넌트는 스타일시트가
 * 없는 환경(검사 스크립트의 단독 HTML, PNG 내보내기)에서도 렌더되므로, 클래스에 기대면
 * 스와치가 0×0으로 사라진다(2026-08-25 실측). */
function NpsBandLegend() {
  const items: [string, string][] = [["#dce7fa", "'긍정' (9-10점)"], ["#ffffff", "'중립' (8-7점)"], ["#fde4d0", "'부정' (0-6점)"]];
  return (
    <p style={{ margin: "4px 0 0", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "3px 6px", fontSize: `${REPORT_TEXT.noteFontSize}pt`, color: "#111827" }}>
      <span>*</span>
      {items.map(([color, label], index) => (
        <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
          <span aria-hidden style={{ display: "inline-block", width: 9, height: 9, border: "1px solid #94a3b8", backgroundColor: color }} />
          <span>: NPS 치환 {label}{index < items.length - 1 ? " /" : ""}</span>
        </span>
      ))}
    </p>
  );
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
                  const isLabelColumn = colIndex === 0 && (block.labelColumn || block.headers[0] === "");
                  const band = block.npsBands && !isLabelColumn ? npsBandColor(cellValue) : undefined;
                  return (
                    <td
                      key={colIndex}
                      style={isLabelColumn ? { ...cell, backgroundColor: palette.header } : band ? { ...cell, backgroundColor: band } : cell}
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
      {block.npsBands && <NpsBandLegend />}
    </div>
  );
}
