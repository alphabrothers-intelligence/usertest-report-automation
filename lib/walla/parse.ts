import * as XLSX from "xlsx";

export interface ParsedWorkbook {
  headerRow: unknown[];
  dataRows: unknown[][];
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

/**
 * xlsx 바이트를 파싱해 헤더 행과, 완전히 빈 행(서식만 남은 트레일링 행)을 제외한 데이터 행을 반환한다.
 */
export function parseWallaWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const [headerRow = [], ...rest] = rows;
  const dataRows = rest.filter((row) => !isBlankRow(row));

  return { headerRow, dataRows };
}
