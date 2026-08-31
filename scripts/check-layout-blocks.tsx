// 범용 신규 레이아웃(PRD Phase 12c)의 데이터 규칙을 **발행 보고서에 인쇄된 실제 값**으로
// 검증한다. LLM·DB 호출 없음. `npm run check:layout-blocks`.
//
// - L13 꺾은선 · L13a 워터폴: 케어클 34쪽 "고객 여정 만족도 평가"
// - L27 핵심구매요소별 평균 만족도 표: 투블럭 19쪽
// - L14 경쟁재 비교표: 이젠오토 8쪽
//
// 우리가 계산한 값이 원본이 인쇄한 숫자와 맞는지가 이 검사의 핵심이다. 색·여백은 숫자로
// 확인되지 않으므로 그림도 같이 만든다(tmp/layout-blocks.html) — 렌더해서 원본과 나란히
// 봐야 한다(PRD 9.6절).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { EditableJourneyLineChart, EditableWaterfallChart } from "../components/report/EditableJourneyCharts";
import { EditableTable } from "../components/report/EditableTable";
import { journeyLineBlock, purchaseFactorSatisfactionBlock, waterfallBlock } from "../lib/report/sections";
import { competitorComparisonBlock } from "../lib/report/competitorTable";

/** 케어클 원본 34쪽 "고객 여정 만족도 평가" 표. 컬럼 순서 = 시간 순서다. */
const POINTS = [
  { label: "박스 첫 인상", value: 9.08 },
  { label: "박스 개봉", value: 9.08 },
  { label: "첫 사용", value: 7.16 },
  { label: "1주 사용 후", value: 7.20 },
  { label: "2주 사용 후", value: 7.56 },
  { label: "최종 만족도", value: 7.24 },
];

/** 원본 워터폴 막대 라벨에 인쇄된 증감값. 시점은 6개인데 막대는 4개다 — 첫 구간
 * (첫인상 9.08 → 개봉 9.08)은 변화가 0이라 원본이 뺐다(같은 쪽 표에도 `(-)`로 표기). */
const PUBLISHED_DELTAS: Record<string, number> = {
  "박스 개봉→첫 사용": -1.92,
  "첫 사용→1주 사용 후": 0.04,
  "1주 사용 후→2주 사용 후": 0.36,
  "2주 사용 후→최종 만족도": -0.32,
};

const line = journeyLineBlock({ id: "journey-line", title: "고객 여정 흐름 평균 만족도 결과", points: POINTS });
const waterfall = waterfallBlock({ id: "journey-waterfall", title: "고객 여정 흐름 평균 만족도 변화 상세 분석", points: POINTS });

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — 기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
  if (ok) pass += 1; else fail += 1;
}

console.log("=== L13 꺾은선: 시점 순서를 그대로 유지하는가 ===");
check("점 개수", line.points.length, POINTS.length);
check("순서(정렬 금지)", line.points.map((p) => p.label).join(" > "), POINTS.map((p) => p.label).join(" > "));
check("축 상한(척도 그대로)", line.axisMax, 10);

console.log("\n=== L13a 워터폴: 구간 증감이 원본 인쇄값과 같은가 ===");
// 원본과 같은 막대 구성인지 — 변화가 0인 구간은 빠져야 한다.
check("막대 개수(원본과 동일)", waterfall.steps.length, Object.keys(PUBLISHED_DELTAS).length);
check("첫 막대(0인 구간이 빠졌는가)", waterfall.steps[0]?.label, "박스 개봉→첫 사용");
// 모든 구간이 0이면 그래프가 비어버리므로 그때는 거르지 않는다.
const flat = waterfallBlock({ id: "flat", title: "변화 없음", points: [
  { label: "A", value: 7 }, { label: "B", value: 7 }, { label: "C", value: 7 },
] });
check("전 구간 0이면 막대를 남긴다", flat.steps.length, 2);
for (const [label, expected] of Object.entries(PUBLISHED_DELTAS)) {
  check(label, waterfall.steps.find((step) => step.label === label)?.delta, expected);
}
// 가장 큰 하락 구간(빨강으로 강조되는 칸)이 원본에서 강조된 구간과 같은지.
const biggestFall = [...waterfall.steps].sort((a, b) => a.delta - b.delta)[0];
check("최대 하락 구간", biggestFall.label, "박스 개봉→첫 사용");

