// Stage1(문장분리+극성판정)이 PRD 6.2절 few-shot 예시를 실제로 재현하는지 라이브 API로 확인한다.
// 사용법: npm run check:stage1  (ANTHROPIC_API_KEY 필요, 실제 과금 발생)
import { runStage1, type Stage1Input } from "../lib/pipeline/stage1";

interface Case {
  label: string;
  input: Stage1Input;
  expectedClauseCount: number;
  expectedPolarities: ("positive" | "negative" | "neutral")[];
}

// PRD 6.2절 예시 1~4을 그대로 사용한다.
const cases: Case[] = [
  {
    label: "예시 1 — 순수 긍정",
    input: { respondent_id: 1, score: 7, reason: "위 기능에 대한 불편함은 못느낌" },
    expectedClauseCount: 1,
    expectedPolarities: ["positive"],
  },
  {
    label: "예시 2 — 동일 점수, 반대 극성",
    input: {
      respondent_id: 2,
      score: 7,
      reason: "그립감이 떨어지며 각도를 조정 잘 해야하는 불편함",
    },
    expectedClauseCount: 1,
    expectedPolarities: ["negative"],
  },
  {
    label: "예시 3 — 경계 사례(불편하다 표현이 다르게 분류)",
    input: {
      respondent_id: 3,
      score: 7,
      reason:
        "Body Shot 할때 부위가 넓어 일시정지없이 사용되있으면 합니다 중간에 멈추니까 불편하고 시간이 너무 걸려요 / 페이스도 일시정지 없이 게속하는게 좋을것 같아요 / 내가 원하는곳에 조금더 하고싶은데 모드변경을 다시 제설정해야 되어 불편합니다",
    },
    expectedClauseCount: 3,
    expectedPolarities: ["negative", "neutral", "neutral"],
  },
  {
    label: "예시 4 — 3개 극성에 걸쳐 분리",
    input: {
      respondent_id: 4,
      score: 4,
      reason:
        "시간, 거리 등이 나와서 정말 운동 앱 같은 느낌이다. 상자를 먹을 때 어느정도까지 가까이 가야 먹을 수 있는지 확실하지 않다. 제한 속도가 어느정도인진 모르겠으나, 타겜에 비해 좀 느슨한 편인 거 같다.",
    },
    expectedClauseCount: 3,
    expectedPolarities: ["positive", "negative", "neutral"],
  },
];

async function main() {
  let pass = 0;
  let fail = 0;

  for (const c of cases) {
    console.log(`\n=== ${c.label} ===`);
    const result = await runStage1({
      questionLabel: "테스트 문항",
      inputs: [c.input],
    });

    const respondent = result.results.find((r) => r.respondent_id === c.input.respondent_id);
    if (!respondent) {
      console.log("FAIL: respondent_id가 결과에 없음");
      fail += 1;
      continue;
    }

    const clauses = respondent.clauses;
    console.log(JSON.stringify(clauses, null, 2));

    // 1) 직접 인용 후보(raw_clause)는 반드시 원문 부분 문자열이어야 한다.
    // 보정본(analysis_clause)은 분석에 남을 수 있으므로 여기서는 별도 평가한다.
    const verbatimOk = clauses.every((cl) =>
      cl.raw_clause === null || c.input.reason.replace(/\s+/g, "").includes(cl.raw_clause.replace(/\s+/g, "")),
    );

    // 2) clause 개수가 기대치와 일치하는지 (모델마다 절 분리가 미세하게 다를 수 있어 참고용)
    const countMatch = clauses.length === c.expectedClauseCount;

    // 3) 극성 시퀀스가 기대치와 일치하는지
    const polaritiesMatch =
      countMatch &&
      clauses.every((cl, i) => cl.polarity === c.expectedPolarities[i]);

    console.log(`verbatim: ${verbatimOk ? "PASS" : "FAIL"}`);
    console.log(
      `clause count: ${clauses.length} (기대 ${c.expectedClauseCount}) → ${countMatch ? "PASS" : "MISMATCH(참고용)"}`,
    );
    console.log(`polarity 시퀀스 일치: ${polaritiesMatch ? "PASS" : "MISMATCH(참고용)"}`);

    if (verbatimOk) pass += 1;
    else fail += 1;
  }

  console.log(`\n=== 요약: verbatim PASS ${pass}/${cases.length}, FAIL ${fail}/${cases.length} ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
