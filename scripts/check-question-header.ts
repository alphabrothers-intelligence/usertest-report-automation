// L10b 문항 헤더 규칙(척도 주석 도출·문항 원문 판정)을 점검한다. LLM·DB 호출 없는 순수
// 규칙 함수 검사라 CI에서도 안전하게 돌릴 수 있다. `npm run check:question-header`.
//
// 기대값은 실제 발행 보고서(리바랩스 0904, 37쪽·5쪽)의 문항 문자열과 리바랩스 raw data
// 헤더에서 그대로 가져왔다 — 원본 대조로 정한 규칙이라 임의로 바꾸지 말 것.
import { isFullQuestionText, scaleNoteFromQuestion } from "../lib/report/sections";

const NOTE_CASES: [string, string | null][] = [
  // 원본 37쪽 — 문항 아래 오른쪽 척도 주석
  ["캣독런의 조작은 [불편하다 / 편하다]", "* 불편하다: 0점 / 편하다:10점"],
  ["캣독런 이용 경험은 [지루하다 / 재미있다]", "* 지루하다: 0점 / 재미있다:10점"],
  ["캣독런을 이용할 때 [몰입되지 않는다 / 몰입된다]", "* 몰입되지 않는다: 0점 / 몰입된다:10점"],
  ["나는 캣독런을 [다시 플레이하고 싶지 않다 / 다시 플레이하고 싶다]", "* 다시 플레이하고 싶지 않다: 0점 / 다시 플레이하고 싶다:10점"],
  // 리바랩스 raw data 헤더는 요약 라벨이라 척도를 알 수 없다 → 주석 없음(지어내지 않는다)
  ["실용성1) 조작 편의성", null],
  ["나이", null],
  ["'펫 꾸미기' 기능 만족도", null],
  // 대괄호가 있어도 양극 구분(" / ")이 없으면 척도가 아니다
  ["다음 중 해당하는 것을 고르세요 [복수응답]", null],
];

const FULL_QUESTION_CASES: [string | undefined, boolean][] = [
  ["캣독런의 조작은 [불편하다 / 편하다]", true],
  ["'펫과의 산책' 기능의 만족도는 몇 점입니까?", true],
  ["나이를 입력해주세요", false], // 문장이지만 물음표·척도가 없어 라벨과 구분되지 않는다
  ["실용성1) 조작 편의성", false],
  ["'펫 꾸미기' 기능 만족도", false],
  [undefined, false],
];

let pass = 0;
let fail = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n      기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
  if (ok) pass += 1; else fail += 1;
};

console.log("=== scaleNoteFromQuestion (척도 주석 도출) ===");
for (const [text, expected] of NOTE_CASES) check(text, scaleNoteFromQuestion(text), expected);

console.log("\n=== isFullQuestionText (raw data 원문을 그대로 쓸지) ===");
for (const [text, expected] of FULL_QUESTION_CASES) check(String(text), isFullQuestionText(text), expected);

console.log(`\n=== 요약: ${pass}/${pass + fail} PASS ===`);
process.exit(fail === 0 ? 0 : 1);