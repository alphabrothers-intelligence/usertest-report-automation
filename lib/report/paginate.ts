import { SECTION_BANNER } from "@/lib/report/sectionStyle";

/**
 * **블록을 A4 쪽으로 묶는 규칙.** 전체 보고서 웹뷰와 축소판이 **같은 함수를 쓴다** — 두 벌이
 * 되면 한쪽만 고쳐져 같은 데이터가 다른 쪽 나눔으로 나온다(2026-09-10 담당자 지시: "두 버전
 * 모두 추가되어야 한다").
 *
 * 높이는 실제 렌더한 DOM에서 재서 넘긴다(여기서는 계산만 한다) — 글자 수나 블록 종류로
 * 어림하면 차트·표처럼 내용에 따라 높이가 크게 달라지는 블록에서 어긋난다.
 *
 * ## 규칙 두 가지 (2026-09-10 실측으로 정함)
 *
 * 정리습관 보고서 46쪽을 재보니 **제목 하나만 있는 쪽이 4개**(채움 4%·4%·4%·10%)였고, 원인은
 * 전부 같았다 — 제목 다음 블록이 한 쪽보다 커서 그 블록만 새 쪽으로 밀렸고 제목은 앞 쪽에
 * 혼자 남았다. 그래서:
 *
 * 1. **한 쪽보다 큰 블록은 새 쪽으로 밀지 않는다.** 어차피 한 쪽에 안 들어가 브라우저가
 *    쪼개므로, 밀어봐야 앞 쪽만 비고 결과는 같다. 남은 자리에서 시작하게 둔다.
 * 2. **제목은 쪽 끝에 혼자 남지 않는다.** 쪽을 넘길 때 끝에 붙어 있던 제목 블록들을 다음
 *    쪽으로 함께 데려간다(모두가 제목이면 데려가지 않는다 — 빈 쪽이 생긴다).
 */

/**
 * 장 제목 배너가 첫 쪽에서 차지하는 높이(px). **상수에서 계산한다** — 예전엔 110px로 어림했는데
 * 실제는 33.24pt + 아래 여백 11.52pt = 약 60px이라, 장마다 첫 쪽에서 13mm를 헛되이 잡고 있었다
 * (2026-09-10 실측). 배너 치수를 바꾸면 여기 값도 자동으로 따라간다.
 */
export const SECTION_BANNER_RESERVE_PX = Math.ceil((SECTION_BANNER.height + SECTION_BANNER.marginBottom) * (96 / 72));

export type BlockMetric = {
  id: string;
  /** 블록 사이 여백까지 포함한 실제 렌더 높이(px). */
  height: number;
  /** 제목 블록인가. 뒤따르는 내용과 떨어지면 안 된다. */
  isHeading: boolean;
};

export function paginateBlocks(
  blocks: BlockMetric[],
  /** 쪽 하나에 들어가는 본문 높이(px). */
  capacity: number,
  /** 첫 쪽에 미리 잡아둘 높이(장 제목 배너 등). */
  firstPageReserve = 0,
): string[][] {
  if (blocks.length === 0) return [];
  const heightById = new Map(blocks.map((block) => [block.id, block.height]));
  const headingIds = new Set(blocks.filter((block) => block.isHeading).map((block) => block.id));

  const pages: string[][] = [];
  let current: string[] = [];
  let used = firstPageReserve;

  for (const block of blocks) {
    // 규칙 1 — 한 쪽보다 큰 블록은 어디에 두든 쪼개진다. 새 쪽을 열지 않는다.
    const oversized = block.height > capacity;
    if (!oversized && current.length > 0 && used + block.height > capacity) {
      // 규칙 2 — 쪽 끝의 제목들은 다음 쪽으로 함께 넘긴다.
      let cut = current.length;
      while (cut > 0 && headingIds.has(current[cut - 1])) cut -= 1;
      const carried = cut === 0 ? [] : current.splice(cut);
      pages.push(current);
      current = carried;
      used = carried.reduce((sum, id) => sum + (heightById.get(id) ?? 0), 0);
    }
    current.push(block.id);
    used += block.height;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
