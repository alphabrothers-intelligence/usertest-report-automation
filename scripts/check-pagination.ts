/**
 * 쪽 묶기 규칙 회귀 검사 — `npm run check:pagination`. API·DB·서버 불필요.
 * 실측으로 정한 두 규칙(한 쪽보다 큰 블록은 안 밀기 / 제목은 혼자 안 남기)을 고정한다.
 */
import assert from "node:assert";
import { paginateBlocks, type BlockMetric } from "../lib/report/paginate";
import { chunkByHeight, mergeSplitParts } from "../lib/report/splitBlock";
import type { ReportSectionContent } from "../lib/report/sections";

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
  // 새 쪽으로 밀면 앞 쪽이 300/1000만 차고 끝난다. 2026-09-13에 반대로 바꿔봤다가 실제 PDF가
  // 79쪽·빈 장 0개 → 85쪽·빈 장 2개로 나빠져 되돌렸다(paginate.ts 주석).
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
  const pages = paginateBlocks([block("a", 900), block("h", 50, true), block("giant", 3000)], CAP);
  assert.deepStrictEqual(pages, [["a", "h", "giant"]]);
});

check("규칙 2 — 제목까지 데려오면 넘칠 때는 제목을 두고 간다", () => {
  // 2026-09-14 케어클 실측: 제목(48px)을 데려온 뒤 용량을 다시 안 봐서 제목+거의 한 쪽짜리
  // 블록이 한 쪽에 얹혔고, 카드가 A4를 넘겨 PDF에서 쪼개졌다.
  const pages = paginateBlocks([block("a", 400), block("h", 50, true), block("b", 980)], CAP);
  assert.deepStrictEqual(pages, [["a", "h"], ["b"]]);
});

check("수동 — '여기서 쪽 나누기'는 자리가 남아도 새 쪽에서 시작한다", () => {
  const pages = paginateBlocks([block("a", 200), { ...block("b", 200), breakBefore: true }], CAP);
  assert.deepStrictEqual(pages, [["a"], ["b"]]);
});

check("수동 — '쪼개지 않기'는 한 쪽보다 커도 앞 쪽에 얹지 않는다", () => {
  // 규칙 1의 예외. 얹으면 카드가 A4를 넘겨 브라우저가 제멋대로 쪼개고, 지정한 뜻이 사라진다.
  const pages = paginateBlocks([block("a", 300), { ...block("big", 1500), keepTogether: true }], CAP);
  assert.deepStrictEqual(pages, [["a"], ["big"]]);
});

check("조각 나누기 — 묶음 수는 그리디와 같고 부스러기 묶음을 안 남긴다", () => {
  // 그리디면 앞 묶음이 10개(1,000)를 다 먹고 마지막에 1개(100)만 남아 쪽 하나가 거의 빈다.
  const chunks = chunkByHeight(Array(11).fill(100), 1000);
  assert.strictEqual(chunks.length, 2);
  assert.deepStrictEqual(chunks.map((chunk) => chunk.length), [6, 5]);
});

check("조각 나누기 — 한 쪽에 다 들어가면 안 자른다", () => {
  assert.deepStrictEqual(chunkByHeight([100, 200, 300], 1000), [[0, 1, 2]]);
});

check("조각 나누기 — 혼자 용량을 넘는 항목은 혼자 남는다", () => {
  assert.deepStrictEqual(chunkByHeight([100, 2000, 100], 1000), [[0], [1], [2]]);
});

check("마지막 쪽이 거의 비면 앞 쪽에서 당겨온다", () => {
  // 2026-09-15 실측: "유사 서비스 경험" 표 하나(93px)가 장 마지막 쪽을 통째로 차지했다.
  const pages = paginateBlocks([block("a", 500), block("h", 60, true), block("b", 440), block("tail", 100)], CAP);
  assert.deepStrictEqual(pages, [["a"], ["h", "b", "tail"]]);
});

check("당겨오다 쪽이 넘치면 멈춘다", () => {
  const pages = paginateBlocks([block("a", 600), block("b", 400), block("tail", 100)], CAP);
  assert.deepStrictEqual(pages, [["a"], ["b", "tail"]]);
  // 앞 쪽에 블록이 하나뿐이면 당겨오지 않는다 — 앞 쪽이 통째로 비어버린다.
  assert.deepStrictEqual(paginateBlocks([block("a", 950), block("tail", 100)], CAP), [["a"], ["tail"]]);
});

function section(keepTogether: string[], blocks: { id: string; html: string }[]): ReportSectionContent {
  return { numeral: "I", title: "개요", keepTogether, blocks: blocks.map((block) => ({ ...block, kind: "rich-static" as const })) };
}

// 글 조각을 다시 합치는 쪽(`mergePartHtml`)은 DOM이 필요해 브라우저 검사(`check:table-props`)가 맡는다.
check("수동 — '쪼개지 않기'를 켜면 이미 쪼개진 표 조각을 다시 붙인다", () => {
  const rows = (ids: string[]) => ids.map((id) => ({ id, cells: [id] }));
  const table = (id: string, ids: string[]) => ({ id, kind: "table" as const, headers: ["h"], rows: rows(ids) });
  const merged = mergeSplitParts([{ numeral: "I", title: "개요", keepTogether: ["t"], blocks: [table("t--p1", ["1"]), table("t--p2", ["2"])] } as unknown as ReportSectionContent]);
  assert.deepStrictEqual(merged?.[0].blocks.map((block) => block.id), ["t"]);
  assert.strictEqual((merged?.[0].blocks[0] as { rows: unknown[] }).rows.length, 2);
});

check("수동 — 붙일 것이 없으면 아무것도 안 바꾼다(재측정이 멈춘다)", () => {
  assert.strictEqual(mergeSplitParts([section(["t"], [{ id: "t", html: "<p>1</p>" }])]), null);
  assert.strictEqual(mergeSplitParts([section([], [{ id: "t--p1", html: "<p>1</p>" }])]), null);
});


// ── 앞 블록과 붙여두기 — 쪽이 갈릴 때 앞 블록도 함께 데려간다(2026-09-17) ──────────────
const glueMetrics: BlockMetric[] = [
  { id: "a", height: 400, isHeading: false },
  { id: "banner", height: 60, isHeading: false },
  { id: "body", height: 500, isHeading: false, keepWithPrevious: true },
];
check("수동 — 붙여두기 블록은 앞 블록과 함께 넘어간다", () => {
  assert.deepEqual(paginateBlocks(glueMetrics, 900), [["a"], ["banner", "body"]]);
});
check("수동 — 붙여두기를 끄면 예전 그대로", () => {
  assert.deepEqual(paginateBlocks(glueMetrics.map((m) => ({ ...m, keepWithPrevious: false })), 900), [["a", "banner"], ["body"]]);
});

console.log(`\n${passed}/${passed} PASS`);
