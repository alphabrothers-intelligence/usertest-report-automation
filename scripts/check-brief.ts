/**
 * 축소판 줄이기 규칙 회귀 검사 — `npm run check:brief`. API·DB·서버 불필요.
 *
 * 핵심은 **빼면 안 되는 것을 빼지 않는 것**이다(2026-09-10 담당자 지시: 항목은 다 들어가되
 * 내용만 줄어야 한다). 중첩 div를 짝 세기로 자르므로 경계가 틀리면 HTML이 깨진다 — 그것도 같이 본다.
 */
import assert from "node:assert";
import { trimCategoryHtml, toBriefSections, CATEGORIES_PER_POLARITY, QUOTES_PER_CATEGORY } from "../lib/report/brief";
import type { ReportSectionContent } from "../lib/report/sections";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const quote = (text: string) =>
  `<div data-report-quote data-quote-source="q1" style="margin:0"><p style="display:inline">"${text}"</p></div>`;
const category = (label: string, polarity: string, quotes: string[]) =>
  `<div data-quote-category data-category-question="q1" data-category-label="${label}" data-category-polarity="${polarity}">` +
  `<p><strong>[${label}]</strong></p>${quotes.map(quote).join("")}<p><em>→ 인사이트</em></p></div>`;

check("인용문 묶음이 없으면 그대로 둔다", () => {
  const html = "<p>도표 설명</p>";
  assert.strictEqual(trimCategoryHtml(html), html);
});

check("극성마다 정해진 개수만 남는다", () => {
  const many = (polarity: string, count: number) =>
    Array.from({ length: count }, (_, i) => category(`${polarity}${i}`, polarity, ["a"])).join("");
  const out = trimCategoryHtml(many("positive", CATEGORIES_PER_POLARITY + 2) + many("negative", CATEGORIES_PER_POLARITY + 2));
  const kept = (out.match(/data-quote-category/g) ?? []).length;
  assert.strictEqual(kept, CATEGORIES_PER_POLARITY * 2, `극성당 ${CATEGORIES_PER_POLARITY}개씩 남아야 한다`);
  assert.ok(out.includes("positive0") && out.includes("negative0"), "각 극성의 첫 묶음은 남아야 한다");
  assert.ok(!out.includes(`positive${CATEGORIES_PER_POLARITY}`), "정해진 개수를 넘으면 빠져야 한다");
});

check("극성 배너·본문 텍스트는 그대로 남는다", () => {
  const html = "<p>1. 긍정 의견 (28.7%)</p>" + category("좋음", "positive", ["a", "b"]);
  const out = trimCategoryHtml(html);
  assert.ok(out.includes("1. 긍정 의견 (28.7%)"), "배너가 사라지면 안 된다");
  assert.ok(out.includes("인사이트"), "인사이트 문장이 사라지면 안 된다");
});

check("남긴 묶음의 대표 인용문 수가 상한을 넘지 않는다", () => {
  const out = trimCategoryHtml(category("좋음", "positive", ["첫째", "둘째", "셋째", "넷째"]));
  const kept = (out.match(/data-report-quote/g) ?? []).length;
  assert.strictEqual(kept, QUOTES_PER_CATEGORY);
  assert.ok(out.includes("첫째"), "앞에서부터 남긴다");
});

check("중첩 div 경계를 정확히 잘라 HTML이 깨지지 않는다", () => {
  const html = category("좋음", "positive", ["a", "b"]) + "<p>꼬리</p>";
  const out = trimCategoryHtml(html);
  const opens = (out.match(/<div/g) ?? []).length;
  const closes = (out.match(/<\/div>/g) ?? []).length;
  assert.strictEqual(opens, closes, `div 짝이 맞아야 한다 (열림 ${opens} 닫힘 ${closes})`);
  assert.ok(out.endsWith("<p>꼬리</p>"), "뒤 내용이 잘려나가면 안 된다");
});

check("블록·장을 빼지 않는다 — 개수가 그대로다", () => {
  const sections: ReportSectionContent[] = [
    {
      numeral: "I",
      title: "개요",
      blocks: [
        { id: "a", kind: "heading", variant: "numbered", number: "1", text: "제품 소개" },
        { id: "b", kind: "text", label: "본문", html: category("좋음", "positive", ["a", "b"]) },
      ],
    } as ReportSectionContent,
  ];
  const brief = toBriefSections(sections);
  assert.strictEqual(brief.length, sections.length, "장이 빠지면 안 된다");
  assert.strictEqual(brief[0].blocks.length, sections[0].blocks.length, "블록이 빠지면 안 된다");
  assert.deepStrictEqual(brief[0].blocks[0], sections[0].blocks[0], "도표·제목 블록은 손대지 않는다");
});

console.log(`\n${passed}/${passed} PASS`);
