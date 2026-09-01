// 정량 도표의 계산 근거(`quantEvidenceFor`)가 블록마다 맞는 설명을 내는가.
// `npm run check:quant-evidence`. **LLM·DB 없음, 무료.**
//
// 이 로직은 마법사 정량 검토 화면에 있다가 웹뷰 왼쪽 근거 패널로 옮겨왔다(2026-08-31).
// 옮기면서 문구를 바꾸지 않는 것이 조건이었으므로, 블록 종류별로 **다른 설명이 나오는지**와
// **응답자 수가 실제 값으로 채워지는지**를 고정한다. 화면 없이 순수 함수로 확인된다.
import { quantEvidenceFor } from "../components/report-web-document/quantEvidence";
import type { ReportBlock } from "../lib/report/sections";
import type { QuantStats } from "../lib/quant/compute";

const stats = { respondentCount: 100, nps: { n: 97 } } as unknown as QuantStats;

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass += 1;
    console.log(`PASS ${label}`);
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}\n  기대: ${JSON.stringify(expected)}\n  실제: ${JSON.stringify(actual)}`);
}

const block = (partial: Partial<ReportBlock> & { id: string; kind: ReportBlock["kind"] }) => partial as ReportBlock;
const bulletOf = (reference: ReturnType<typeof quantEvidenceFor>, label: string) =>
  reference?.bullets.find((bullet) => bullet.startsWith(`${label}: `))?.slice(label.length + 2);

// ── 도표가 아닌 블록은 근거를 만들지 않는다 ────────────────────────────────────
check("서술 블록은 대상 아님", quantEvidenceFor(block({ id: "feature-analysis-summary", kind: "rich-static" }), stats), null);
check("제목 없는 차트는 대상 아님", quantEvidenceFor(block({ id: "x", kind: "chart" }), stats), null);
check("통계가 없으면 만들지 않음", quantEvidenceFor(block({ id: "c", kind: "chart", title: "T" } as never), null), null);

// ── 블록 종류마다 다른 설명 ────────────────────────────────────────────────────
const quadrant = quantEvidenceFor(block({ id: "feature-importance-satisfaction-quadrant", kind: "quadrant", title: "중요도-만족도" } as never), stats);
check("사분면 제목", quadrant?.title, "중요도-만족도");
check("사분면 종류 표시", quadrant?.kind, "정량 계산");
check("사분면 계산 방식", bulletOf(quadrant, "계산 방식"), "가로축은 평균 순위를 -5~+5의 상대 중요도로 변환하고, 세로축은 기능별 만족도 평균을 사용");
check("사분면 포함 응답에 실제 인원", bulletOf(quadrant, "포함된 응답"), "전체 응답 100명 중 각 문항에 값이 있는 응답");

// NPS 표는 도표가 아니라 계산 표인데 **대상에 포함된다** — 실제 계산 결과가 여기 들어 있다.
const nps = quantEvidenceFor(block({ id: "nps-reference-and-summary", kind: "rich-static" }), stats);
check("NPS 표 제목", nps?.title, "NPS 지수 계산 결과");
check("NPS 포함 응답", bulletOf(nps, "포함된 응답"), "97명");

// 교차분석 그룹 막대는 같은 종류인데 **id로 연령/성별을 가른다**.
const byAge = quantEvidenceFor(block({ id: "cross-feature-chart-age", kind: "grouped-bar", title: "연령대별" } as never), stats);
const byGender = quantEvidenceFor(block({ id: "cross-feature-chart-gender", kind: "grouped-bar", title: "성별" } as never), stats);
check("연령 그룹 데이터 출처", bulletOf(byAge, "사용한 데이터"), "원본의 연령과 항목별 점수 응답");
check("성별 그룹 데이터 출처", bulletOf(byGender, "사용한 데이터"), "원본의 성별과 항목별 점수 응답");

// 기능 차트는 n 이 항목마다 다르다는 사실을 밝힌다(다른 차트와 문구가 달라야 한다).
const feature = quantEvidenceFor(block({ id: "feature-satisfaction", kind: "chart", title: "기능별 만족도 조사 결과" } as never), stats);
check("기능 차트 검증 안내", bulletOf(feature, "검증할 부분"), "기능 이름과 만족도 점수 열이 서로 바뀌지 않고 연결됐는지 확인이 필요합니다.");
check("기능 차트 포함 응답", bulletOf(feature, "포함된 응답"), "기능별 유효 응답 수(n)는 각각 다를 수 있음");

// 비율(%) 차트는 평균이 아니라 비율로 계산한다고 밝혀야 한다.
const percent = quantEvidenceFor(block({ id: "demo-gender", kind: "chart", title: "성별 분포", unit: "%" } as never), stats);
check("비율 차트 계산 방식", bulletOf(percent, "계산 방식"), "같은 답변의 수를 전체 유효 응답 수로 나누어 비율로 계산");

// 여섯 줄이 모두 `항목: 내용` 형태여야 패널이 항목명을 굵게 뽑아낼 수 있다.
check("항목 여섯 줄", feature?.bullets.length, 6);
check("전부 라벨 형식", feature?.bullets.every((bullet) => /^[^:]+: .+/.test(bullet)), true);

console.log(`\n=== 요약: ${pass}/${pass + fail} PASS ===`);
process.exit(fail === 0 ? 0 : 1);