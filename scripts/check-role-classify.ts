// 역할 분류 에이전트(lib/agent/classify.ts)를 data/ 의 실제 raw data 4종에 돌린다.
// `npm run check:role-classify`. **ANTHROPIC_API_KEY 필요, 실제 과금 발생**(파일당 RUNS회 호출) —
// 자동으로 돌리지 말고 프롬프트·규칙을 건드렸을 때만 수동 실행할 것.
//
// 보는 것은 세 가지다.
//  ① 정확도 — **정답은 `docs/STAGE_MAPPING.xlsx`의 `단계매핑` 시트다**(`scripts/stageAnswerKey.ts`).
//     담당자와 같이 만든 그 시트가 데이터셋 5종의 전 컬럼을 이미 "어느 장으로 가는지"로 적어뒀다.
//     예전에는 이 스크립트가 **자기 정답표를 따로 들고 있었는데**, 그 바람에 시트와 어긋난 라벨이
//     실제로 있었다(2026-08-27 발견). 정답지는 하나여야 한다 — 여기에 정답을 적지 말 것.
//     시트의 단계는 역할보다 굵어서(S1 = 인적사항+습관, S8 = 종합만족도+추천의향) 그런 곳은
//     여러 역할을 정답으로 친다(`allowedRoles`). 목표는 90%+(담당자 지시).
//  ② 흔들림 — `RUNS=3 npm run check:role-classify`로 같은 파일을 여러 번 돌려 판정이 갈리는
//     컬럼을 센다. 실행마다 답이 바뀌는 문항이 "여기가 애매하다"는 증거다(가이드 7장 한계 ①).
//  ③ 그 역할로 조립한 목차 — PRD 2.2.2절 수용 기준("5종 섹션 구성이 기대표와 일치")의 실물이다.
//     조립기 자체는 `check:section-plan`이 LLM 없이 이미 고정하므로, 여기서 목차가 틀리면
//     원인은 조립 규칙이 아니라 **역할 판정**이다. **4종 전부 발행 보고서로 장 목록을 고정했다**
//     (2026-08-27) — 컬럼 하나 오판이 장 하나를 지우는 파급을 잡는 가장 강한 그물이다.
//
// API 키가 없으면 아무것도 못 하고 그냥 통과한다(프로파일러는 check:column-profile로 확인).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns } from "../lib/agent/profile";
import { runRoleClassification, toSectionPlanInput, REVIEW_CONFIDENCE } from "../lib/agent/classify";
import { buildSectionPlan, type QuestionRole } from "../lib/agent/sectionPlan";
import { allowedRoles, loadStageAnswerKey, STAGE_NAMES } from "./stageAnswerKey";

const DATA = path.join(process.cwd(), "data");
const RUNS = Number(process.env.RUNS ?? 1);
/** `DETAIL=1`이면 틀린 곳뿐 아니라 **전 컬럼**을 시트와 나란히 찍는다. */
const DETAIL = process.env.DETAIL === "1";
/** 담당자가 정한 합격선. 이 밑이면 프롬프트·few-shot을 손봐야 한다는 신호다. */
const TARGET_ACCURACY = 0.9;

/** 판정 못 한 컬럼도 하나의 답으로 세야 정확도가 정직해진다 — `QuestionRole`에는 없는 값이다. */
type Role = QuestionRole | "unassigned";

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

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY가 없어 LLM 판정은 건너뜁니다 — 프로파일러는 check:column-profile로 확인하세요.");
  process.exit(0);
}

