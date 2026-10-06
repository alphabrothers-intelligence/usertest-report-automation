/**
 * 설문 문항 리스트 내보내기 검사 `npm run check:survey-xlsx`. API·DB·서버 불필요.
 * 번호 매기기·분기조건 표기·템플릿 채우기(드롭다운·안내 시트 보존)·CSV를 고정한다.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { numberQuestions, toCsv, toSheetRows, toWallaTxt, wallaChecklist, wallaLayout, wallaTodos, type SurveyQuestion } from "../lib/survey/types";
import { buildSurveyXlsx } from "../lib/survey/xlsx";

const q = (id: string, patch: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id, stage: "인적 사항 및 특성·경험 조사", text: id, type: "주관식", options: [], required: true,
  followUp: false, branchOn: "", branchValue: "", note: "", ...patch,
});

const questions = [
  q("age", { text: "나이를 입력해 주세요." }),
  q("used", { type: "객관식-단일", options: ["네, 있어요", "아니요, 없어요"] }),
  q("name", { followUp: true, branchOn: "used", branchValue: "네, 있어요", text: "제품 이름, \"따옴표\"" }),
  q("score", { followUp: true, type: "척도(0-10)", options: ["남은 보기"] }),
  q("idea", { required: false }),
];

assert.deepStrictEqual([...numberQuestions(questions).values()], ["Q1", "Q2", "Q2-1", "Q2-2", "Q3"]);
const rows = toSheetRows(questions);
assert.strictEqual(rows[1][4], "네, 있어요;아니요, 없어요");
assert.strictEqual(rows[2][6], "Q2 = '네, 있어요' 응답 시");
assert.strictEqual(rows[3][4], "", "척도는 보기를 비운다");
assert.strictEqual(rows[4][5], "선택");

const csv = toCsv(questions);
assert.ok(csv.startsWith("﻿단계,문항번호"));
assert.ok(csv.includes('"제품 이름, ""따옴표"""'));

const txt = toWallaTxt([...questions, q("idea2", { stage: "개선 아이디어" })]).split("\r\n");
assert.strictEqual(txt[0], "[[AdvancedFormat]]");
// 인적(age, used) | 네·인적(분기 문항 name) | 인적(score, idea) | 개선(idea2) — 분기 묶음은 따로 한 쪽
assert.deepStrictEqual(txt.filter((l) => l.startsWith("[[Block:")), [
  "[[Block:인적 사항 및 특성·경험 조사]]", "[[Block:네, 있어요 · 인적 사항 및 특성·경험 조사]]",
  "[[Block:인적 사항 및 특성·경험 조사]]", "[[Block:개선 아이디어]]",
]);
assert.strictEqual(txt.filter((l) => l === "[[PageBreak]]").length, 3, "블록 사이에만 쪽 나눔");
const at = (text: string) => txt.indexOf(text);
assert.deepStrictEqual(txt.slice(at("used") - 1, at("used") + 4), ["[[Question:MC:SingleAnswer:Vertical]]", "used", "[[Choices]]", "네, 있어요", "아니요, 없어요"]);
assert.deepStrictEqual(
  txt.slice(at("score") - 1, at("score") + 15),
  ["[[Question:Matrix:SingleAnswer]]", "score", "[[Choices]]", "점수", "[[Answers]]", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  "척도는 한 줄 객관식 표(열 0~10), 남은 보기는 무시",
);
assert.strictEqual(txt[at("나이를 입력해 주세요.") - 1], "[[Question:TE:SingleLine]]", "인적 사항 주관식은 한 줄");
assert.strictEqual(txt[at("idea2") - 1], "[[Question:TE:Essay]]", "그 밖의 주관식은 장문");

// 분기 문항은 기준 문항 바로 뒤에 보기별로 모인다(엑셀 순서와 달라도 된다).
const tracked = [
  q("track", { type: "객관식-단일", options: ["A앱", "B앱"] }),
  q("a1", { stage: "기능별 고객 경험 평가 - 자사 제품 평가", branchOn: "track", branchValue: "A앱" }),
  q("b1", { stage: "기능별 고객 경험 평가 - 자사 제품 평가", branchOn: "track", branchValue: "B앱" }),
  q("a2", { stage: "핵심구매요인 파악", branchOn: "track", branchValue: "A앱" }),
  q("common", { stage: "종합 만족도", required: false }),
];
const layout = wallaLayout(tracked);
assert.deepStrictEqual(layout.map((s) => s.q.id), ["track", "a1", "a2", "b1", "common"]);
assert.deepStrictEqual(layout.map((s) => s.label), ["1-1", "2-1", "3-1", "4-1", "5-1"]);
assert.deepStrictEqual(wallaTodos(tracked[1], layout), ["분기: 1-1 문항에서 'A앱'를 고른 사람에게만 보임 — 로직은 1-1에 설정", "필수입력 켜기"]);
const list = wallaChecklist(tracked);
assert.ok(list.includes("'A앱' → 2-1 a1"), list);
assert.ok(list.includes("'B앱' → 4-1 b1"));
assert.ok(list.includes("3-1(‘A앱’ 묶음 끝)의 기본 이동 → 5-1 common"));
assert.ok(list.includes("· 5-1 common"), "필수 아닌 문항만 나열");

async function main() {
const template = readFileSync("public/templates/survey-question-template.xlsx");
const many = Array.from({ length: 120 }, (_, i) => q(`m${i}`));
for (const [list, label] of [[questions, "5문항"], [many, "120문항"]] as const) {
  const bytes = await buildSurveyXlsx(template, [...list]);
  const wb = XLSX.read(bytes);
  assert.deepStrictEqual(wb.SheetNames, ["문항리스트", "작성 안내"]);
  const sheet = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["문항리스트"], { header: 1 });
  assert.strictEqual(sheet[0][0], "단계 *", "머리행 유지");
  assert.strictEqual(sheet[3][2], list[0].text, "4행부터 문항");
  assert.strictEqual(sheet[3 + list.length - 1][1], numberQuestions([...list]).get(list.at(-1)!.id));
  const xml = await (await JSZip.loadAsync(bytes)).file("xl/worksheets/sheet1.xml")!.async("string");
  const last = Math.max(101, 4 + list.length);
  assert.ok(xml.includes(`sqref="D4:D${last}"`), `${label}: 문항타입 드롭다운 범위`);
  if (label === "5문항") {
    // 같은 단계 5문항 → A4:A8 한 칸으로 병합, 값은 첫 칸에만
    assert.ok(xml.includes('<mergeCell ref="A4:A8"/>'), "단계 칸 병합");
    assert.ok(xml.indexOf("<mergeCells") < xml.indexOf("<conditionalFormatting"), "mergeCells 위치(스키마 순서)");
    assert.strictEqual(sheet[4][0], undefined, "병합된 칸은 비운다");
  }
  console.log(`PASS xlsx ${label}`);
}
}
main().then(() => console.log("PASS 번호·분기·CSV·WALLA txt"), (e) => { console.error(e); process.exit(1); });
