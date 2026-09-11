/**
 * 쪽 묶기 규칙 회귀 검사 — `npm run check:pagination`. API·DB·서버 불필요.
 * 실측으로 정한 두 규칙(한 쪽보다 큰 블록은 안 밀기 / 제목은 혼자 안 남기)을 고정한다.
 */
import assert from "node:assert";
import { paginateBlocks, type BlockMetric } from "../lib/report/paginate";

const CAP = 1000;
const block = (id: string, height: number, isHeading = false): BlockMetric => ({ id, height, isHeading });

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("빈 입력은 빈 결과", () => {
  assert.deepStrictEqual(paginateBlocks([], CAP), []);
});

check("한 쪽에 들어가면 한 쪽", () => {
  const pages = paginateBlocks([block("a", 300), block("b", 300)], CAP);
  assert.deepStrictEqual(pages, [["a", "b"]]);
});

check("넘치면 다음 쪽으로", () => {
  const pages = paginateBlocks([block("a", 600), block("b", 600)], CAP);
  assert.deepStrictEqual(pages, [["a"], ["b"]]);
});

check("첫 쪽 예약 높이를 센다", () => {
  const pages = paginateBlocks([block("a", 600), block("b", 300)], CAP, 200);
  assert.deepStrictEqual(pages, [["a"], ["b"]]);
});

check("규칙 1 — 한 쪽보다 큰 블록은 앞 쪽에 이어 붙인다", () => {
  // 예전 규칙이면 giant가 새 쪽으로 밀려 앞 쪽이 300/1000만 차고 끝났다.
  const pages = paginateBlocks([block("a", 300), block("giant", 2500)], CAP);
  assert.deepStrictEqual(pages, [["a", "giant"]]);
});

check("규칙 2 — 쪽 끝 제목은 다음 쪽으로 함께 넘어간다", () => {
  const pages = paginateBlocks([block("a", 800), block("h", 50, true), block("b", 400)], CAP);
  assert.deepStrictEqual(pages, [["a"], ["h", "b"]]);
});

check("규칙 2 — 연달아 붙은 제목도 함께 넘어간다", () => {
  const pages = paginateBlocks(
    [block("a", 800), block("h1", 40, true), block("h2", 40, true), block("b", 400)],
    CAP,
  );
  assert.deepStrictEqual(pages, [["a"], ["h1", "h2", "b"]]);
});

check("규칙 2 — 쪽이 통째로 제목뿐이면 넘기지 않는다(빈 쪽 방지)", () => {
  const pages = paginateBlocks([block("h", 900, true), block("b", 400)], CAP);
  assert.deepStrictEqual(pages, [["h"], ["b"]]);
});

check("규칙 1+2 — 제목 다음이 한 쪽보다 큰 블록이어도 제목이 혼자 남지 않는다", () => {
  // 2026-09-10 정리습관 실측 사례: 제목만 있는 4% 쪽이 이 조합에서 나왔다.
  // 지금은 제목도 거대 블록도 앞 쪽 남은 자리에서 이어진다 — 쪽이 통째로 버려지지 않는다.
  const pages = paginateBlocks([block("a", 900), block("h", 50, true), block("giant", 3000)], CAP);
  assert.deepStrictEqual(pages, [["a", "h", "giant"]]);
});

console.log(`\n${passed}/${passed} PASS`);
