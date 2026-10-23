import * as XLSX from "xlsx";

export interface ParsedWorkbook {
  headerRow: unknown[];
  dataRows: unknown[][];
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

/**
 * CSV 바이트를 글자로 푼다. WALLA가 내려주는 CSV는 UTF-8인데, **엑셀에서 열어 고친 뒤 다시 CSV로 저장하면
 * 한국어 윈도·맥 엑셀은 CP949(EUC-KR)로 저장한다** — 담당자가 raw data 제목에 '기업 요청 질문 - '을 붙이고
 * 다시 저장하는 흐름이 바로 이것이다. 그대로 읽으면 제목이 전부 깨져 문항을 하나도 못 알아본다(2026-10-23 실측).
 * UTF-8로 깨끗이 풀리면 그것을, 아니면 CP949로 푼다.
 */
function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

/** xlsx(zip)·xls(OLE)는 바이너리 그대로, 그 밖(CSV·TSV)은 글자로 풀어 읽는다. */
const isSpreadsheetBinary = (b: Uint8Array) =>
  (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0);

/**
 * xlsx/xls/csv 바이트를 파싱해 헤더 행과, 완전히 빈 행(서식만 남은 트레일링 행)을 제외한 데이터 행을 반환한다.
 */
export function parseWallaWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  const bytes = new Uint8Array(buffer);
  const workbook = isSpreadsheetBinary(bytes)
    ? XLSX.read(buffer, { type: "array" })
    : XLSX.read(decodeCsv(bytes), { type: "string" });
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
