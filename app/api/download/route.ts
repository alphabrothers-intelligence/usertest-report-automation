import { NextResponse } from "next/server";
import { getBlobWithRetry } from "@/lib/blob/getWithRetry";

// Blob 스토어가 private 전용이라(2026-07-19, FileUploadButton 참고) 완성된 PDF도 private로
// 올라간다. private 블롭은 토큰 인증 없이 못 열리므로, 채팅에 주는 다운로드 링크는 이 라우트를
// 가리키게 하고, 서버가 BLOB_READ_WRITE_TOKEN으로 대신 읽어서 스트리밍해준다(assembleReport
// 참고). `u` 쿼리에 실제 블롭 URL을 그대로 받되, 우리 Blob 스토어 호스트가 아니면 거부한다 —
// 이 라우트가 임의 URL을 대신 가져와주는 오픈 프록시가 되지 않도록 하는 안전장치.
function isOwnBlobUrl(url: URL): boolean {
  return url.protocol === "https:" && url.hostname.endsWith(".private.blob.vercel-storage.com");
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  const { searchParams } = new URL(request.url);
  const blobUrl = searchParams.get("u");
  const fileName = searchParams.get("name") ?? "report.pdf";
  const inline = searchParams.get("inline") === "1" && fileName.toLowerCase().endsWith(".pdf");

  if (!blobUrl) {
    return NextResponse.json({ error: "u 파라미터가 필요합니다." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(blobUrl);
  } catch {
    return NextResponse.json({ error: "잘못된 URL입니다." }, { status: 400 });
  }

  if (!isOwnBlobUrl(parsed)) {
    return NextResponse.json({ error: "허용되지 않은 URL입니다." }, { status: 400 });
  }

  const result = await getBlobWithRetry(blobUrl);
  if (!result) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  // DOCX 다운로드 추가(2026-07-23)로 이 라우트가 PDF 전용이 아니게 됐다 — 파일명 확장자로
  // Content-Type을 정한다(고정 application/pdf였던 걸 일반화). 잘못된 MIME 타입을 주면
  // 일부 브라우저·오피스 앱이 파일을 열지 못하거나 경고를 띄운다.
  const lowerFileName = fileName.toLowerCase();
  const contentType = lowerFileName.endsWith(".docx")
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : lowerFileName.endsWith(".hwpx")
      ? "application/hwp+zip"
      : "application/pdf";

  return new Response(result.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