// tsx는 이 파일을 CJS로 변환하므로 최상위 await를 못 쓴다 — 다른 검사 스크립트와 같은 형태.
async function main() {
  let totalColumns = 0;
  let totalCorrect = 0;
  let totalWobbly = 0;

  for (const dataset of loadStageAnswerKey()) {
    const buffer = readFileSync(path.join(DATA, dataset.file));
    const { headerRow, dataRows } = parseWallaWorkbook(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    );
    const profiles = profileColumns(headerRow, dataRows);
    const headerOf = new Map(profiles.map((p) => [p.index, p.header.replace(/\s+/g, " ")]));

    // 실행마다의 판정을 컬럼별로 모은다 — 흔들림은 이 목록의 유니크 개수로 센다.
    const perRun: {
      role: Map<number, Role>;
      /** 틀린 곳의 원인을 읽으려면 에이전트가 남긴 사유·확신도가 있어야 한다. */
      detail: Map<number, { confidence: number; note?: string }>;
      chapters: string[];
      lowConfidence: number;
    }[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      const startedAt = Date.now();
      const classification = await runRoleClassification({ fileName: dataset.file, profiles });
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

      const role = new Map<number, Role>(classification.questions.map((q) => [q.columnIndex, q.role]));
      // 확인 카드에 뜰 목록 그대로다 — **몇 개인지보다 무엇인지**가 중요하다(전수 노출은 검수 피로).
      // 판정 못 한 컬럼도 "unassigned로 답한 것"으로 세야 정확도가 정직해진다.
      for (const item of classification.unassigned) role.set(item.columnIndex, "unassigned");
      const plan = buildSectionPlan(toSectionPlanInput(classification, profiles, dataRows));
      const lowConfidence = classification.questions.filter((q) => q.confidence < REVIEW_CONFIDENCE).length;
      const detail = new Map(
        classification.questions.map((q) => [q.columnIndex, { confidence: q.confidence, note: q.note }]),
      );
      for (const item of classification.unassigned) detail.set(item.columnIndex, { confidence: 0, note: item.reason });
      perRun.push({ role, detail, chapters: plan.chapters.map((c) => c.title), lowConfidence });

      console.log(
        `\n=== ${dataset.name} — 컬럼 ${profiles.length}개 / ${elapsed}초${RUNS > 1 ? ` / ${run + 1}회차` : ""} ===`,
      );
      console.log(`  판정 못 함 ${classification.unassigned.length}개 · 확인 필요 ${lowConfidence}개`);
      if (run === 0) {
        for (const item of classification.unassigned) {
          console.log(`    미판정 #${item.columnIndex} ${item.header.replace(/\s+/g, " ").slice(0, 30)} — ${item.reason}`);
        }
        for (const q of classification.questions.filter((x) => x.confidence < REVIEW_CONFIDENCE)) {
          console.log(`    확인 #${q.columnIndex} ${q.role} ${q.header.replace(/\s+/g, " ").slice(0, 30)} — ${q.note ?? "저신뢰"}`);
        }
        check(`${dataset.name} 거부 여부`, classification.rejected, null);
        for (const chapter of plan.chapters) console.log(`  ${chapter.numeral}. ${chapter.title}`);
        for (const drop of plan.dropped) console.log(`  드롭 ${drop.id} ${drop.title} — ${drop.reason}`);
        if (dataset.chapters) check(`${dataset.name} 장 목록`, plan.chapters.map((c) => c.title), dataset.chapters);
      }
    }

    // ① 정확도 — 1회차 판정으로 센다(여러 번 돌려도 실제 제품은 한 번만 판정한다).
    const first = perRun[0].role;
    const missing = profiles.filter((p) => dataset.stages[p.index] === undefined);
    if (missing.length > 0) {
      console.log(`  ⚠ 시트에 없는 컬럼 ${missing.length}개: ${missing.map((p) => `#${p.index}`).join(" ")}`);
    }
    const labeled = profiles.filter((p) => dataset.stages[p.index] !== undefined);
    const wrong = labeled.filter((p) => {
      const actual: Role = first.get(p.index) ?? "unassigned";
      return !allowedRoles(dataset.stages[p.index], p).some((role) => role === actual);
    });
    const correct = labeled.length - wrong.length;
    totalColumns += labeled.length;
    totalCorrect += correct;

    console.log(`  정확도 ${correct}/${labeled.length} = ${((correct / labeled.length) * 100).toFixed(1)}%`);
    // 틀린 곳은 **원인을 판단할 수 있을 만큼** 찍는다 — 문항 원문 전체, 값의 형태, 그리고
    // 에이전트가 스스로 남긴 사유. 헤더를 잘라 보여주면 "왜 틀렸나"를 사람이 못 읽는다
    // (담당자 지적 2026-08-27). 이 줄들이 그대로 확인 카드의 재료이기도 하다.
    for (const p of wrong) {
      const stage = dataset.stages[p.index];
      const said = perRun[0].detail.get(p.index);
      console.log(`    ✗ #${p.index} [${p.type}] ${headerOf.get(p.index)}`);
      console.log(
        `        시트 ${stage} ${STAGE_NAMES[stage]} (${allowedRoles(stage, p).join("|")})` +
          ` ↔ AI ${first.get(p.index)} (확신 ${said?.confidence ?? "-"})`,
      );
      console.log(`        AI 사유: ${said?.note ?? "(사유 없음)"}`);
    }

    // 틀린 것만 찍으면 **맞은 것이 무엇인지 알 수 없다**(담당자 지적 2026-08-27). 정확도 숫자는
    // "몇 개"만 말하고 "무엇"을 안 말한다. `DETAIL=1`이면 전 컬럼을 한 줄씩 찍어 시트와
    // 에이전트를 나란히 볼 수 있게 한다 — 기본값에서 켜지 않는 이유는 282줄이라 평소엔 시끄러워서다.
    if (DETAIL) {
      console.log(`  ── 전 컬럼 대조 (○ 일치 / ✗ 불일치) ──`);
      for (const p of labeled) {
        const stage = dataset.stages[p.index];
        const actual = first.get(p.index) ?? "unassigned";
        const ok = allowedRoles(stage, p).some((role) => role === actual);
        console.log(
          `  ${ok ? "○" : "✗"} #${String(p.index).padStart(2)} ${stage} ${STAGE_NAMES[stage].padEnd(16)}` +
            ` ${actual.padEnd(15)} [${p.type}] ${headerOf.get(p.index)?.slice(0, 44)}`,
        );
      }
    }

    // ② 흔들림 — 여러 번 돌렸을 때만.
    if (RUNS > 1) {
      const wobbly = profiles.filter((p) => new Set(perRun.map((r) => r.role.get(p.index))).size > 1);
      totalWobbly += wobbly.length;
      console.log(`  흔들림 ${wobbly.length}/${profiles.length} 컬럼이 ${RUNS}회 중 갈림`);
      for (const p of wobbly) {
        console.log(`    ~ #${p.index} ${headerOf.get(p.index)?.slice(0, 34)} — ${perRun.map((r) => r.role.get(p.index)).join(" / ")}`);
      }
      const chapterSets = new Set(perRun.map((r) => r.chapters.join(" > ")));
      if (chapterSets.size > 1) {
        console.log(`  ⚠ 목차가 실행마다 다름:`);
        for (const set of chapterSets) console.log(`    ${set}`);
      }
    }
  }

  const overall = totalCorrect / totalColumns;
  console.log(`\n전체 정확도 ${totalCorrect}/${totalColumns} = ${(overall * 100).toFixed(1)}%`);
  if (RUNS > 1) console.log(`전체 흔들림 ${totalWobbly}개 컬럼`);
  check(`전체 정확도 ${TARGET_ACCURACY * 100}% 이상`, overall >= TARGET_ACCURACY, true);

  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exit(1);
}

main();