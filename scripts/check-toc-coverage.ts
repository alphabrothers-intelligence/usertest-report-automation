// **5종 목차를 원본 기준과 대조한다.** `npm run check:toc-coverage`. LLM·DB 없음, 무료.
//
// 정답은 `docs/STAGE_MAPPING.xlsx` > `표준목차` 시트의 **`제품군 실적`** 열이다 — 담당자와 같이
// 만들면서 발행 보고서 5종을 대조해 "이 절이 어느 데이터셋에 실제로 들어갔는지" 적어둔 칸이다
// (`5/5`, `1/5 (케어클만)`, `4/5 (투블럭 생략)` …). 정답을 여기에 손으로 적지 말 것 —
// 시트가 유일한 출처다(memory: feedback-single-answer-key).
//
// 이 검사가 필요한 이유: 지금까지 회귀는 리바랩스 기준이었고 나머지 4종은 "에러 없이 렌더된다"
// 까지만 봤다. 그 사이 원본에 없는 장이 생기고(교차 분석) 있어야 할 절이 빠지는 일이 실제로
// 있었다(2026-08-31 담당자 지적). 눈으로 한 장씩 보는 방식으로는 계속 샌다.
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns, type ColumnProfile } from "../lib/agent/profile";
import type { RoleClassification } from "../lib/agent/classify";
import { buildSectionPlan } from "../lib/agent/sectionPlan";
import { toSectionPlanInput } from "../lib/agent/classify";
import { defaultRole, loadStageAnswerKey, type StageCode } from "./stageAnswerKey";

const DATA = path.join(process.cwd(), "data");
/** 시트의 괄호 설명에 나오는 이름 ↔ 검사에서 쓰는 데이터셋 이름. */
const NAMES = ["리바랩스", "케어클", "이젠오토", "정리습관", "투블럭"] as const;

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`  FAIL ${label}\n    기대: ${JSON.stringify(expected)}\n    실제: ${JSON.stringify(actual)}`);
}

/**
 * `제품군 실적` 칸을 "이 데이터셋에 들어가야 하는가" 목록으로 읽는다.
 *
 * **이 칸은 두 가지를 같이 적는다 — 원본이 실제로 그랬는가(실적)와 우리 표준이 무엇인가.**
 * 둘은 일부러 갈리는 곳이 있다. 원본 5종 중 셋은 축약본이라 표준보다 절이 적다(투블럭에
 * 인적 사항 장이 없고, 정리습관 마지막 장이 요약 1절뿐이다). 그래서 **`표준은 …`이라고
 * 적힌 칸은 그쪽이 기대값이고 앞의 `N/5`는 원본 기록일 뿐이다** — 예전엔 이걸 못 읽어서
 * "코드가 원본보다 절을 더 만든다"는 이유로 FAIL 이 났었다(2026-08-31).
 *
 * 읽는 법은 하나다 — **`표준은 …`이 있으면 그 뒤만 읽고, 없으면 칸 전체를 읽는다.** 그 다음은
 * 표현 세 가지로 단순하다: `전 제품군`(전부), 데이터셋 이름 + `생략`·`미수집`·`없음`·`제외`·
 * `미달`(그 데이터셋만 빼고), 이름만(그 데이터셋에만). 이름이 없으면 `N/5`의 N이 5일 때만
 * 전부로 본다. **N<5인데 이름이 안 적혀 있으면 판정하지 않는다**(모르는 것을 아는 척하지 않는다).
 */
function expectedDatasets(cell: string): Set<string> | null {
  const standard = cell.includes("표준은") ? cell.slice(cell.indexOf("표준은")) : cell;
  if (standard.includes("전 제품군")) return new Set(NAMES);
  const mentioned = NAMES.filter((name) => standard.includes(name));
  if (mentioned.length > 0) {
    const excluded = /생략|미수집|없음|제외|미달/.test(standard);
    return new Set(excluded ? NAMES.filter((name) => !mentioned.includes(name)) : mentioned);
  }
  const ratio = /(\d)\s*\/\s*5/.exec(standard);
  return ratio?.[1] === "5" ? new Set(NAMES) : null;
}

