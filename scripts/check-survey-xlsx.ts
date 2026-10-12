/**
 * 설문 문항 리스트 내보내기 검사 `npm run check:survey-xlsx`. API·DB·서버 불필요.
 * 번호 매기기·분기조건 표기·템플릿 채우기(드롭다운·안내 시트 보존)·CSV를 고정한다.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { numberQuestions, toCsv, toSheetRows, toWallaTxt, wallaChecklist, wallaLayout, wallaTodos, splitByProduct, type SurveyQuestion } from "../lib/survey/types";
import { buildSurveyXlsx } from "../lib/survey/xlsx";
import { normalizeSurvey, RANK_CAUTION } from "../lib/survey/generate";

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

// 제품별로 나누기: 가르는 문항 빼고, 제품 문항은 분기를 풀고, 공통 문항은 양쪽에.
const many = Array.from({ length: 6 }, (_, i) => q(`a${i}`, { branchOn: "track", branchValue: "A앱", note: "[A앱] 설명" }));
const draftOf = (qs: SurveyQuestion[]) => ({ companyName: "회사", productName: "A앱 / B앱", questions: qs, excludedFeatures: [], reviewNotes: [] });
const productDraft = draftOf([
  q("age"), tracked[0], ...many,
  q("b0", { branchOn: "track", branchValue: "B앱" }),
  q("bComp", { type: "객관식-단일", options: ["네", "아니요"], branchOn: "track", branchValue: "B앱" }),
  q("bCompName", { branchOn: "bComp", branchValue: "네" }),
  q("used", { type: "객관식-단일", options: ["네", "아니요"] }), q("name", { branchOn: "used", branchValue: "네" }),
  q("common"),
]);
const split = splitByProduct(productDraft)!;
assert.deepStrictEqual(split.map((d) => d.productName), ["A앱", "B앱"]);
assert.deepStrictEqual(split[1].questions.map((x) => x.id), ["age", "b0", "bComp", "bCompName", "used", "name", "common"]);
assert.ok(!split[0].questions.some((x) => x.id === "bCompName"), "다른 제품 문항에 딸린 문항도 빠진다");
assert.ok(split[0].questions.every((x) => x.branchOn !== "track"), "제품 분기는 풀린다");
assert.strictEqual(split[0].questions[1].note, "설명", "[제품명] 꼬리표 제거");
assert.strictEqual(split[0].questions.find((x) => x.id === "name")!.branchOn, "used", "작은 분기는 남는다");
assert.strictEqual(splitByProduct(draftOf(questions)), null, "가르는 문항이 없으면 나누지 않는다");

// 나눈 설문에 다른 제품의 흔적이 남지 않는다 — 실제 피매치 이름으로(2026-10-12).
const pt = "일반인용 필톡", bz = "기관용 필톡 biz cares";
const pm = splitByProduct({
  companyName: "피매치", productName: `${pt} / ${bz}`,
  questions: [
    q("track", { type: "객관식-단일", options: [pt, bz] }),
    ...Array.from({ length: 6 }, (_, i) => q(`p${i}`, { branchOn: "track", branchValue: pt })),
    q("b0", { branchOn: "track", branchValue: bz }),
    q("price", { note: "일반인용 필톡은 무료이며, 기관용 필톡 biz cares는 연 5만 원입니다." }),
  ],
  excludedFeatures: [{ name: `[${pt}] 회원가입`, reason: "x" }, { name: "매니저 로그인(기관용 필톡 biz cares)", reason: "승인 필요" }],
  reviewNotes: ["[공통 설문] 응답 비율 7:3", `[${bz}] 엑셀 준비 필요`, "필톡 biz cares 요금제 확인", `[${pt}] 본인인증 안내`],
})!;
const general = pm.find((d) => d.productName === pt)!;
assert.deepStrictEqual(general.excludedFeatures.map((f) => f.name), ["회원가입"], "다른 제품 제외 기능은 빠지고 꼬리표는 벗긴다");
assert.deepStrictEqual(general.reviewNotes.slice(1), ["본인인증 안내"], "[공통 설문]·다른 제품 메모는 빠진다");
assert.ok(general.questions.find((x) => x.id === "price")!.caution?.includes("다른 제품 내용"), "섞인 공통 문항은 표시한다");
assert.ok(!pm.find((d) => d.productName === bz)!.reviewNotes.some((n) => n.includes("본인인증")));

// 순위 문항: 첫 문항에 중복 선택 경고, WALLA 설정 목록에 따로 한 줄.
const ranked = normalizeSurvey({
  companyName: "회사", productName: "앱", excludedFeatures: [], reviewNotes: [],
  questions: ["1위", "2위"].map((text, i) => ({ ...q(`r${i}`, { type: "객관식-단일", options: ["A", "B"], followUp: i > 0 }), text, caution: "" })),
} as Parameters<typeof normalizeSurvey>[0]);
assert.ok(ranked.questions[0].caution?.startsWith(RANK_CAUTION) && !ranked.questions[1].caution);
assert.ok(wallaChecklist(ranked.questions).includes("■ 5. 순위 문항 — '중복 선택 방지' 설정"));
// 인적 사항 안의 딸린 주관식(타사 장점·단점)은 긴 답이다.
const longTxt = toWallaTxt([q("used2", { type: "객관식-단일", options: ["네"] }), q("pros", { followUp: true, branchOn: "used2", branchValue: "네" })]).split("\r\n");
assert.strictEqual(longTxt[longTxt.indexOf("pros") - 1], "[[Question:TE:Essay]]");

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
