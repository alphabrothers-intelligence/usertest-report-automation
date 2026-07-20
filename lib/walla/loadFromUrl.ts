import { get } from "@vercel/blob";
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
 *
 * raw data는 응답자 개인정보 때문에 private 스토어에 업로드된다(components/FileUploadButton.tsx
 * 참고) — private 블롭은 인증 없는 일반 fetch()로 못 읽으므로, BLOB_READ_WRITE_TOKEN으로
 * 인증하는 @vercel/blob의 get()을 반드시 써야 한다(실측 확인, 2026-07-19: 일반 fetch로는
 * 403이 남).
 */
export async function loadWallaFromUrl(fileUrl: string): Promise<LoadResult> {
  const result = await get(fileUrl, { access: "private" });
  if (!result) {
    return { ok: false, fetchError: "파일을 내려받지 못했습니다 (파일을 찾을 수 없음)" };
  }

  const buffer = await new Response(result.stream).arrayBuffer();

  let parsed: ParsedWorkbook;
  try {
    parsed = parseWallaWorkbook(buffer);
  } catch {
    return {
      ok: false,
      fetchError: "raw data 파일을 파싱하지 못했습니다. 파일이 손상되었거나 xlsx/csv 형식이 아닙니다.",
    };
  }

  const validation = validateWallaHeaderRow(parsed.headerRow);
  return { ok: true, parsed, validation };
}
