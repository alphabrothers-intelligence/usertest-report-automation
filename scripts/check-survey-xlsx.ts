/**
 * 설문 문항 리스트 내보내기 검사 `npm run check:survey-xlsx`. API·DB·서버 불필요.
 * 번호 매기기·분기조건 표기·템플릿 채우기(드롭다운·안내 시트 보존)·CSV를 고정한다.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { numberQuestions, rankOf, scaleAnchors, toCsv, toSheetRows, toWallaTxt, wallaChecklist, wallaLayout, wallaTodos, splitByProduct, type SurveyQuestion } from "../lib/survey/types";
import { buildSurveyXlsx } from "../lib/survey/xlsx";
import { addUpcomingFeatureQuestions, attachStandardFollowUps, fixParticles, numberUxQuality, normalizeSurvey, RANK_CAUTION, UPCOMING_CAUTION, type RawSurvey } from "../lib/survey/generate";
import { lintSurvey } from "../lib/survey/lint";
import { uxHeadersMissingPrefix } from "../lib/agent/profile";

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

// 표준 이유·순위 문항은 코드가 붙인다: 기능 만족도 → 이유 + (마지막 기능 뒤) 순위, 4대 가치 전부, 추천 의향(종합 만족도는 안 붙임).
// 모델이 만든 순위·표준 이유 문항은 지우고 새로 붙인다(기타 기업 요청사항의 이유는 남긴다).
const F = "기능별 고객 경험 평가 - 자사 제품 평가";
const scale = (id: string, stage: string, text: string) => ({ ...q(id, { stage, type: "척도(0-10)", text }), caution: "" });
const ranked = normalizeSurvey({
  companyName: "회사", productName: "앱", excludedFeatures: [], reviewNotes: [],
  questions: [
    scale("f1", F, "'기능 A' 기능에 대해 얼마나 만족하시나요?"),
    { ...q("f1r", { stage: F, followUp: true, text: "이유는요?" }), caution: "" },
    scale("f2", F, "'기능 B' 기능에 대해 얼마나 만족하시나요?"),
    { ...q("old", { stage: F, type: "객관식-단일", text: "1위", options: ["X"] }), caution: "" },
    { ...q("old2", { stage: F, text: "다음 기능 중 중요하다고 생각하는 순서대로 순위를 매겨 주세요." }), caution: "" },
    scale("v1", "가치 만족도 평가", "앱의 기능적 가치 영역에 대한 만족도는 몇 점인가요?"),
    { ...q("v1r", { stage: "가치 만족도 평가", followUp: true, text: "이유" }), caution: "" },
    scale("v2", "가치 만족도 평가", "앱의 심미적 가치 영역에 대한 만족도는 몇 점인가요?"),
    scale("n1", "구매/추천 의향 조사", "본 제품을 체험해 보았을 때, 앱을 사용할 의향이 있나요?"),
    scale("n2", "구매/추천 의향 조사", "본 제품을 체험해 보았을 때, 앱을 지인에게 추천할 의향이 얼마나 있나요?"),
    scale("o", "종합 만족도", "앱의 전반적인 만족도(종합 점수)는 몇 점인가요?"),
    { ...q("or", { stage: "종합 만족도", followUp: true, text: "위와 같이 평가한 이유는 무엇인가요?" }), caution: "" },
    { ...q("e", { stage: "기타 기업 요청사항", type: "객관식-단일", options: ["A", "B"], text: "가장 불편했던 단계는?" }), caution: "" },
    { ...q("er", { stage: "기타 기업 요청사항", followUp: true, text: "그 이유는 무엇인가요?" }), caution: "" },
  ],
} as unknown as RawSurvey);
assert.deepStrictEqual(ranked.questions.map((x) => x.id),
  ["f1", "f1_reason", "f2", "f2_reason", "f2_rank1", "f2_rank2", "v1", "v1_reason", "v2", "v2_reason", "n1", "n2", "n2_reason", "o", "e", "er"]);
const r1 = ranked.questions.find((x) => x.id === "f2_rank1")!;
assert.strictEqual(r1.text, "앱의 기능 중 가장 중요하다고 생각하는 기능은 무엇인가요? (1순위)");
assert.deepStrictEqual(r1.options, ["기능 A", "기능 B"]);
assert.strictEqual(ranked.questions.find((x) => x.id === "f2_rank2")!.text, "두 번째로 중요하다고 생각하는 기능은 무엇인가요? (2순위)");
assert.ok(r1.caution?.startsWith(RANK_CAUTION) && !ranked.questions.find((x) => x.id === "f2_rank2")!.caution);
assert.ok(wallaChecklist(ranked.questions).includes("■ 5. 순위 문항 — '중복 선택 방지' 설정"));
// 출시 예정이라 뺀 기능은 기타 기업 요청사항에 수요 문항이 생긴다(제품 태그 → 그 제품 분기). 이미 있으면 안 만든다.
const trackQ = q("track", { type: "객관식-단일", options: ["앱 A", "앱 B"] });
const perB = Array.from({ length: 6 }, (_, k) => q(`b${k}`, { stage: "기타 기업 요청사항", branchOn: "track", branchValue: k % 2 ? "앱 B" : "앱 A" }));
const upcoming = addUpcomingFeatureQuestions([trackQ, ...perB], [{ name: "[앱 A] 약봉투 촬영 등록", reason: "출시 예정" }, { name: "코드 입력", reason: "결제 필요" }]);
const demand = upcoming.filter((x) => x.id.startsWith("upcoming"));
assert.strictEqual(demand.length, 1);
assert.strictEqual(demand[0].text, "'약봉투 촬영 등록' 기능이 추가된다면 얼마나 유용할 것 같나요?");
assert.deepStrictEqual([demand[0].branchOn, demand[0].branchValue, demand[0].caution], ["track", "앱 A", UPCOMING_CAUTION]);
assert.strictEqual(addUpcomingFeatureQuestions(upcoming, [{ name: "[앱 A] 약봉투 촬영 등록", reason: "출시 예정" }]).length, upcoming.length, "이미 있으면 안 만든다");
// 척도 양 끝 라벨: 빠지면 코드가 만족도 기본값을 붙이고, 모델이 다른 라벨을 적었으면 그대로 둔다.
const scaled = normalizeSurvey({
  companyName: "회사", productName: "앱", excludedFeatures: [], reviewNotes: [],
  questions: [
    { ...q("s1", { type: "척도(0-10)", note: "'A'는 B 기능입니다." }), caution: "" },
    { ...q("s2", { type: "척도(0-10)", note: "0=매우 어려웠다, 10=매우 쉬웠다" }), caution: "" },
  ],
} as unknown as RawSurvey);
assert.strictEqual(scaled.questions[0].note, "'A'는 B 기능입니다. 0=매우 불만족, 10=매우 만족");
assert.strictEqual(scaled.questions[1].note, "0=매우 어려웠다, 10=매우 쉬웠다");
// 복수 선택 표기·'해당 없어요' 뒤 이유 문항 표시(코드가 단다), 매뉴얼 lint.
const fixed = normalizeSurvey({
  companyName: "회사", productName: "앱", excludedFeatures: [], reviewNotes: [],
  questions: [
    { ...q("m", { stage: "기타 기업 요청사항", type: "객관식-복수", options: ["A", "해당 없어요"], text: "우려되는 점은 무엇인가요?" }), caution: "" },
    { ...q("step", { stage: "기타 기업 요청사항", type: "객관식-단일", options: ["A", "해당 없어요"], text: "가장 불편했던 단계는 무엇인가요?" }), caution: "" },
    { ...q("why", { stage: "기타 기업 요청사항", followUp: true, text: "그 단계가 불편했던 이유는 무엇인가요?" }), caution: "" },
  ],
} as unknown as RawSurvey);
assert.strictEqual(fixed.questions[0].text, "우려되는 점은 무엇인가요? (중복 선택 가능)");
assert.ok(fixed.questions[2].caution?.startsWith("'해당 없어요' 응답자는"));
const branchedWhy = normalizeSurvey({ companyName: "회사", productName: "앱", excludedFeatures: [], reviewNotes: [], questions: [
  { ...q("t", { type: "객관식-단일", options: ["앱 A", "앱 B"] }), caution: "" },
  { ...q("s", { stage: "기타 기업 요청사항", type: "객관식-단일", options: ["A", "특별히 어려운 단계는 없었어요"], branchOn: "t", branchValue: "앱 A" }), caution: "" },
  { ...q("w", { stage: "기타 기업 요청사항", followUp: true, branchOn: "t", branchValue: "앱 A" }), caution: "" },
] } as unknown as RawSurvey);
assert.ok(branchedWhy.questions[2].caution?.startsWith("'특별히 어려운 단계는 없었어요' 응답자는"), "제품 분기 안에서도 건너뛰기 표시");
const lint = lintSurvey({ ...fixed, questions: [
  q("a", { text: "성별은 무엇입니까?" }),
  q("b", { type: "척도(0-10)", text: "디자인·UI는 만족스러우셨나요?" }),
  q("c", { type: "객관식-단일", options: ["1회~3회", "3회~5회"] }),
] });
assert.deepStrictEqual(lint.filter((i) => i.level === "위반").map((i) => i.principle),
  ["통일성", "통일성", "명확성", "만족도 형식", "배타성"]);
assert.deepStrictEqual(lintSurvey({ ...fixed, questions: [q("d", { type: "객관식-단일", options: ["1회 이상 3회 미만", "3회 이상 5회 미만"] })] }), []);
assert.deepStrictEqual(lintSurvey({ ...fixed, questions: [
  q("kbf", { type: "객관식-단일", options: ["A", "기타(직접 입력)"], text: "필톡을 이용함에 있어서 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하나요?" }),
  q("use", { type: "척도(0-10)", note: "0=전혀 없음, 10=매우 있음", text: "본 제품을 체험해 보았을 때, 필톡을 사용할 의향이 있나요?" }),
] }), [], "표준 문구는 '~요' 통일");
assert.ok(lintSurvey({ ...fixed, questions: [q("x", { text: "사용하실 의향이 있으신가요?" })] }).some((i) => i.principle === "통일성"));
assert.strictEqual(rankOf({ type: "객관식-단일", text: "두 번째로 중요하다고 생각하는 기능은 무엇인가요? (2순위)" }), 2);
assert.strictEqual(rankOf({ type: "객관식-단일", text: "3위" }), 3);
assert.strictEqual(rankOf({ type: "주관식", text: "1위" }), null);
// 핵심구매요인 뒤에는 이유 주관식이 하나 붙는다(리바랩스 설문과 구성 맞춤, 보고서는 읽지 않는다). 종합 만족도엔 안 붙는다.
const withReasons = attachStandardFollowUps([
  q("kbf", { stage: "핵심구매요인 파악", type: "객관식-단일", options: ["A", "B"] }),
  q("kbf_model_reason", { stage: "핵심구매요인 파악", followUp: true, text: "왜 그렇게 생각하시나요?" }),
  q("tot", { stage: "종합 만족도", type: "척도(0-10)" }),
], "앱");
assert.deepStrictEqual(withReasons.map((x) => `${x.id}:${x.text}`),
  ["kbf:kbf", "kbf_reason:위와 같이 평가한 이유는 무엇인가요?", "tot:tot"], "핵심구매요인 이유 문항");
// 사용자 경험 품질: 접두 번호는 계열별 1부터 다시 매기고, 이유 문항은 붙지 않는다. 3개 미만 계열과 접두 없는 문항엔 경고.
const ux = [
  q("u1", { stage: "사용자 경험 품질 평가", type: "척도(0-10)", text: "실용성3) 앱 조작은 [불편하다 / 편하다]" }),
  q("u2", { stage: "사용자 경험 품질 평가", type: "척도(0-10)", text: "즐거움 1) 이용 경험은 [지루하다 / 재미있다]" }),
  q("u3", { stage: "사용자 경험 품질 평가", type: "척도(0-10)", text: "실용성) 흐름은 [혼란스럽다 / 자연스럽다]" }),
  q("u4", { stage: "사용자 경험 품질 평가", type: "척도(0-10)", text: "실용성9) 화면 구성은 [복잡하다 / 직관적이다]" }),
  q("u5", { stage: "사용자 경험 품질 평가", type: "척도(0-10)", text: "메뉴는 [어렵다 / 쉽다]" }),
];
numberUxQuality(ux);
assert.deepStrictEqual(ux.map((x) => x.text.split(")")[0]), ["실용성1", "즐거움1", "실용성2", "실용성3", "메뉴는 [어렵다 / 쉽다]"]);
assert.ok(ux[1].caution?.includes("1개뿐"), "즐거움 1개 경고");
assert.ok(!ux[0].caution?.includes("개뿐"), "실용성은 3개라 개수 경고 없음");
assert.ok(ux[4].caution?.includes("계열이 정해지지"), "접두 없는 문항 경고");
assert.ok(!attachStandardFollowUps(ux, "앱").some((x) => x.id.endsWith("_reason")), "UX 품질엔 이유 문항이 붙지 않는다");
// 계열 표시는 응답자에게 안 보이게 WALLA txt에서 빼고, 설정 목록·문항 할 일·경고로 "raw data 제목에 붙이라"고 알린다.
const uxTxt = toWallaTxt(ux);
assert.ok(uxTxt.includes("앱 조작은 [불편하다 / 편하다]") && !/실용성\d\)|즐거움\d\)/.test(uxTxt), "WALLA txt에 계열 표시가 남음");
const uxList = wallaChecklist(ux);
assert.ok(uxList.includes("■ 6. [보고서 만들 때 꼭]") && uxList.includes("→ 제목 앞에 '실용성1)'") && uxList.includes("→ 제목 앞에 '즐거움1)'"), "설정 목록 6번");
assert.ok(wallaTodos(ux[0], wallaLayout(ux)).some((t) => t.includes("'실용성1)'를 붙여야")), "문항 할 일");
assert.ok(ux[0].caution?.includes("WALLA에는 '실용성1)' 없이"), "문항 경고");
assert.deepStrictEqual(uxHeadersMissingPrefix(["실용성1) 조작은 [불편하다 / 편하다]", "앱 조작은 [불편하다 / 편하다]", "나이", "실용성1)\r\n조작 편의성"]),
  ["앱 조작은 [불편하다 / 편하다]"], "업로드 경고는 표시 없는 의미분별 척도만");

// 조사: 받침으로 고르고, 한글 아닌 글자 뒤는 중복만 합친다.
assert.strictEqual(fixParticles("필톡을(를) 지인에게"), "필톡을 지인에게");
assert.strictEqual(fixParticles("케어로그을(를) 쓰고 앱이(가) 좋은(는)"), "케어로그를 쓰고 앱이 좋은");
assert.strictEqual(fixParticles("biz cares를(를) 이용"), "biz cares를 이용");
assert.strictEqual(fixParticles("biz cares을(를) 이용"), "biz cares을(를) 이용");
// 제품별로 나눌 때 태그 없는 제외 기능은 그 기능 문항이 있는 제품에만 남는다.
const tagless = splitByProduct({ ...productDraft, excludedFeatures: [{ name: "a0(일부)", reason: "출시 예정" }] })!;
assert.deepStrictEqual(tagless.map((d) => d.excludedFeatures.length), [1, 0]);
assert.deepStrictEqual(scaleAnchors("무료입니다. 0=매우 불만족, 10=매우 만족"), ["매우 불만족", "매우 만족"]);
assert.deepStrictEqual(scaleAnchors(""), ["매우 불만족", "매우 만족"], "옛 저장본은 기본값");
assert.ok(wallaChecklist(scaled.questions).includes("— 0='매우 어려웠다', 10='매우 쉬웠다'"));
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
