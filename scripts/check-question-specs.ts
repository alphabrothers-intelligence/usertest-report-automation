// 정성 분석 **대상 문항 선정**이 맞는가 (PRD 2.2.2절 6단계).
// `npm run check:question-specs`. **LLM·DB 없음, 무료** — 역할은 `단계매핑` 시트에서 온다.
//
// Stage1/Stage2를 실제로 돌리는 것은 과금되는 별도 검사다(`check:qualitative`). 여기서는
// **무엇을 넣을지 고르는 부분만** 본다 — 층을 나눠야 틀렸을 때 원인이 하나로 좁혀진다.
//
// 보는 것은 셋이다.
//  ① **무회귀** — 리바랩스가 옛 경로와 **같은 문항 14개**를 고르는가(키까지 같아야 한다.
//     키가 다르면 정성 결과가 저장은 되는데 화면 어디에도 안 붙는다).
//  ② **범용성** — 나머지 4종에서도 문항이 골라지는가.
//  ③ **키 충돌** — 같은 이름의 문항이 여러 개인 raw data(이젠오토)에서 키가 겹치지 않는가.
//     겹치면 DB의 unique 제약에 걸려 뒤 문항이 앞 문항을 덮어쓴다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns, type ColumnProfile } from "../lib/agent/profile";
import type { RoleClassification } from "../lib/agent/classify";
import { buildQuestionSpecsFromRoles } from "../lib/agent/questionSpecs";
import { computeRoleQuantStats } from "../lib/agent/quant";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { defaultRole, loadStageAnswerKey, type StageCode } from "./stageAnswerKey";

const DATA = path.join(process.cwd(), "data");

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

function classificationFromSheet(profiles: ColumnProfile[], stages: Record<number, StageCode>): RoleClassification {
  return {
    questions: profiles
      .filter((profile) => stages[profile.index] !== undefined)
      .map((profile) => ({
        columnIndex: profile.index,
        role: defaultRole(stages[profile.index], profile),
        header: profile.header,
        type: profile.type,
        confidence: 1,
        ...(profile.scaleMax !== undefined ? { scaleMax: profile.scaleMax } : {}),
        ...(profile.groupPrefix ? { groupKey: profile.groupPrefix } : {}),
        ...(profile.reasonFor !== undefined ? {} : {}),
      })),
    unassigned: [],
    rejected: null,
  };
}

/** 이유 컬럼은 프로파일러가 정한다 — 분류 결과에 그 정보를 실어준다(실제 경로와 같은 형태). */
function withReasonColumns(classification: RoleClassification, profiles: ColumnProfile[]): RoleClassification {
  const reasonOf = new Map<number, number>();
  for (const profile of profiles) {
    if (profile.reasonFor !== undefined) reasonOf.set(profile.reasonFor, profile.index);
  }
  return {
    ...classification,
    questions: classification.questions.map((question) => ({
      ...question,
      reasonColumn: reasonOf.get(question.columnIndex),
    })),
  };
}

function load(file: string) {
  const buffer = readFileSync(path.join(DATA, file));
  return parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
}

function specsFor(dataset: { file: string; stages: Record<number, StageCode> }) {
  const { headerRow, dataRows } = load(dataset.file);
  const profiles = profileColumns(headerRow, dataRows);
  const classification = withReasonColumns(classificationFromSheet(profiles, dataset.stages), profiles);
  const stats = computeRoleQuantStats(classification, profiles, dataRows);
  return buildQuestionSpecsFromRoles(stats, classification, profiles, dataRows);
}

const DATASETS = loadStageAnswerKey();

// ── ① 무회귀 — 리바랩스가 옛 경로와 같은 문항을 고르는가 ────────────────────────
console.log("=== ① 무회귀 — 리바랩스 ===");
const rivaDataset = DATASETS.find((d) => d.name === "리바랩스")!;
const riva = load(rivaDataset.file);
const legacy = buildQuestionSpecs(normalizeWallaRows(riva.headerRow, riva.dataRows));
const generic = specsFor(rivaDataset);
console.log(`  옛 경로 ${legacy.length}문항 / 새 경로 ${generic.length}문항`);
for (const spec of generic) console.log(`    ${spec.id} — ${spec.inputs.length}명`);

// 유사 서비스 만족도(priorService)는 인적 사항 장의 문항이라 새 경로의 대상 역할에 없다.
//
// **기능 문항은 키까지 같아야 한다** — 렌더러가 `feature:{이름}`으로 정량 기능과 짝을 맞추므로
// 이름이 한 글자만 달라도 정성 결과가 그 기능에 안 붙는다(실제로 "실시간 거점형" ↔ "실시간
// 위치 기반 거점형 콘텐츠"로 어긋났다가 잡았다).
const featureKeys = (specs: { id: string }[]) => specs.map((s) => s.id).filter((id) => id.startsWith("feature:")).sort();
check("리바랩스 기능 문항 키 = 옛 경로", featureKeys(generic), featureKeys(legacy));
check("리바랩스 단독 문항", generic.map((s) => s.id).filter((id) => !id.includes(":")).sort(), ["improvementIdea", "nps", "overallSatisfaction"]);

// **가치 문항 키는 옛 경로와 다르고, 그게 맞다.** 옛 경로는 `values:functional`처럼 영어
// 이름을 박아뒀는데 축 이름은 데이터마다 다르다(케어클 `기능적 가치 영역 만족도`). 새 경로는
// `values:{축 이름}`을 쓴다. 렌더러는 접두(`values:`)로 고르고 **라벨로 축과 짝을 맞추므로**
// (`buildFourValuesAnalysisText`) 접두와 라벨이 조건이지 키의 뒷부분은 조건이 아니다.
const valueSpecs = generic.filter((s) => s.id.startsWith("values:"));
check("가치 문항 수 = 옛 경로", valueSpecs.length, legacy.filter((s) => s.id.startsWith("values:")).length);
check("가치 문항 라벨이 축 이름", valueSpecs.every((s) => s.id === `values:${s.label}`), true);

for (const spec of generic) {
  const same = legacy.find((l) => l.id === spec.id);
  if (!same) continue; // 키 규칙이 바뀐 가치 문항은 위에서 따로 봤다
  check(`${spec.id} 응답자 수`, spec.inputs.length, same.inputs.length);
}
// 응답자 수는 키가 달라도 같아야 한다 — 같은 컬럼을 읽기 때문이다.
check(
  "가치 문항 응답자 수",
  valueSpecs.map((s) => s.inputs.length),
  legacy.filter((s) => s.id.startsWith("values:")).map((s) => s.inputs.length),
);

// ── ② 범용성 + ③ 키 충돌 ──────────────────────────────────────────────────────
console.log("\n=== ② 범용성 — 나머지 4종 ===");
for (const dataset of DATASETS.filter((d) => d.name !== "리바랩스")) {
  const specs = specsFor(dataset);
  console.log(`  ${dataset.name}: ${specs.length}문항 — ${specs.map((s) => s.id).join(", ")}`);
  check(`${dataset.name} 문항이 뽑힘`, specs.length > 0, true);
  check(`${dataset.name} 빈 문항 없음`, specs.filter((s) => s.inputs.length === 0).length, 0);
  // 키가 겹치면 DB unique 제약에 걸려 뒤 문항이 앞 문항을 덮어쓴다.
  check(`${dataset.name} 문항 키 중복`, specs.length - new Set(specs.map((s) => s.id)).size, 0);
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);