// 인용문 끝맺음 판정(빨간 하이라이트 조건)과 결정론적 보완을 규칙만으로 점검한다.
// LLM 호출 없음 — `npm run check:quote-ending`으로 실행.
import assert from "node:assert/strict";
import { boundedDiff, correctionDiff, deterministicEndingCompletion, reportQuoteEndingToken, reportQuoteFillerCleanup, reportQuoteFlaggedWord, reportQuoteSpacingToken } from "../lib/report/quoteEnding";

// [인용문, 하이라이트할 토큰(null이면 검토 불필요), 보완 결과(null이면 결정론적 보완 불가)]
const cases: [string, string | null, string | null][] = [
  // 종결어미 오타 — 마침표가 있어도 종결이 성립하지 않으므로 검토 대상이다(2026-08-18).
  ["유저 수에 따라 많이 좌우되는 기능이라고 생각합니나.", "합니나", "유저 수에 따라 많이 좌우되는 기능이라고 생각합니다."],
  ["생각합니나", "합니나", "생각합니다."],
  ["좋았습니나.", "습니나", "좋았습니다."],
  ["이것이 문제입니나!", "입니나", "이것이 문제입니다."],
  // "니나"로 끝나도 종결어미가 아니면(명사 + 보조사 '나') 건드리지 않는다 — 앞 음절 ㅂ 받침으로 구분.
  ["같이 하는 사람은 어머니나", null, null],
  ["부족한 건 시간이나 머니나", null, null],
  // 정상 종결 — 손대지 않는다.
  ["유저 수에 따라 많이 좌우되는 기능이라고 생각합니다.", null, null],
  ["좋았어요", null, null],
  ["재미있네", null, null],
  // 해체(반말)·어간형 종결 — 2026-09-02 추가. 실제 인용문에서 뽑은 사례들이다.
  ["동물들은 귀엽지만 딱 거기까지 느낌으로 퀄리티가 다소 엉성하게 느껴져", "느껴져", "동물들은 귀엽지만 딱 거기까지 느낌으로 퀄리티가 다소 엉성하게 느껴집니다."],
  ["가장 낮은 가격인 5k도 벌기 힘들어서 진입장벽이 좀 높아", "높아", "가장 낮은 가격인 5k도 벌기 힘들어서 진입장벽이 좀 높습니다."],
  ["이 게임을 꼭 추천해야할 이유가 부족하여", "부족하여", "이 게임을 꼭 추천해야할 이유가 부족합니다."],
  ["추가 되어야 한다고 생각되어", "생각되어", "추가 되어야 한다고 생각됩니다."],
  ["딱맞는 앱인거같아여", "앱인거같아여", "딱맞는 앱인거같습니다."],
  ["개인적으로는 그렇게 생각해", "생각해", "개인적으로는 그렇게 생각합니다."],
  // 규칙으로 못 고치는 해체 종결은 표시만 하고 보완은 LLM 경로에 맡긴다.
  ["그래픽이 너무 아쉬워", "아쉬워", null],
  ["상자 먹을 수 있게", "있게", null],
  // 기존 연결어미 판정은 그대로 동작해야 한다(회귀 방지).
  ["초반에 거점을 지킬 펫이 없어 곤란했지만", "곤란했지만", "초반에 거점을 지킬 펫이 없어 곤란했습니다."],
  ["튜토리얼이 부족함", "부족함", "튜토리얼이 부족합니다."],
];

