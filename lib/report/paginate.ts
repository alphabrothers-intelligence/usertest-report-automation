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
  /** 담당자가 "여기서 쪽 나누기"를 지정했다 — 남은 자리가 있어도 새 쪽에서 시작한다. */
  breakBefore?: boolean;
  /**
   * 담당자가 "이 블록은 쪼개지 않기"를 지정했다. 쪼개지 않으므로 **규칙 1의 예외**다 —
   * 한 쪽보다 커도 앞 쪽에 얹지 않고 새 쪽에서 시작한다(얹으면 그 카드가 A4를 넘겨 브라우저가
   * 제멋대로 쪼개고, 그러면 "쪼개지 않기"를 지정한 뜻이 사라진다).
   */
  keepTogether?: boolean;
  /**
   * 담당자가 "앞 블록과 붙여두기"를 지정했다 — 쪽이 갈릴 때 앞 블록도 함께 다음 쪽으로
   * 데려간다(제목 데려가기와 같은 방식). 배너와 본문처럼 갈라지면 안 되는 쌍에 쓴다.
   */
  keepWithPrevious?: boolean;
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
  // 붙여두기로 지정된 블록은 "앞 블록과 한 덩어리"다 — 쪽 끝에서 잘릴 때 제목처럼 함께 넘긴다.
  const glueIds = new Set(blocks.filter((block) => block.keepWithPrevious).map((block) => block.id));

  const pages: string[][] = [];
  let current: string[] = [];
  let used = firstPageReserve;

  for (const block of blocks) {
    // 규칙 1 — 한 쪽보다 큰 블록은 어디에 두든 쪼개진다. 새 쪽을 열지 않는다.
    //
    // **2026-09-13에 뒤집어봤다가 되돌렸다.** "못 쪼개는 블록은 혼자 새 쪽에서 시작하게 하면
    // 앞 쪽 여백이 온전하다"는 생각이었는데, 실제 보고서로 인쇄해보니 **79쪽·빈 장 0개에서
    // 85쪽·빈 장 2개로 나빠졌다** — 큰 블록이 새 쪽으로 갈 때마다 앞 쪽이 헐거워지고 그중
    // 일부는 통째로 비었다. 앞 쪽을 채우는 쪽이 낫다. 되돌리려면 반드시 실제 PDF로 잴 것
    // (`npm run check:page-fit`).
    const oversized = block.height > capacity && !block.keepTogether;
    if (block.breakBefore && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    } else if (!oversized && current.length > 0 && used + block.height > capacity) {
      // 규칙 2 — 쪽 끝의 제목들은 다음 쪽으로 함께 넘긴다.
      let cut = current.length;
      while (cut > 0 && headingIds.has(current[cut - 1])) cut -= 1;
      // 이 블록이 "앞 블록과 붙여두기"면 앞 블록(과 그 앞의 제목들)도 함께 데려간다.
      if (glueIds.has(block.id) && cut > 0) {
        cut -= 1;
        while (cut > 0 && headingIds.has(current[cut - 1])) cut -= 1;
      }
      // 단, **데려온 제목까지 더해 새 쪽이 넘치면 데려오지 않는다.** 데려오고 나서 용량을 다시
      // 안 보던 예전 코드는 제목+거의 한 쪽짜리 블록을 한 쪽에 얹어 카드가 A4를 넘겼다
      // (2026-09-14 케어클 실측: 제목 48px + 설문 표 조각 875px = 923px, 용량 911px).
      const carriedHeight = current.slice(cut).reduce((sum, id) => sum + (heightById.get(id) ?? 0), 0);
      const carried = cut === 0 || carriedHeight + block.height > capacity ? [] : current.splice(cut);
      pages.push(current);
      current = carried;
      used = carried.reduce((sum, id) => sum + (heightById.get(id) ?? 0), 0);
    }
    current.push(block.id);
    used += block.height;
  }
  if (current.length > 0) pages.push(current);

  balanceTail(pages, heightById, headingIds, new Set(blocks.filter((block) => block.breakBefore).map((block) => block.id)), capacity);
  return pages;
}

/**
 * **장의 마지막 쪽이 거의 비면 앞 쪽에서 당겨온다.**
 *
 * 앞에서부터 꽉 채우면 장 끝에 작은 블록 하나만 남아 쪽 하나를 통째로 쓰는 일이 흔하다
 * (2026-09-15 실측: "유사 서비스 경험" 표 93px 하나가 케어클·이젠오토 Ⅱ장 마지막 쪽을
 * 독차지했다). `chunkByHeight`가 조각을 고르게 나누는 것과 같은 이유다 — 쪽 수는 그대로인 채
 * 빈 쪽만 없어진다.
 *
 * 옮기다 앞 쪽 끝에 제목만 남으면 그 제목도 데려간다(규칙 2와 같은 이유).
 */
function balanceTail(
  pages: string[][],
  heightById: Map<string, number>,
  headingIds: Set<string>,
  breakBeforeIds: Set<string>,
  capacity: number,
): void {
  if (pages.length < 2) return;
  const last = pages[pages.length - 1];
  const previous = pages[pages.length - 2];
  const total = (page: string[]) => page.reduce((sum, id) => sum + (heightById.get(id) ?? 0), 0);
  const canPull = () => {
    if (previous.length <= 1) return false;
    // 담당자가 "여기서 쪽 나누기"를 지정한 블록은 쪽 맨 앞이어야 한다 — 앞에 뭘 끼워 넣지 않는다.
    if (last.length > 0 && breakBeforeIds.has(last[0])) return false;
    const candidate = previous[previous.length - 1];
    return total(last) + (heightById.get(candidate) ?? 0) <= capacity;
  };

  while (total(last) < capacity / 3 && canPull()) last.unshift(previous.pop() as string);
  while (previous.length > 1 && headingIds.has(previous[previous.length - 1]) && canPull()) last.unshift(previous.pop() as string);
}
