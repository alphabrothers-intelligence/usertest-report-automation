/**
 * 설문 문항 리스트 내보내기 검사 `npm run check:survey-xlsx`. API·DB·서버 불필요.
 * 번호 매기기·분기조건 표기·템플릿 채우기(드롭다운·안내 시트 보존)·CSV를 고정한다.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { numberQuestions, toCsv, toSheetRows, toWallaTxt, type SurveyQuestion } from "../lib/survey/types";
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
assert.strictEqual(txt.filter((l) => l.startsWith("[[Block:")).length, 2, "단계마다 블록 하나");
assert.strictEqual(txt.filter((l) => l === "[[PageBreak]]").length, 1, "단계 사이에만 쪽 나눔");
const at = (text: string) => txt.indexOf(text);
assert.deepStrictEqual(txt.slice(at("used") - 1, at("used") + 4), ["[[Question:MC:SingleAnswer:Vertical]]", "used", "[[Choices]]", "네, 있어요", "아니요, 없어요"]);
assert.strictEqual(txt[at("score") - 1], "[[Question:NPS]]", "척도는 NPS(0~10)");
assert.notStrictEqual(txt[at("score") + 1], "[[Choices]]", "척도에는 보기를 붙이지 않는다");
assert.strictEqual(txt[at("나이를 입력해 주세요.") - 1], "[[Question:TE:SingleLine]]", "인적 사항 주관식은 한 줄");
assert.strictEqual(txt[at("idea2") - 1], "[[Question:TE:Essay]]", "그 밖의 주관식은 장문");

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
