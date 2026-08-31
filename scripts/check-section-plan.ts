// 목차 조립기(lib/agent/sectionPlan.ts)를 역할 매핑 3종에 돌려 장·절 구성과 드롭 사유를 본다.
// LLM·DB·파일 호출 없음. `npm run check:section-plan`.
//
// 역할 매핑은 **손으로 넣은 것**이다(PRD 12장 Phase 10b 수용 기준). 2단계(분류 에이전트)가
// 아직 없으므로, 여기서 고정하는 것은 "역할이 맞게 들어왔을 때 목차가 맞게 나오는가" 하나다 —
// 나중에 에이전트가 틀렸을 때 "에이전트가 틀렸는지 조립 규칙이 틀렸는지"를 가르는 기준이 된다.
import {
  buildSectionPlan,
  type PlannedQuestion,
  type QuestionRole,
  type SectionPlanInput,
} from "../lib/agent/sectionPlan";

let column = 0;
const q = (role: QuestionRole, extra: Omit<PlannedQuestion, "columnIndex" | "role"> = {}): PlannedQuestion => ({
  columnIndex: column++,
  role,
  ...extra,
});
const many = (n: number, role: QuestionRole, name: (i: number) => string, extra: Partial<PlannedQuestion> = {}) =>
  Array.from({ length: n }, (_, i) => q(role, { itemName: name(i), ...extra }));

const RIVALABS_FEATURES = [
  "펫과의 산책",
  "실시간 위치 기반 거점형 콘텐츠",
  "펫 레이싱",
  "펫 교배",
  "펫 성장",
  "커뮤니티",
];

type Case = {
  name: string;
  input: SectionPlanInput;
  /** `번호. 제목` 형식. 생성된 장 전부를 순서대로 적는다. */
  chapters: string[];
  /** 장별 절 제목. 장 제목을 키로 쓴다(번호는 위에서 이미 본다). */
  sections?: Record<string, string[]>;
  droppedIds?: string[];
  notes?: number;
};

const CASES: Case[] = [
  {
    // 리바랩스 = 표준 입력. 원본 발행 보고서와 같은 Ⅰ~Ⅸ 목차가 나와야 한다.
    name: "리바랩스",
    input: {
      questions: [
        ...many(4, "demographic", (i) => ["나이", "성별", "운영체제", "걷기 습관"][i]),
        q("prior_service"),
        ...many(6, "feature", (i) => RIVALABS_FEATURES[i], { scaleMax: 10 }),
        q("purchase_factor"),
        ...many(4, "value", (i) => ["기능적", "심미적", "경제적", "사회공공적"][i], { scaleMax: 10 }),
        ...many(4, "ux_quality", (i) => `실용성${i + 1}`, { groupKey: "실용성", scaleMax: 10 }),
        ...many(4, "ux_quality", (i) => `즐거움${i + 1}`, { groupKey: "즐거움", scaleMax: 10 }),
        q("overall", { scaleMax: 10 }),
        q("intent", { scaleMax: 10 }),
        q("improvement"),
      ],
      rankItems: RIVALABS_FEATURES,
      demographicGroupSizes: [
        [34, 66],
        [12, 41, 29, 18],
      ],
    },
    chapters: [
      "I. 개요",
      "II. 인적 사항 및 특성·경험 조사",
      "III. 기능별 고객 경험 평가",
      "IV. 핵심구매요소",
      "V. 4대 가치 만족도",
      "VI. 사용자 경험 품질 평가",
      "VII. 교차 분석",
      "VIII. 종합 만족도 및 NPS 지수",
      "IX. 종합 결과 및 제언",
    ],
    sections: {
      개요: ["제품 소개", "사용성 테스트 진행 일정", "사용성 테스트 설문 항목"],
      "기능별 고객 경험 평가": ["기능별 고객 경험 조사 결과", "기능별 고객 경험 분석"],
      "종합 결과 및 제언": ["사용성테스트 결과 요약", "개선 전략 제언", "기능별 고객 제언 종합"],
    },
    droppedIds: ["IV"], // 고객 여정 — 시점 문항 없음
    notes: 0,
  },
  {
    // 케어클 = 고객 여정이 있는 유일한 데이터. 여성 100%라 교차 분석이 드롭된다.
    // 순위는 받았지만 순위 항목(구매요소)과 기능명이 겹치지 않아 사분면이 안 선다.
    name: "케어클",
    input: {
      questions: [
        ...many(3, "demographic", (i) => ["나이", "성별", "피부 타입"][i]),
        q("prior_service"),
        ...many(8, "feature", (i) => `기능${i + 1}`, { scaleMax: 10 }),
        ...many(5, "journey", (i) => `시점${i + 1}`, { scaleMax: 10 }),
        q("purchase_factor"),
        ...many(4, "value", (i) => `가치${i + 1}`, { scaleMax: 10 }),
        q("overall", { scaleMax: 10 }),
        q("improvement"),
      ],
      rankItems: ["가격", "디자인", "성능"],
      demographicGroupSizes: [
        [27],
        [6, 11, 10],
      ],
    },
    chapters: [
      "I. 개요",
      "II. 인적 사항 및 특성·경험 조사",
      "III. 기능별 고객 경험 평가",
      "IV. 고객 여정 기반 경험 평가",
      "V. 핵심구매요소",
      "VI. 4대 가치 만족도",
      "VII. 종합 만족도 및 NPS 지수",
      "VIII. 종합 결과 및 제언",
    ],
    sections: {
      "고객 여정 기반 경험 평가": ["고객 여정 기반 경험 평가 조사 결과", "고객 여정 기반 경험 평가 결과 분석"],
    },
    droppedIds: ["VII", "VIII"], // UX 품질 · 교차 분석
    notes: 1, // 사분면 미생성 안내
  },
  {
    // 정리습관 = 항목이 기능이 아니라 태스크 플로우. 가치 문항 미수집, 순위 미수집.
    // 구매요소별 만족도 척도가 있어 L27 이 붙는다.
    name: "정리습관",
    input: {
      questions: [
        ...many(3, "demographic", (i) => ["나이", "성별", "가구 형태"][i]),
        ...many(8, "task_flow", (i) => `단계${i + 1}`, { scaleMax: 5 }),
        ...many(4, "purchase_factor", (i) => `요소${i + 1}`, { scaleMax: 5 }),
        q("overall", { scaleMax: 5 }),
        q("improvement"),
      ],
      demographicGroupSizes: [[12], [3, 9]],
    },
    chapters: [
      "I. 개요",
      "II. 인적 사항 및 특성 조사",
      "III. 단계별 고객 경험 평가",
      "IV. 핵심구매요소",
      "V. 종합 만족도 및 NPS 지수",
      "VI. 종합 결과 및 제언",
    ],
    sections: {
      "단계별 고객 경험 평가": ["단계별 고객 경험 조사 결과", "단계별 고객 경험 분석"],
    },
    droppedIds: ["IV", "VI", "VII", "VIII"], // 고객 여정 · 가치 · UX 품질 · 교차 분석
    notes: 1, // 중요 순위 미수집 안내
  },
];

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

