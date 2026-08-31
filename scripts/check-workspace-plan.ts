// 목차 배선 검사 — 에이전트 장 목록이 실제로 **그 데이터에 있는 장만** 내는가.
// `npm run check:workspace-plan`. **LLM·DB 없음, 무료** (역할은 `단계매핑` 시트에서 온다).
//
// 보는 것은 둘이다.
//  ① **무회귀** — 에이전트 목차를 안 주면 리바랩스 결과가 예전(고정 9장)과 **한 글자도** 달라지지
//     않는가. 식별자 키로 옮기면서 장이 밀리면 Ⅳ장 자리에 Ⅴ장 내용이 들어가는 사고가 난다.
//  ② **범용성** — 에이전트 목차를 주면 데이터마다 장 구성이 달라지는가(케어클은 고객 여정이
//     생기고, 정리습관은 가치·UX가 빠진다). 그리고 **각 장에 블록이 실제로 들어차는가** —
//     장 제목만 나오고 내용이 비면 배선이 끊긴 것이다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns, type ColumnProfile } from "../lib/agent/profile";
import type { RoleClassification } from "../lib/agent/classify";
import { computeRoleQuantStats } from "../lib/agent/quant";
import { toQuantStats } from "../lib/agent/toQuantStats";
import { buildSectionPlan } from "../lib/agent/sectionPlan";
import { toSectionPlanInput } from "../lib/agent/classify";
import { buildReportWorkspaceSeed } from "../lib/report/workspace";
import { computeQuantStats } from "../lib/quant/compute";
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
      })),
    unassigned: [],
    rejected: null,
  };
}

function load(file: string) {
  const buffer = readFileSync(path.join(DATA, file));
  return parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
}

// ── ① 무회귀 — 옛 경로(에이전트 목차 없음)가 예전 그대로인가 ──────────────────────
console.log("=== ① 무회귀 — 리바랩스 고정 9장 ===");
const riva = load("[리바랩스]사용성테스트 raw data.xlsx");
const legacySeed = buildReportWorkspaceSeed({
  quantStats: computeQuantStats(normalizeWallaRows(riva.headerRow, riva.dataRows), riva.headerRow),
});
check(
  "고정 목차 장 번호·제목",
  legacySeed.sections.map((s) => `${s.numeral}. ${s.title}`),
  [
    "I. 개요",
    "II. 인적 사항 및 특성 조사",
    "III. 기능별 고객 경험 평가",
    "IV. 핵심구매요소",
    "V. 4대 가치 만족도",
    "VI. 사용자 경험 품질 평가",
    "VII. 교차 분석",
    "VIII. 종합 만족도 및 NPS 지수",
    "IX. 종합 결과 및 제언",
  ],
);
// 장이 밀렸는지는 **번호가 아니라 내용**으로 확인한다 — 제목은 맞는데 블록이 옆 장 것일 수 있다.
// 순위 누적막대(rank-composition)와 사분면은 **Ⅲ장**에 있다 — 핵심구매요소 장에는 넣지 않는다
// (2026-08-21 결정, `표준목차` 시트 생성 조건). Ⅳ장은 응답 분포 차트 + 표다.
check("III 기능별에 순위 구성·사분면", legacySeed.sections[2].blocks.filter((b) => b.kind === "rank-composition" || b.kind === "quadrant").length, 2);
check("IV 핵심구매요소에 분포 차트", legacySeed.sections[3].blocks.some((b) => b.kind === "chart"), true);
check("V 4대 가치에 가치 표", legacySeed.sections[4].blocks.some((b) => b.id === "four-values-table"), true);
check("VI UX 품질에 레이더", legacySeed.sections[5].blocks.some((b) => b.kind === "radar"), true);
check("VIII NPS에 NPS 블록", legacySeed.sections[7].blocks.some((b) => b.kind === "nps"), true);
for (const section of legacySeed.sections) {
  check(`고정 목차 ${section.numeral} 블록 있음`, section.blocks.length > 0, true);
}

// ── ② 범용성 — 에이전트 목차를 주면 데이터마다 장이 달라지는가 ──────────────────
console.log("\n=== ② 범용성 — 데이터마다 장 구성 ===");
for (const dataset of loadStageAnswerKey()) {
  const { headerRow, dataRows } = load(dataset.file);
  const profiles = profileColumns(headerRow, dataRows);
  const classification = classificationFromSheet(profiles, dataset.stages);
  const roleStats = computeRoleQuantStats(classification, profiles, dataRows);
  const plan = buildSectionPlan(toSectionPlanInput(classification, profiles, dataRows));
  const seed = buildReportWorkspaceSeed({ quantStats: toQuantStats(roleStats), sectionPlan: plan });

  console.log(`  ${dataset.name}: ${seed.sections.map((s) => `${s.numeral}.${s.title}`).join(" / ")}`);
  check(`${dataset.name} 목차 = 에이전트 장 목록`, seed.sections.map((s) => s.title), plan.chapters.map((c) => c.title));
  // **장 제목만 나오고 내용이 비면 배선이 끊긴 것이다** — 이 검사가 그걸 잡는다.
  const empty = seed.sections.filter((s) => s.blocks.length === 0).map((s) => s.title);
  check(`${dataset.name} 내용 없는 장`, empty, []);
}

// 케어클은 시점 문항이 5개라 고객 여정 장이 생긴다 — 리바랩스에는 없는 장이다.
const carecl = loadStageAnswerKey().find((d) => d.name === "케어클")!;
const cs = load(carecl.file);
const cProfiles = profileColumns(cs.headerRow, cs.dataRows);
const cClass = classificationFromSheet(cProfiles, carecl.stages);
const cSeed = buildReportWorkspaceSeed({
  quantStats: toQuantStats(computeRoleQuantStats(cClass, cProfiles, cs.dataRows)),
  sectionPlan: buildSectionPlan(toSectionPlanInput(cClass, cProfiles, cs.dataRows)),
});
const journey = cSeed.sections.find((s) => s.title.includes("고객 여정"));
check("케어클에 고객 여정 장 생성", !!journey, true);
check("고객 여정에 꺾은선", journey?.blocks.some((b) => b.kind === "journey-line"), true);
check("고객 여정에 워터폴", journey?.blocks.some((b) => b.kind === "waterfall"), true);

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);