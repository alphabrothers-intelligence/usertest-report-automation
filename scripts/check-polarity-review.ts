/**
 * 카테고리 극성 확인 표시 규칙(`categoryPolarityNeedsReview`) 자체 검사.
 * API·DB 없이 순수 함수만 돌린다 — `npm run check:polarity-review`.
 *
 * 규칙이 잡아야 하는 것은 "부정↔중립 어디로 가도 이상하지 않은 묶음"뿐이다. 구체적인 손해가
 * 적힌 부정(=흔들리지 않는 판정)까지 표시하면 확인 피로만 늘어 표시가 무시된다(6.4절 정신).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { categoryPolarityNeedsReview } from "../lib/pipeline/confidence";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";
import { buildReportWorkspaceSeed } from "../lib/report/workspace";

const flagged = (category: Parameters<typeof categoryPolarityNeedsReview>[0]) =>
  categoryPolarityNeedsReview(category) !== null;

// 짧은 감정 표현만 있는 부정·중립 → 표시한다.
assert.ok(flagged({ polarity: "negative", quotes: ["조금 불편했어요", "아쉽습니다"] }));
assert.ok(flagged({ polarity: "neutral", quotes: ["별로 특별하진 않았어요"] }));

// 무엇이 어떻게 안 됐는지가 있는 부정 → 표시하지 않는다.
assert.ok(!flagged({ polarity: "negative", quotes: ["설명이 없어서 시작 버튼을 못 찾았어요"] }));
assert.ok(!flagged({ polarity: "negative", quotes: ["GPS가 자꾸 끊겨서 기록이 사라집니다"] }));
// 감정어가 있어도 길게 서술된 불만은 경계 사례가 아니다(실측 기준 SHORT_QUOTE_CHARS).
assert.ok(!flagged({ polarity: "negative", quotes: ["연출이 너무 부족하여 보는 재미가 심각하게 떨어졌고 계속할 이유를 찾기 힘들었습니다"] }));

// 긍정과 개선아이디어(polarity=null)는 대상이 아니다.
assert.ok(!flagged({ polarity: "positive", quotes: ["불편 없이 즐거웠어요"] }));
assert.ok(!flagged({ polarity: null, quotes: ["아쉽지만 좋았어요"] }));

// 감정어가 아예 없는 사실 서술은 경계 사례가 아니다.
assert.ok(!flagged({ polarity: "neutral", quotes: ["주 2회 정도 사용했습니다"] }));

console.log("PASS - categoryPolarityNeedsReview 8/8");

// --- 실제 보고서 HTML에 표식이 실리는지 (lib/report/workspace.ts categoryHtml 경로) ---
// 규칙만 맞아도 표식이 문서에 안 실리면 왼쪽 패널은 영원히 비어 있다. 규칙 단위 검사와
// 별개로 실제 빌더를 한 번 돌려서 확인한다.
const buffer = readFileSync(new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url));
const parsed = parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
const quantStats = computeQuantStats(normalizeWallaRows(parsed.headerRow, parsed.dataRows), parsed.headerRow);
const category = (id: string, polarity: "negative" | "positive", label: string, quotes: string[]) => ({
  id, question_id: "q1", polarity, label, clause_count: quotes.length, quotes,
  quotes_display: null, insight_draft: "요약", insight_final: null, insight_approved: true, polarity_reviewed: false, respondents: null,
});
const seed = buildReportWorkspaceSeed({
  quantStats,
  qualitative: [{
    id: "q1", question_key: "feature:펫과의 산책", label: "펫과의 산책", kind: "standard", polarity_summaries: null,
    categories: [
      category("c1", "negative", "전반적인 아쉬움", ["조금 불편했어요"]),
      category("c2", "negative", "지도 오류", ["GPS가 자꾸 끊깁니다"]),
      category("c3", "positive", "산책 재미", ["즐거웠어요"]),
    ],
  }],
  recommendations: [],
});
const html = seed.sections.flatMap((section) => section.blocks)
  .map((block) => "html" in block ? block.html : "").join("");
const markers = [...html.matchAll(/data-category-label="([^"]*)"[^>]*data-polarity-review=/g)].map((match) => decodeURIComponent(match[1]));
assert.deepEqual(markers, ["전반적인 아쉬움"], `표식이 흔들리는 묶음에만 붙어야 합니다: ${JSON.stringify(markers)}`);

console.log("PASS - 보고서 HTML 표식 1/1");
