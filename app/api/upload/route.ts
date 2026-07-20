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
      // onUploadCompleted를 일부러 안 준다. 아무 일도 안 하는 빈 콜백이었는데도(체크포인트
      // 상태 저장은 이 훅과 무관하게 lib/db/reports.ts가 담당), @vercel/blob이 onUploadCompleted가
      // 있으면 콜백 URL로 완료 알림을 보내려 시도하고 — 로컬 dev(localhost)는 외부에서 도달 불가능한
      // 주소라 콜백이 영원히 실패한다. 실측 확인(2026-07-20): 이 콜백이 있는 채로는 방금 업로드한
      // private 블롭을 서버가 곧바로 get()으로 못 읽어서(재시도를 6초까지 늘려도 계속 MISS)
      // "파일을 찾을 수 없음" 에러가 사용자에게 그대로 노출됐다 — private 블롭이 콜백 완료 전까지는
      // 완전히 커밋되지 않는 것으로 보인다. 콜백을 아예 안 쓰면(이 프로젝트는 애초에 필요 없음)
      // 이 문제 자체가 사라진다.
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "upload failed" },
      { status: 400 },
    );
  }
}