/**
 * 데이터에 따라 절 제목이 바뀌는 곳. `판정 조건` 칸의 "절 제목이 '○○'로 바뀐다" 문장에서
 * 뽑는다 — 투블럭은 기업 측 추가 질문이 있어 `개선 아이디어`가 `기업 측 질문 및 개선
 * 아이디어`로 나온다(투블럭 원본 p27 목차도 그 제목이다). 시트에 이미 적혀 있는 규칙이므로
 * 여기에 제목을 손으로 적지 않는다.
 */
function titleVariants(sectionTitle: string, condition: string): string[] {
  const renamed = [...condition.matchAll(/절 제목이 ['"“”']([^'"“”']+)['"“”']로 바뀐다/g)].map((m) => m[1]);
  return [sectionTitle, ...renamed];
}

type SheetRow = {
  chapterId: string;
  chapterTitle: string;
  sectionTitle: string;
  /** 같은 절이 데이터에 따라 갖는 제목 전부(시트가 정한다). 하나라도 있으면 그 절이 있는 것이다. */
  titles: string[];
  expected: Set<string> | null;
  raw: string;
};

function loadSheet(): SheetRow[] {
  const workbook = XLSX.read(readFileSync(path.join(process.cwd(), "docs", "STAGE_MAPPING.xlsx")), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["표준목차"], { header: 1, defval: null });
  const out: SheetRow[] = [];
  let chapterId = "";
  let chapterTitle = "";
  for (const row of rows.slice(1)) {
    const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
    // 장 칸은 첫 절에만 있고 나머지 절은 비어 있다(병합 셀) — 직전 값을 이어 쓴다.
    if (text(row[0])) chapterId = text(row[0]);
    if (text(row[1])) chapterTitle = text(row[1]);
    const sectionTitle = text(row[3]);
    if (!sectionTitle) continue;
    const raw = text(row[11]);
    out.push({
      chapterId,
      chapterTitle,
      sectionTitle,
      titles: titleVariants(sectionTitle, text(row[8])),
      expected: expectedDatasets(raw),
      raw,
    });
  }
  return out;
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

const SHEET = loadSheet();
type Plan = ReturnType<typeof buildSectionPlan>;
const plans = new Map<string, Plan>();
for (const dataset of loadStageAnswerKey()) {
  const buffer = readFileSync(path.join(DATA, dataset.file));
  const { headerRow, dataRows } = parseWallaWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const profiles = profileColumns(headerRow, dataRows);
  const classification = classificationFromSheet(profiles, dataset.stages);
  const short = NAMES.find((name) => dataset.name.startsWith(name)) ?? dataset.name;
  plans.set(short, buildSectionPlan(toSectionPlanInput(classification, profiles, dataRows)));
}

/** 그 계획에 이 절이 있는가. 제목이 데이터에 따라 바뀌는 절은 변형 제목도 인정한다. */
const hasSection = (plan: Plan | undefined, row: SheetRow) =>
  plan?.chapters.some((c) => c.id === row.chapterId && c.sections.some((s) => row.titles.includes(s.title))) ?? false;

console.log("=== 절 단위 대조 (시트 `제품군 실적` 기준) ===");
console.log(`${"장".padEnd(4)}${"절".padEnd(34)}${NAMES.map((n) => n.slice(0, 4).padEnd(7)).join("")}`);

const unjudged: string[] = [];
for (const row of SHEET) {
  const actual = new Set(NAMES.filter((name) => hasSection(plans.get(name), row)));
  const marks = NAMES.map((name) => {
    if (!row.expected) return "?".padEnd(7);
    const want = row.expected.has(name);
    const got = actual.has(name);
    return (want === got ? (got ? "O" : "-") : got ? "▲있음" : "▼없음").padEnd(7);
  });
  console.log(`${row.chapterId.padEnd(4)}${row.sectionTitle.slice(0, 32).padEnd(34)}${marks.join("")}`);

  if (!row.expected) {
    unjudged.push(`${row.chapterId} ${row.sectionTitle} — 실적 칸 "${row.raw}"에 데이터셋 이름이 없어 판정 불가`);
    continue;
  }
  check(`${row.chapterId} ${row.sectionTitle}`, [...actual].sort(), [...row.expected].sort());
}

if (unjudged.length > 0) {
  console.log("\n판정하지 않은 절 (시트에 어느 데이터셋인지 안 적혀 있음):");
  for (const line of unjudged) console.log(`  · ${line}`);
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);