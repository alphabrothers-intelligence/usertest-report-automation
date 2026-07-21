import { get, type GetBlobResult } from "@vercel/blob";

const NOT_FOUND_RETRY_DELAYS_MS = [500, 1000, 2000, 3000, 4000, 5000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 업로드 직후 곧바로 읽으면 Blob 저장소의 전파 지연(eventual consistency)으로 실제로는 존재하는
 * 파일인데도 순간적으로 404가 날 수 있다(get()은 404를 예외가 아니라 null로 반환 —
 * node_modules/@vercel/blob/dist/index.js 확인). 실사용 중 겪은 "파일을 찾을 수 없음" 에러의
 * 주된 원인은 별도로 있었지만(app/api/upload/route.ts의 onUploadCompleted 콜백 제거로 해결,
 * 2026-07-20), 그 수정 이후에도 ~6회 중 1회꼴로 6초 재시도로는 부족한 경우가 실측으로 재현됐다
 * (2026-07-20, 같은 날 재확인) — 이 에러는 "무조건 나면 안 되는" 항목이라 재시도 예산을 총
 * 7회(~15.5초)까지 늘렸다. 그래도 안 되면 진짜 없는 파일(잘못된 URL, 만료 등)로 간주해 마지막
 * 실패를 로그로 남긴다. lib/walla/loadFromUrl.ts와 lib/productInfo/extractText.ts가 공유한다.
 */
export async function getBlobWithRetry(fileUrl: string): Promise<GetBlobResult | null> {
  let result = await get(fileUrl, { access: "private" });
  for (let attempt = 0; !result && attempt < NOT_FOUND_RETRY_DELAYS_MS.length; attempt++) {
    await sleep(NOT_FOUND_RETRY_DELAYS_MS[attempt]);
    result = await get(fileUrl, { access: "private" });
  }
  if (!result) {
    console.error(`[getBlobWithRetry] exhausted ${NOT_FOUND_RETRY_DELAYS_MS.length + 1} attempts, still not found: ${fileUrl}`);
  }
  return result;
}