console.log("\n=== L27 핵심구매요소별 평균 만족도(투블럭 19쪽) ===");
// 원본 19쪽 표에 인쇄된 값. 일부러 만족도 순서가 아닌 순서로 넣어 정렬 규칙을 확인한다.
const factors = [
  { name: "첨삭 정확도", mean: 7.47 },
  { name: "사용 편의성", mean: 7.63 },
  { name: "가격 경쟁력", mean: 5.83 },
  { name: "기술적 트렌드", mean: 8.27 },
  { name: "이용 자유도", mean: 7.60 },
  { name: "디자인", mean: 7.43 },
];
const factorTable = purchaseFactorSatisfactionBlock({ id: "purchase-factor-satisfaction", items: factors });
check("머리글(순위)", factorTable.headers.join(" "), "순위 1위 2위 3위 4위 5위 6위");
check("만족도 내림차순 정렬", (factorTable.rows[0] as string[]).slice(1).join(" > "), "기술적 트렌드 > 사용 편의성 > 이용 자유도 > 첨삭 정확도 > 디자인 > 가격 경쟁력");
check("1위 평균 만족도", factorTable.rows[1][1], 8.27);
check("6위 평균 만족도", factorTable.rows[1][6], 5.83);
// 원본은 8.27을 파랑이 아니라 흰색(중립)으로 칠했다 — 범례(9-10점 긍정)와 일치한다.
check("NPS 구간 색칠 켜짐", factorTable.npsBands, true);
check("첫 열은 라벨 열", factorTable.labelColumn, true);

console.log("\n=== L14 경쟁재 비교표(이젠오토 8쪽) ===");
// 원본 8쪽 [ 만족 기능 응답 결과 ] 표에 실제로 인쇄된 행이다. 이 값들은 raw data 원문이
// 아니라 45건의 자유서술을 서비스별로 묶고 요약한 결과 — 여기서는 그 결과를 넣어
// "원본과 같은 표로 그려지는가"만 본다.
const competitor = competitorComparisonBlock({
  id: "competitor-comparison",
  respondentCount: 45,
  rows: [
    { service: "마이클", pros: ["이동거리 별 소모품 관리 가능", "저렴한 차량 기본 점검", "전체적인 상태 점검 가능", "실시간 예약과 선결제"], cons: ["AI 기능 부재 : 모든 데이터 입력이 수작업으로 이루어져 있어 자동화된 기능 부족"] },
    { service: "현대차 점검 예약", pros: ["비어있는 시간에 예약해서 편리함"], cons: ["없습니다."] },
    { service: "제네시스 서비스", pros: ["홈투홈 픽업 서비스가 편리함"], cons: ["플랫폼 내 예약 불가하여 따로 전화로 문의해야 하는 불편함"] },
    { service: "SK 스피드메이트", pros: ["엔진오일 교환 할인"], cons: ["연회비"] },
    { service: "정비나라", pros: ["저렴하고 투명한 비용", "예약의 편리함"], cons: ["PC 기반(모바일 서비스의 부재)"] },
    { service: "기타 출장 서비스", pros: ["시간 절약 가능", "친절하고 쉬운 설명을 해주는 대면 서비스 제공"], cons: ["체계적이지 못한 과정으로 무한 기다림", "날짜와 시간 조율의 어려움"] },
  ],
});
check("행 개수(원본과 동일)", (competitor.html.match(/<tr>/g) ?? []).length - 2, 6);
check("3열 표(제품명 열 없음)", competitor.html.includes("서비스명") && !competitor.html.includes("브랜드명"), true);
check("유효 응답자 수 표기", competitor.html.includes("유효 응답자 45명"), true);
check("머리글은 회색(문항 표의 파랑이 아님)", competitor.html.includes("background-color:#f2f2f2"), true);
// 케어클처럼 제품명이 있는 raw data면 4열로 늘어난다.
const withProduct = competitorComparisonBlock({
  id: "competitor-4col",
  rows: [{ service: "메디큐브", product: "부스터 프로", pros: ["높은 브랜드 인지도"], cons: ["즉각적인 피부 개선 효과 미비"] }],
});
check("제품명이 있으면 4열", withProduct.html.includes("브랜드명") && withProduct.html.includes("제품명"), true);

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;width:660px;font-family:'맑은 고딕','Malgun Gothic',sans-serif">
${renderToStaticMarkup(<EditableJourneyLineChart block={line} />)}
${renderToStaticMarkup(<EditableWaterfallChart block={waterfall} />)}
${renderToStaticMarkup(<EditableTable block={factorTable} onChange={() => {}} />)}
${competitor.html}
</body>`;
const out = path.join(process.cwd(), "tmp", "layout-blocks.html");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`\n그림 확인용 파일: ${out}`);

console.log(`\n=== 요약: ${pass}/${pass + fail} PASS ===`);
process.exit(fail === 0 ? 0 : 1);