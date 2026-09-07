// 앵커 인용문 복원이 **웬만해선 안 놓치는가**. `npm run check:check-anchor-quotes` 대신
// `npm run check:anchor-quotes`. **LLM·DB 없음, 무료.**
//
// 2026-09-02 담당자 요청("최대한 놓친 인용문이 없도록")으로 구제 사다리를 넣고 그것을 고정한다.
// 모델이 앵커를 조금씩 다르게 적는 실제 실패 유형을 케이스로 박아둔다 — 여기서 깨지면
// 인용문이 조용히 사라지기 시작했다는 뜻이다.
import { narrowQuoteToEvidence, resolveAnchorQuotes, type AnchorCombinedOutput } from "../lib/pipeline/anchorQuotes";

const INPUTS = [
  { respondent_id: 1, reason: "GPS 연동이 원할하지 않음. 그래도 걷는 재미는 있었어요." },
  { respondent_id: 2, reason: "지도를 기반으로 내가 움직인 경로를 알 수 있고,\r\n그냥 걷는것보다 느낌이 달랐다." },
  { respondent_id: 3, reason: "보상이 적어서 아쉽다" },
];

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass += 1;
    console.log(`PASS ${label}`);
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}\n  기대: ${JSON.stringify(expected)}\n  실제: ${JSON.stringify(actual)}`);
}

const run = (quotes: { r: number; from: string; to: string; reason_from?: string; reason_to?: string }[]) =>
  resolveAnchorQuotes(
    { groups: [{ polarity: "negative", categories: [{ label: "L", respondents: [1, 2, 3], quotes, insight: "i" }] }] } as AnchorCombinedOutput,
    INPUTS,
  );

// ── 그대로 적은 경우 ────────────────────────────────────────────────────────────
let r = run([{ r: 1, from: "GPS 연동이", to: "않음" }]);
check("정확히 적음 — 복원", r.groups[0].categories[0].quotes, ["GPS 연동이 원할하지 않음"]);
check("정확히 적음 — 방법", r.stats.byStrategy.exact, 1);

// ── 공백·줄바꿈이 다른 경우(엑셀 원문의 \r\n을 모델이 공백으로 적음) ─────────────
r = run([{ r: 2, from: "경로를 알 수 있고, 그냥", to: "달랐다" }]);
check("공백만 다름 — 복원", r.groups[0].categories[0].quotes.length, 1);
check("공백만 다름 — 방법", r.stats.byStrategy.normalized, 1);
check("공백만 다름 — 원문 그대로 잘림", r.groups[0].categories[0].quotes[0].includes("\r\n"), true);

// ── 끝 조각을 잘못 적은 경우 → 문장 끝까지 구제 ────────────────────────────────
r = run([{ r: 1, from: "GPS 연동이", to: "매끄럽지 않았습니다" }]);
check("끝을 못 찾음 — 구제됨", r.groups[0].categories[0].quotes, ["GPS 연동이 원할하지 않음."]);
check("끝을 못 찾음 — 방법", r.stats.byStrategy.sentence_tail, 1);

// ── 시작 조각을 잘못 적은 경우 → 문장 처음부터 구제 ────────────────────────────
r = run([{ r: 1, from: "지피에스 연동", to: "재미는 있었어요" }]);
// 문장 처음부터 **끝 앵커까지**만 자른다 — 앵커 뒤의 마침표는 포함하지 않는다.
check("시작을 못 찾음 — 구제됨", r.groups[0].categories[0].quotes, ["그래도 걷는 재미는 있었어요"]);
check("시작을 못 찾음 — 방법", r.stats.byStrategy.sentence_head, 1);

// ── 응답자 번호를 잘못 적은 경우 → 그 조각을 유일하게 가진 응답자로 교정 ────────
r = run([{ r: 99, from: "보상이 적어서", to: "아쉽다" }]);
check("응답자 번호 틀림 — 구제됨", r.groups[0].categories[0].quotes, ["보상이 적어서 아쉽다"]);
check("응답자 번호 틀림 — 방법", r.stats.byStrategy.other_respondent, 1);

// ── 지어내지 않는다: 어디에도 없는 조각은 버린다 ───────────────────────────────
r = run([{ r: 1, from: "존재하지 않는 문장입니다", to: "역시 없음" }]);
check("없는 인용은 버림", r.groups[0].categories[0].quotes, []);
check("없는 인용은 사유 기록", r.stats.failures.map((f) => f.reason), ["from_missing"]);

// ── 근거 구간(굵게 표시용)도 인용문 안에서 찾는다 ──────────────────────────────
r = run([{ r: 1, from: "GPS 연동이", to: "않음", reason_from: "원할하지", reason_to: "않음" }]);
check("근거 구간 복원", r.groups[0].categories[0].quoteEvidence[0]?.reasonSpan, "원할하지 않음");

// ── 복원된 인용문은 **항상 원문의 부분 문자열**이어야 한다(지어내기 방지) ───────
const all = [
  ...run([{ r: 1, from: "GPS 연동이", to: "매끄럽지 않았습니다" }]).groups[0].categories[0].quotes,
  ...run([{ r: 2, from: "경로를 알 수 있고, 그냥", to: "달랐다" }]).groups[0].categories[0].quotes,
  ...run([{ r: 99, from: "보상이 적어서", to: "아쉽다" }]).groups[0].categories[0].quotes,
];
const norm = (v: string) => v.normalize("NFKC").replace(/[​\s]+/g, "");
check("전부 원문의 부분 문자열", all.every((q) => INPUTS.some((i) => norm(i.reason).includes(norm(q)))), true);

// ── 개수는 코드가 센다(2026-09-04) ──────────────────────────────────────────────
// 모델이 개수를 감으로 적던 것을 응답자 번호 목록으로 바꿨다. 여기서 깨지면 보고서의
// 긍정·부정·중립 비율이 다시 모델 추정값으로 돌아간 것이다.
const counted = resolveAnchorQuotes(
  {
    groups: [{
      polarity: "negative",
      categories: [
        // 중복(2가 두 번)과 입력에 없는 번호(99)를 섞어 둔다.
        { label: "A", respondents: [1, 2, 2, 99], quotes: [], insight: "i" },
        { label: "B", respondents: [3], quotes: [], insight: "i" },
      ],
    }],
  } as AnchorCombinedOutput,
  INPUTS,
);
check("개수 — 중복 제거하고 셈", counted.groups[0].categories[0].clause_count, 2);
check("개수 — 없는 응답자 번호는 버림", counted.stats.droppedRespondents, 1);
check("개수 — 합계는 카테고리 합", counted.groups[0].total_clause_count, 3);

// ── 긴 인용문은 한 논점으로 좁힌다(2026-09-04) ──────────────────────────────────
// 설문 답변 한 칸에 장점·단점이 번호로 나열된 경우, 전체를 인용하면 부정 카테고리에 장점까지
// 딸려 들어간다(담당자 지적). 원본 보고서 인용문은 최대 129자다.
const LONG = "장점: 1. 보물상자를 획득하기위해 점 더 걷게됨./ 2. 지도상에 발자국으로 이동한 표식이 찍히고 산책중인 시간이 나와있어 어디를 얼마나 오래 걸었는지 알수있음 단점: 1. 보물상자를 획득하기위해 얼믄큼 가까이 가야하는지 표시되거나 알려줬으면 좋겠음 / 2. 지도가 확대,축소가 용이하지 않아 너무 불편함";
check("긴 인용문 — 근거가 있는 항목만 남김",
  narrowQuoteToEvidence(LONG, "얼믄큼 가까이 가야하는지"),
  "보물상자를 획득하기위해 얼믄큼 가까이 가야하는지 표시되거나 알려줬으면 좋겠음");
check("긴 인용문 — 좁힌 결과는 원문의 연속 구간", LONG.includes(narrowQuoteToEvidence(LONG, "얼믄큼 가까이 가야하는지")!), true);
check("긴 인용문 — 근거 구간이 없으면 버림", narrowQuoteToEvidence(LONG, null), null);
check("짧은 인용문 — 손대지 않음", narrowQuoteToEvidence("보상이 적어서 아쉽다", null), "보상이 적어서 아쉽다");
// 소수점을 문장 끝으로 보면 인용문이 숫자 중간에서 시작한다("하루 1.5km" → "5km 정도를…").
const DECIMAL = "걷기 앱은 보통 하루 1.5km 정도를 목표로 잡는데 이 앱은 그 기준이 아예 안 보여서 얼마나 걸어야 보상을 받는지 알 수가 없었고 그래서 중간에 그만두게 되는 일이 많았습니다. 특히 처음 시작할 때 안내가 부족하고 튜토리얼도 없어서 한참 헤맸습니다.";
check("소수점은 문장 끝이 아님",
  narrowQuoteToEvidence(DECIMAL, "기준이 아예 안 보여서"),
  "걷기 앱은 보통 하루 1.5km 정도를 목표로 잡는데 이 앱은 그 기준이 아예 안 보여서 얼마나 걸어야 보상을 받는지 알 수가 없었고 그래서 중간에 그만두게 되는 일이 많았습니다");

// ── 조건·이유 절은 데려온다(2026-09-07) ────────────────────────────────────────
// 뒤 조각만 남기면 응답자가 붙인 단서가 사라져 뜻이 바뀐다.
const CONTEXT = "저는 겨울이라 밖에 잘 못 나가서 그런지 / 산책으로 받는 보상이 너무 적게 느껴졌어요. 다른 걷기 앱들은 하루에 몇 백원씩은 주는데 이건 그런 재미가 좀 부족한 것 같습니다.그리고 전반적으로 앱이 무거워서 실행할 때마다 한참 기다려야 하는 점도 계속 신경이 쓰였습니다.";
check("조건절 — 앞 조각을 데려옴",
  narrowQuoteToEvidence(CONTEXT, "보상이 너무 적게"),
  "저는 겨울이라 밖에 잘 못 나가서 그런지 / 산책으로 받는 보상이 너무 적게 느껴졌어요");
// 앞 조각이 완결된 문장이면 데려오지 않는다.
const DONE = "이 앱은 처음 써봤습니다. 산책으로 받는 보상이 너무 적게 느껴졌어요. 다른 걷기 앱들은 하루에 몇 백원씩은 주는데 이건 그런 재미가 좀 부족한 것 같아 아쉬웠습니다.그리고 전반적으로 앱이 무거워서 실행할 때마다 한참 기다려야 하는 점도 계속 신경이 쓰였습니다.";
check("완결된 앞 문장은 데려오지 않음",
  narrowQuoteToEvidence(DONE, "보상이 너무 적게"),
  "산책으로 받는 보상이 너무 적게 느껴졌어요");

// ── 마지막 하나 남은 인용문은 버리지 않는다(2026-09-07) ─────────────────────────
const LONE = "산책을 하다 보면 여러 가지가 아쉬운데 우선 걸음 수가 제대로 안 올라가고 지도도 자꾸 튀어서 내가 어디를 걸었는지 알기 어렵고 보상 상자도 잘 안 보여서 결국 흥미가 떨어져 그만두게 되는 경우가 많았습니다그리고 전반적으로 앱이 무거워서 실행할 때마다 한참 기다려야 하는 점도 계속 신경이 쓰였습니다.";
const dropped = resolveAnchorQuotes(
  { groups: [{ polarity: "negative", categories: [{ label: "L", respondents: [4], quotes: [{ r: 4, from: "산책을 하다", to: "신경이 쓰였습니다", reason_from: "없는조각", reason_to: "없는조각" }], insight: "i" }] }] } as AnchorCombinedOutput,
  [...INPUTS, { respondent_id: 4, reason: LONE }],
);
check("긴 인용문 하나뿐이면 남김", dropped.groups[0].categories[0].quotes.length, 1);
check("남긴 건수 기록", dropped.stats.overlongKept, 1);

console.log(`\n=== 요약: ${pass}/${pass + fail} PASS ===`);
process.exit(fail === 0 ? 0 : 1);
