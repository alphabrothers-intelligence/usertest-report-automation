// 역할 판정 저장·수정 경로(lib/agent/rolePlan.ts)의 순수 로직 검사. **LLM·DB 없음, 무료.**
//
// 보는 것은 하나다 — **담당자가 고친 내용이 그대로 반영되고, 고치지 않은 것은 안 건드리는가.**
// DB 왕복(getOrCreateRolePlan)은 여기서 안 본다. 그건 실제 Supabase에 붙여야 하는 검증이라
// check:golden처럼 무료로 상시 돌릴 수 있는 성질이 아니다.
import { applyOverrides, type RolePlan } from "../lib/agent/rolePlan";
import type { ColumnProfile } from "../lib/agent/profile";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`  FAIL ${label}\n    기대: ${e}\n    실제: ${a}`);
}

const profile = (index: number, header: string, extra: Partial<ColumnProfile> = {}): ColumnProfile => ({
  index,
  header,
  type: "scale",
  uniqueCount: 11,
  blankRate: 0,
  avgLength: 1,
  ...extra,
});

function makePlan(overrides: RolePlan["overrides"]): RolePlan {
  return {
    profiles: [
      profile(0, "'산책' 기능 만족도", { scaleMax: 10, quotedName: "산책" }),
      profile(1, "가장 인상 깊었던 기능", { type: "single" }),
      profile(2, "현재 소유하고 있는 차종", { type: "text", avgLength: 12 }),
    ],
    classification: {
      questions: [
        { columnIndex: 0, role: "feature", header: "'산책' 기능 만족도", type: "scale", confidence: 0.95, itemName: "산책", scaleMax: 10 },
        { columnIndex: 1, role: "feature", header: "가장 인상 깊었던 기능", type: "single", confidence: 0.5, note: "형태 불일치" },
      ],
      unassigned: [{ columnIndex: 2, header: "현재 소유하고 있는 차종", reason: "집계할 수 없음" }],
      rejected: null,
    },
    overrides,
    classifiedAt: "2026-08-28T00:00:00.000Z",
  };
}

// 수정이 없으면 저장본을 **그대로** 돌려준다(참조까지 동일해야 불필요한 재계산이 없다).
const untouched = makePlan({});
check("수정 없음 — 원본 그대로", applyOverrides(untouched) === untouched.classification, true);

// 오판 문항의 역할을 바꾸면 그 문항만 바뀌고 확신도는 1이 된다(사람이 정한 값이므로).
const fixed = applyOverrides(makePlan({ 1: "purchase_factor" }));
check("고친 문항의 역할", fixed.questions.find((q) => q.columnIndex === 1)?.role, "purchase_factor");
check("고친 문항의 확신도", fixed.questions.find((q) => q.columnIndex === 1)?.confidence, 1);
check("안 고친 문항은 그대로", fixed.questions.find((q) => q.columnIndex === 0)?.role, "feature");

// 미판정 컬럼을 지정하면 문항 목록으로 올라오고 미판정 목록에서 빠진다.
const promoted = applyOverrides(makePlan({ 2: "demographic" }));
check("미판정 → 문항으로 승격", promoted.questions.map((q) => q.columnIndex), [0, 1, 2]);
check("미판정 목록에서 제거", promoted.unassigned.length, 0);
check("승격 시 프로파일 값 승계", promoted.questions.find((q) => q.columnIndex === 2)?.type, "text");

// "보고서에 넣지 않음"(meta)도 역할 하나로 표현된다 — 목차 조립기가 meta를 세지 않는다.
const excluded = applyOverrides(makePlan({ 1: "meta" }));
check("보고서에서 빼기", excluded.questions.find((q) => q.columnIndex === 1)?.role, "meta");

// 문항은 항상 컬럼 순서다 — 승격된 문항이 뒤에 붙은 채로 남으면 설문 순서가 어긋난다.
const both = applyOverrides(makePlan({ 1: "purchase_factor", 2: "demographic" }));
check("컬럼 순서 유지", both.questions.map((q) => q.columnIndex), [0, 1, 2]);

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);