let failures = 0;
for (const [quote, expectedToken, expectedCompletion] of cases) {
  const token = reportQuoteEndingToken(quote);
  const completion = deterministicEndingCompletion(quote);
  try {
    assert.equal(token, expectedToken, `토큰 불일치: ${JSON.stringify(quote)}`);
    // 검토 대상이 아닌 인용문은 보완도 하지 않아야 한다(원문 훼손 방지).
    if (expectedToken === null) assert.equal(completion, null, `검토 대상이 아닌데 보완됨: ${JSON.stringify(quote)}`);
    else assert.equal(completion, expectedCompletion, `보완 결과 불일치: ${JSON.stringify(quote)}`);
    // 하이라이트는 토큰 문자열을 본문에서 찾아 감싸므로, 반드시 원문에 있어야 한다.
    if (token) assert.ok(quote.includes(token), `토큰이 원문에 없음: ${JSON.stringify(token)}`);
    // 보완은 "최소 보정"이어야 한다 — 배치 검토 라우트의 가드레일(5자)과 같은 기준.
    if (completion) assert.ok(boundedDiff(quote, completion, 5), `변경 폭이 과도함: ${JSON.stringify(quote)}`);
    console.log(`PASS  ${quote} → ${completion ?? "(보완 없음)"}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
    console.error(`      토큰=${JSON.stringify(token)} 보완=${JSON.stringify(completion)}`);
  }
}

// 띄어쓰기 검토(빨간 하이라이트 두 번째 조건) — 사전 없이 길이로만 판정하므로 경계만 지킨다.
const spacingCases: [string, string | null][] = [
  ["아오그냥입히면겁나귀여워", "아오그냥입히면겁나귀여워"],
  ["진짜 우리반려견꾸미는 느낌", "우리반려견꾸미는"],
  // 한 낱말로도 8자를 넘는 종결형은 어미를 떼고 세므로 걸리지 않아야 한다.
  ["전반적으로 만족스러웠습니다", null],
  ["기대했던 것보다 혼란스러웠습니다.", null],
  ["띄어쓰기가 정상인 문장입니다", null],
];
for (const [quote, expected] of spacingCases) {
  const token = reportQuoteSpacingToken(quote);
  try {
    assert.equal(token, expected, `띄어쓰기 토큰 불일치: ${JSON.stringify(quote)}`);
    if (token) assert.ok(quote.includes(token), `토큰이 원문에 없음: ${JSON.stringify(token)}`);
    console.log(`PASS  ${quote} → ${token ?? "(검토 불필요)"}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${error instanceof Error ? error.message : error} (토큰=${JSON.stringify(token)})`);
  }
}

// 말투 — 잡음은 자동 정리, 강조어·욕설은 플래그만(자동 수정 금지).
const toneCases: [string, string | null, string | null][] = [
  ["아오 그냥 입히면 겁나 귀여워", "겁나", "그냥 입히면 겁나 귀여워"],
  ["꾸미는게 재밌다 ㅋㅋ", null, "꾸미는게 재밌다"],
  ["ㅠㅠ 너무 아쉬웠어요", null, "너무 아쉬웠어요"],
  ["진짜 존나 불편합니다", "존나", null],
  ["전반적으로 만족스러웠습니다", null, null],
];
for (const [quote, expectedFlag, expectedCleanup] of toneCases) {
  const flagged = reportQuoteFlaggedWord(quote);
  const cleaned = reportQuoteFillerCleanup(quote);
  try {
    assert.equal(flagged, expectedFlag, `플래그 불일치: ${JSON.stringify(quote)}`);
    assert.equal(cleaned, expectedCleanup, `잡음 정리 불일치: ${JSON.stringify(quote)}`);
    if (flagged) assert.ok(quote.includes(flagged), `플래그 표현이 원문에 없음: ${flagged}`);
    console.log(`PASS  ${quote} → 플래그=${flagged ?? "-"} 정리=${cleaned ?? "(불필요)"}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${error instanceof Error ? error.message : error} (플래그=${JSON.stringify(flagged)} 정리=${JSON.stringify(cleaned)})`);
  }
}

// 띄어쓰기만 넣는 교정은 5자 가드에 걸려 버려지면 안 된다(correctionDiff의 존재 이유).
try {
  assert.ok(!boundedDiff("아오그냥입히면겁나귀여워", "아오 그냥 입히면 겁나 귀여워", 5), "가드가 이미 통과하면 correctionDiff가 불필요");
  assert.ok(correctionDiff("아오그냥입히면겁나귀여워", "아오 그냥 입히면 겁나 귀여워", 5), "띄어쓰기 교정이 버려짐");
  // 글자가 바뀌는 교정은 여전히 5자 가드를 받는다.
  assert.ok(!correctionDiff("아오그냥입히면겁나귀여워", "완전히 다른 문장으로 바꿔 씀", 5), "글자 교정 가드가 풀림");
  console.log("PASS  띄어쓰기 전용 교정은 길이 가드 면제");
} catch (error) {
  failures += 1;
  console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
}

const total = cases.length + spacingCases.length + toneCases.length + 1;
console.log(`\n${total - failures}/${total} PASS`);
if (failures > 0) process.exit(1);
