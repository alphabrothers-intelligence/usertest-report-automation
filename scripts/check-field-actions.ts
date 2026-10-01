/**
 * 분야별 액션 플랜이 **실제 보고서 렌더러를 거쳐** 본문 줄과 문항 끝 표로 나오는지 검사한다.
 * API·DB 없이 `buildReportWorkspaceSeed`만 돌린다 — `npm run check:field-actions`.
 *
 * 스키마·프롬프트만 맞아도 렌더가 빠지면 담당자 화면에는 아무것도 안 보인다(2026-09-16
 * 도입 시 같은 종류의 사고를 미리 막는다). `--html <경로>`를 주면 그 HTML을 파일로 남겨
 * 브라우저로 눈으로 확인할 수 있다.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";
import { buildReportWorkspaceSeed } from "../lib/report/workspace";

const buffer = readFileSync(new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url));
const parsed = parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
const quantStats = computeQuantStats(normalizeWallaRows(parsed.headerRow, parsed.dataRows), parsed.headerRow);

const category = (
  id: string,
  polarity: "negative" | "positive" | "neutral",
  label: string,
  insight: string,
  field_actions: { field: string; action: string }[] | null,
) => ({
  id, question_id: "q1", polarity, label, clause_count: 3, quotes: ["조금 불편했어요"],
  quotes_display: null, insight_draft: insight, insight_final: null, insight_approved: true,
  polarity_reviewed: false, respondents: null, field_actions,
});

const seed = buildReportWorkspaceSeed({
  quantStats,
  qualitative: [{
    id: "q1", question_key: "feature:펫과의 산책", label: "펫과의 산책", kind: "standard", polarity_summaries: null,
    categories: [
      // 같은 극성 안에서 같은 분야가 두 번 — 표에서 한 칸으로 합쳐져야 한다.
      category("c1", "negative", "지도 오류", "GPS 정확도 저하로 기록 신뢰도 저하", [
        { field: "SW 개발", action: "위치 보정 로직 점검 필요" },
        { field: "제품 기획", action: "기록 오차 안내 문구 추가 검토" },
      ]),
      category("c2", "negative", "보상 부족", "보상 체감 부족이 지속 사용 저해", [
        { field: "SW 개발", action: "보상 지급 주기 조정 검토" },
      ]),
      // 액션이 없는 카테고리 둘 — 인사이트는 그대로 싣고, 분야·액션 칸은 하나로 합쳐 "-".
      category("c3", "positive", "산책 재미", "산책 자체의 재미가 만족 요인으로 확인됨", []),
      category("c4", "positive", "기록 보기", "누적 기록 확인이 재방문 동기로 작용", null),
    ],
  }],
  recommendations: [],
});

const html = seed.sections.flatMap((s) => s.blocks).map((b) => ("html" in b ? b.html : "")).join("");

// ① 본문 — 분야명과 액션 문장이 인사이트 아래에 실린다.
assert.ok(html.includes("• <strong>SW 개발</strong>"), "본문에 분야명이 없다");
assert.ok(html.includes("위치 보정 로직 점검 필요"), "본문에 액션 문장이 없다");
// 인사이트 바로 뒤에 분야 줄이 와야 한다(사이에 빈 줄이 끼면 묶음이 갈려 보인다).
// 인사이트 바로 뒤에 액션 줄이 와야 한다(사이에 빈 줄이 끼면 묶음이 갈려 보인다).
assert.match(html, /GPS 정확도 저하로 기록 신뢰도 저하<\/em><\/strong><\/p><p style="font-weight:700;margin:8pt/);
// 액션 줄에 별도 글자 크기를 주지 않는다 — 본문 크기를 그대로 상속한다.
assert.ok(!/margin:8pt 0 0 14pt[^"]*font-size/.test(html), "액션 줄에 별도 글자 크기가 붙었다");

// ② 문항 끝 표 — 제목, 4열 머리글, 분야 병합, 액션 없는 행의 "-".
assert.ok(html.includes("인사이트 종합 및 분야별 액션 플랜"), "요약표가 없다");
// 기능 문항 표 제목은 "기능 인사이트"로 무엇을 평가한 결과인지 밝힌다(2026-09-16).
assert.match(html, /\[[^\]]+\] 기능 인사이트 종합 및 분야별 액션 플랜/, "기능 문항 제목이 아니다");
assert.ok(html.includes(">분야</td>") && html.includes(">액션 플랜</td>"), "표 머리글이 없다");
// 제목·머리글은 thead에 둔다 — 표가 쪽을 넘겨 쪼개져도 조각마다 다시 붙는다(splitBlock).
// 열 머리글만 thead에 둔다 — 조각마다 되풀이되는 것은 열 이름이고, 표 제목은 첫 조각에만 남는다.
assert.match(html, /<thead>(?:(?!<\/thead>)[\s\S])*>구분</, "열 머리글이 thead에 없다");
assert.ok(!/<thead>(?:(?!<\/thead>)[\s\S])*분야별 액션 플랜/.test(html), "표 제목이 thead에 있다(이어지는 쪽에 또 나온다)");
// 구분 칸은 "긍정 의견"처럼 쓰고 건수·명수는 넣지 않는다(2026-09-16 담당자 지시).
assert.ok(html.includes("부정<br>의견</td>"), "구분 칸이 '부정 / 의견' 두 줄이 아니다");
assert.ok(!/\d+건 · \d+명/.test(html), "표에 건수·명수가 남아 있다");
assert.ok(!/\(\d+명\)<\/span>/.test(html), "핵심 인사이트에 응답 수가 남아 있다");
// 같은 극성에서 SW 개발이 두 번 나오지만 칸은 하나(rowspan=2)여야 한다.
assert.match(html, /rowspan="2"[^>]*>SW 개발<\/td>/, "같은 분야가 한 칸으로 합쳐지지 않았다");
assert.equal((html.match(/>SW 개발<\/td>/g) ?? []).length, 1, "분야 칸이 중복으로 나온다");
// 액션 없는 카테고리: 인사이트는 실리고(연하게 칠하지 않는다) 액션 칸은 "-".
assert.ok(html.includes("산책 자체의 재미가 만족 요인으로 확인됨"), "액션 없는 인사이트가 표에서 빠졌다");
assert.ok(!html.includes("color:#9ca3af\">-"), "액션 없는 행을 연한 색으로 칠했다");
// 액션 없는 카테고리가 둘이면 분야·액션 칸은 각각 한 칸으로 합쳐지고 "-"가 하나씩만 남는다.
assert.equal((html.match(/rowspan="2"[^>]*>-<\/td>/g) ?? []).length, 2, "빈 분야·액션 칸이 합쳐지지 않았다");

// ③ 액션이 하나도 없는 문항에는 표를 만들지 않는다(빈 껍데기 금지).
const emptySeed = buildReportWorkspaceSeed({
  quantStats,
  qualitative: [{
    id: "q1", question_key: "feature:펫과의 산책", label: "펫과의 산책", kind: "standard", polarity_summaries: null,
    categories: [category("c1", "negative", "지도 오류", "GPS 정확도 저하", null)],
  }],
  recommendations: [],
});
const emptyHtml = emptySeed.sections.flatMap((s) => s.blocks).map((b) => ("html" in b ? b.html : "")).join("");
assert.ok(!emptyHtml.includes("인사이트 종합 및 분야별 액션 플랜"), "액션이 없는데 표가 생겼다");

const out = process.argv.indexOf("--html");
if (out > 0 && process.argv[out + 1]) {
  writeFileSync(process.argv[out + 1], `<!doctype html><meta charset="utf-8">
<style>body{margin:0;padding:10mm;background:#eef1f5;font-family:"맑은 고딕","Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:11pt;color:#111827}
section{width:210mm;box-sizing:border-box;background:#fff;padding:12mm 18mm;margin:0 auto}p{margin:0}</style>
<section>${seed.sections.flatMap((s) => s.blocks).filter((b) => b.id.includes("detail") || b.id.includes("fieldactions")).map((b) => ("html" in b ? b.html : "")).join("")}</section>`);
  console.log(`HTML 저장: ${process.argv[out + 1]}`);
}

console.log("PASS - 분야별 액션 플랜 15/15 (본문 줄 · 요약표 병합 · 빈 표 금지)");
