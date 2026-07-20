// 기업/제품 소개 파일(raw data가 아닌 별도 첨부, PDF/워드/텍스트)에서 원문 텍스트를 뽑아낸다.
// raw data와 마찬가지로 private 스토어에 업로드되므로 인증된 get()으로 읽는다
// (lib/walla/loadFromUrl.ts와 동일한 이유 — 실측 확인, 2026-07-19).
import { get } from "@vercel/blob";

function extensionOf(fileUrl: string): string {
  const withoutQuery = fileUrl.split("?")[0];
  return withoutQuery.split(".").pop()?.toLowerCase() ?? "";
}

export async function extractTextFromDocument(fileUrl: string): Promise<string> {
  const result = await get(fileUrl, { access: "private" });
  if (!result) {
    throw new Error("파일을 찾을 수 없습니다.");
  }
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());

  const ext = extensionOf(fileUrl);

  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const { text } = await parser.getText();
      return text;
    } finally {
      await parser.destroy();
    }
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  // txt 또는 그 외 텍스트 계열 — 그대로 UTF-8로 디코딩.
  return buffer.toString("utf-8");
}
