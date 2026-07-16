import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

// PRD 10장: 파일당 최대 500MB, 클라이언트 업로드(브라우저→Blob 직접 전송) 방식 필수.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/pdf",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Phase 1: 별도 영속화 없음. 체크포인트 상태 저장은 Phase 5(DB)에서 추가.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "upload failed" },
      { status: 400 },
    );
  }
}
