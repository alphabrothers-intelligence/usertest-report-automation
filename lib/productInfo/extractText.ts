// 기업/제품 소개 파일(raw data가 아닌 별도 첨부, PDF/워드/텍스트)에서 원문 텍스트를 뽑아낸다.
// raw data와 마찬가지로 private 스토어에 업로드되므로 인증된 get()으로 읽는다
// (lib/walla/loadFromUrl.ts와 동일한 이유 — 실측 확인, 2026-07-19).
import { getBlobWithRetry } from "@/lib/blob/getWithRetry";

function extensionOf(fileUrl: string): string {
  const withoutQuery = fileUrl.split("?")[0];
  return withoutQuery.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * HWPX는 zip 안의 `Contents/section*.xml`에 본문이 있다. 문단 끝은 줄바꿈, 표 칸 끝은 ` | `로
 * 바꿔 표(사전요청서는 거의 전부 표다)의 행이 한 줄로 읽히게 한다.
 */
export async function extractHwpxText(buffer: Buffer | Uint8Array): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const sections = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const parts = await Promise.all(sections.map((name) => zip.file(name)!.async("string")));
  // 글자는 `<hp:t>` 안에만 있다. 태그를 통째로 지우면 하이퍼링크·필드 코드의 파라미터 문자열까지
  // 본문처럼 섞여 나온다(실측) — 글자와 문단·칸 경계만 골라낸다.
  const tokens = parts.join("\n").matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<\/hp:p>|<\/hp:tc>|<\/hp:tr>/g);
  let text = "";
  for (const [token, inner] of tokens) {
    if (inner !== undefined) text += inner.replace(/<[^>]+>/g, " ");
    else text += token === "</hp:tc>" ? " | " : "\n";
  }
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTextFromDocument(fileUrl: string): Promise<string> {
  const result = await getBlobWithRetry(fileUrl);
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

  if (ext === "hwpx") return extractHwpxText(buffer);
  if (ext === "hwp") {
    throw new Error("HWP(구버전) 파일은 읽을 수 없습니다. 한글에서 HWPX 또는 PDF로 저장해 다시 올려 주세요.");
  }

  // txt 또는 그 외 텍스트 계열 — 그대로 UTF-8로 디코딩.
  return buffer.toString("utf-8");
}
