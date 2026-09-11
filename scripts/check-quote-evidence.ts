/**
 * 인용문 근거 강조(볼드+밑줄) 규칙 검사 — `npm run check:quote-evidence`.
 * LLM·DB 없이 buildQuoteDisplayText만 돌린다.
 *
 * 지켜야 하는 것 두 가지:
 *  1) 강조 마커를 걷어내면 **원문 인용문이 그대로 복원**돼야 한다(원문 훼손 금지).
 *  2) 강조 구간은 인용문 안에 실제로 있는 **연속된** 구간이어야 하고, 너무 짧거나 문장
 *     대부분을 덮으면 안 된다(무분별한 볼드 금지).
 */
import assert from "node:assert/strict";
import { headTrim } from "../lib/pipeline/anchorQuotes";
import { buildQuoteDisplayText } from "../lib/pipeline/stage2";

const marked = (text: string) => text.match(/\*\*__(.+?)__\*\*/)?.[1] ?? null;
const stripped = (text: string) => text.replace(/\*\*__/g, "").replace(/__\*\*/g, "");

function check(quote: string, evidence: { quote: string; reasonSpan: string }[], expectSpan: string | null, label: string) {
  const display = buildQuoteDisplayText(quote, evidence);
  assert.equal(stripped(display), quote, `${label}: 마커를 걷어내면 원문과 같아야 합니다`);
  const span = marked(display);
  assert.equal(span, expectSpan, `${label}: 강조 구간 불일치`);
  if (span) {
    assert.ok(quote.includes(span), `${label}: 강조 구간이 인용문 안의 연속 구간이 아닙니다`);
    // 짧은 인용문(25자 이하)은 문장 전체 강조를 허용한다 — buildQuoteDisplayText와 같은 규칙.
    const withinRatio = quote.length <= 25 || span.length <= quote.length * 0.9;
    assert.ok(span.length >= 4 && withinRatio, `${label}: 강조 길이 규칙 위반`);
  }
}

const quote = "산책으로 재화 수급은 너무 적어 매우 아쉽습니다";

// 완전 일치 — 예전부터 되던 경로.
check(quote, [{ quote, reasonSpan: "재화 수급은 너무 적어" }], "재화 수급은 너무 적어", "완전 일치");
// 인용문을 옮겨 적으며 띄어쓰기가 달라진 경우(실측된 실패 원인).
check(quote, [{ quote: "산책으로 재화수급은 너무 적어 매우 아쉽습니다", reasonSpan: "재화 수급은 너무 적어" }], "재화 수급은 너무 적어", "인용문 공백 차이");
// 근거 구간 쪽 띄어쓰기가 다른 경우 — 원문 기준 구간을 찾아 그대로 강조한다.
check(quote, [{ quote, reasonSpan: "재화수급은너무적어" }], "재화 수급은 너무 적어", "구간 공백 차이");
// 다른 인용문에 붙어 온 근거라도 이 인용문 안에서 찾아지면 쓴다.
check(quote, [{ quote: "전혀 다른 문장입니다", reasonSpan: "매우 아쉽습니다" }], "매우 아쉽습니다", "인용문 매칭 실패 폴백");
// 아예 없는 구간은 강조하지 않는다.
check(quote, [{ quote, reasonSpan: "존재하지 않는 근거" }], null, "구간 없음");
// 모델이 근거를 안 준 경우.
check(quote, [], null, "근거 없음");
// 무분별한 볼드 금지 — 문장 전체(90% 초과)나 너무 짧은 구간은 강조하지 않는다.
check(quote, [{ quote, reasonSpan: quote }], null, "문장 전체 강조 금지");
// 짧은 인용문은 문장 전체가 곧 논점이라 상한을 풀어 강조한다(2026-09-10: 15자 이하 강조율 17% → 원인).
const short = "버튼이 사용중 자꾸 눌리는것";
check(short, [{ quote: short, reasonSpan: short }], short, "짧은 인용문 전체 강조 허용");
check(short, [{ quote: short, reasonSpan: "자꾸 눌리는것" }], "자꾸 눌리는것", "짧아도 부분 구간이 있으면 그대로");
check(quote, [{ quote, reasonSpan: "재화" }], null, "너무 짧은 강조 금지");


// headTrim — 근거 구간이 없는 긴 인용문을 앞에서부터 조각 경계로 자른다(2026-09-10 담당자 지적:
// 502자짜리가 통째로 실렸다). 이 함수는 강조와 무관하므로 위 check()와 다른 방식으로 본다.
{
  const long =
    "설명이 다소 애매하게 느껴졌습니다. 설명서의 그림을 보면 shot이라는 단어 아래 여러 색상의 LED가 한 번에 묶여 설명되어 있었는데, 실제로 기기에는 shot, eye, body처럼 모드가 각각 따로 표시되어 있습니다. 그래서 처음에는 shot 모드에서 여러 색상이 순서대로 나온다는 의미인지 헷갈렸습니다.";
  const cut = headTrim(long);
  assert.ok(cut.length <= 130, `headTrim: 상한 이하여야 합니다 (${cut.length}자)`);
  assert.ok(long.startsWith(cut), "headTrim: 원문의 연속 구간이어야 합니다(verbatim)");
  assert.ok(/[.!?]$|다$/.test(cut), `headTrim: 문장 중간에서 끊기면 안 됩니다 (…${cut.slice(-14)})`);
  assert.equal(headTrim("짧은 문장입니다."), "짧은 문장입니다.", "headTrim: 짧은 인용문은 그대로 둡니다");
}

console.log("PASS - buildQuoteDisplayText 10/10 · headTrim 4/4");