for (const testCase of CASES) {
  column = 0;
  const plan = buildSectionPlan(testCase.input);
  console.log(`\n[${testCase.name}]`);
  for (const chapter of plan.chapters) {
    console.log(`  ${chapter.numeral}. ${chapter.title}`);
    for (const section of chapter.sections) {
      console.log(`     ${section.number}. ${section.title}  (${section.layouts.join("|")})`);
    }
  }
  for (const drop of plan.dropped) console.log(`  드롭 ${drop.id} ${drop.title} — ${drop.reason}`);
  for (const note of plan.notes) console.log(`  안내: ${note}`);

  check(
    `${testCase.name} 장 목록`,
    plan.chapters.map((c) => `${c.numeral}. ${c.title}`),
    testCase.chapters,
  );
  for (const [chapterTitle, sections] of Object.entries(testCase.sections ?? {})) {
    check(
      `${testCase.name} ${chapterTitle} 절`,
      plan.chapters.find((c) => c.title === chapterTitle)?.sections.map((s) => s.title),
      sections,
    );
  }
  if (testCase.droppedIds) check(`${testCase.name} 드롭`, plan.dropped.map((d) => d.id), testCase.droppedIds);
  if (testCase.notes !== undefined) check(`${testCase.name} 안내 수`, plan.notes.length, testCase.notes);
  // 드롭 사유는 반드시 남는다 — "데이터가 없는 항목을 억지로 만들지 않는다"의 짝이다.
  check(`${testCase.name} 드롭 사유 누락`, plan.dropped.filter((d) => !d.reason).length, 0);
}

// 사분면은 순위 항목명 ∩ 기능명 >= 3 일 때만 선다. 리바랩스에서 교집합을 2개로 줄여 확인한다.
const noQuadrant = buildSectionPlan({
  ...CASES[0].input,
  rankItems: RIVALABS_FEATURES.slice(0, 2),
});
check(
  "사분면 미성립 시 III-1 에서 L6 제외",
  noQuadrant.chapters.find((c) => c.id === "III")?.sections[0].layouts.includes("L6"),
  false,
);
check(
  "사분면 미성립 시 X-1 에서 L6 제외 (절은 유지)",
  noQuadrant.chapters.find((c) => c.id === "X")?.sections[0].layouts.filter((l) => l === "L6" || l === "L6a").length,
  0,
);

// "4대 가치"는 **조사 방법론의 이름이지 데이터에서 세는 값이 아니다**(담당자 확인 2026-08-28,
// `표준목차` 시트에도 리터럴로 적혀 있다). 축을 세어 제목을 만들면 오분류 하나가 장 제목을
// "3대 가치 만족도"로 바꿔버린다 — 가이드 8.4 ⑦이 예견한 증상이다. 축이 4개가 아닐 때도
// 제목이 안 흔들리는지 양쪽으로 못 박는다.
for (const axisCount of [3, 5]) {
  const miscounted = buildSectionPlan({
    ...CASES[1].input,
    questions: CASES[1].input.questions
      .filter((q) => q.role !== "value")
      .concat(many(axisCount, "value", (i) => `가치${i + 1}`, { scaleMax: 10 })),
  });
  check(
    `가치 축이 ${axisCount}개여도 장 제목은 "4대 가치 만족도"`,
    miscounted.chapters.find((c) => c.id === "VI")?.title,
    "4대 가치 만족도",
  );
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);