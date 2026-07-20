import { get, type GetBlobResult } from "@vercel/blob";

const NOT_FOUND_RETRY_DELAYS_MS = [400, 800, 1600, 3200];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 업로드 직후 곧바로 읽으면 Blob 저장소의 전파 지연(eventual consistency)으로 실제로는 존재하는
 * 파일인데도 순간적으로 404가 날 수 있다(get()은 404를 예외가 아니라 null로 반환 —
 * node_modules/@vercel/blob/dist/index.js 확인). 실사용 중 겪은 "파일을 찾을 수 없음" 에러의
 * 진짜 원인은 별도로 있었지만(app/api/upload/route.ts의 onUploadCompleted 콜백 제거로 해결,
 * 2026-07-20), 이 재시도는 그것과 무관하게 남아있을 수 있는 순수 타이밍 이슈에 대한 안전망으로
 * 그대로 둔다. 총 4회, 최대 ~6초까지 지수 백오프로 재시도한 뒤에도 안 되면 진짜 없는 파일(잘못된
 * URL, 만료 등)로 간주한다. lib/walla/loadFromUrl.ts와 lib/productInfo/extractText.ts가 공유한다.
 */
export async function getBlobWithRetry(fileUrl: string): Promise<GetBlobResult | null> {
  let result = await get(fileUrl, { access: "private" });
  for (let attempt = 0; !result && attempt < NOT_FOUND_RETRY_DELAYS_MS.length; attempt++) {
    await sleep(NOT_FOUND_RETRY_DELAYS_MS[attempt]);
    result = await get(fileUrl, { access: "private" });
  }
  return result;
}
