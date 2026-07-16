import { parseWallaWorkbook, type ParsedWorkbook } from "./parse";
import { validateWallaHeaderRow, type ValidationResult } from "./schema";

export interface LoadResult {
  ok: boolean;
  fetchError?: string;
  parsed?: ParsedWorkbook;
  validation?: ValidationResult;
}

/**
 * 채팅 턴마다 서버리스 함수가 독립 실행되므로(PRD 4.3절), 파싱 결과를 아직 DB에 캐시하지 않고
 * 도구가 호출될 때마다 URL에서 다시 내려받아 파싱한다. DB 상태 저장은 Phase 5에서 추가한다.
 */
export async function loadWallaFromUrl(fileUrl: string): Promise<LoadResult> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    return { ok: false, fetchError: `파일을 내려받지 못했습니다 (HTTP ${response.status})` };
  }

  const buffer = await response.arrayBuffer();

  let parsed: ParsedWorkbook;
  try {
    parsed = parseWallaWorkbook(buffer);
  } catch {
    return {
      ok: false,
      fetchError: "xlsx 파일을 파싱하지 못했습니다. 파일이 손상되었거나 xlsx 형식이 아닙니다.",
    };
  }

  const validation = validateWallaHeaderRow(parsed.headerRow);
  return { ok: true, parsed, validation };
}
