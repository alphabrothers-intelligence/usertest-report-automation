/**
 * 정량 도표의 **근거 설명**. `QuantReviewStep`(마법사 정량 검토 화면, 2026-08-31 폐지)에 있던
 * `graphGuide`·`calculationEvidence`를 웹뷰로 옮긴 것이다.
 *
 * **문서 안에 안내 박스를 새로 넣지 않는다.** 웹뷰는 A4 문서라 차트마다 설명 상자를 얹으면
 * 문서가 문서가 아니게 된다. 대신 **이미 있는 왼쪽 `분석 근거` 패널**에 태운다 — 그 패널은
 * 지금까지 해석·제언 블록에서만 채워졌고 정량 도표에서는 "표·그래프 자체를 확인하는
 * 구간입니다" 한 줄로 비어 있었다. 스크롤해서 그 도표를 보는 순간 패널이 이 내용으로 바뀐다.
 *
 * 문구는 옮기면서 바꾸지 않았다 — 담당자가 읽고 확인한 문장 그대로다.
 */
import type { AnalysisReference } from "@/components/report-web-document/analysisEvidence";
import type { ReportBlock } from "@/lib/report/sections";
import type { QuantStats } from "@/lib/quant/compute";

/** "nps"(원본 척도 안내 이미지)는 우리가 계산한 값이 아니라 고정 참고 자산이라 뺀다 — 대신
 * 실제 계산 결과가 들어 있는 `nps-reference-and-summary`(계산 표)를 특별 취급한다. */
const VISUAL_BLOCK_KINDS = new Set<ReportBlock["kind"]>([
  "chart", "rank-composition", "stacked-bar", "grouped-bar", "radar", "quadrant", "polarity",
]);
const NPS_TABLE_BLOCK_ID = "nps-reference-and-summary";

function chartTitle(block: ReportBlock): string | null {
  if (block.id === NPS_TABLE_BLOCK_ID) return "NPS 지수 계산 결과";
  if (VISUAL_BLOCK_KINDS.has(block.kind) && "title" in block) return block.title ?? null;
  return null;
}

function graphGuide(block: ReportBlock) {
  if (block.id === NPS_TABLE_BLOCK_ID) {
    return { description: "추천·중립·비추천 응답 비율과 NPS 계산 결과를 보여주는 표예요.", check: "추천자보다 비추천자가 많은지 확인하면, 낮은 NPS의 원인을 사용자 의견에서 더 찾아야 하는지 판단할 수 있어요." };
  }
  switch (block.kind) {
    case "rank-composition":
      return { description: "응답자가 각 항목을 몇 순위로 골랐는지 보여주는 그래프예요.", check: "순위별 비율과 가장 많이 선택된 항목이 원본 응답과 맞는지 봐주세요." };
    case "stacked-bar":
      return { description: "응답 집단 안에서 각 답변이 얼마나 차지하는지 보여주는 그래프예요.", check: "각 막대의 합계와 가장 큰 응답 구간이 예상과 맞는지 봐주세요." };
    case "grouped-bar":
      return { description: "연령이나 성별처럼 여러 집단의 점수를 나란히 비교하는 그래프예요.", check: "그룹별 응답자 수가 충분한지 확인해야 ‘어느 그룹이 더 만족한다’고 보고서에 쓸 수 있어요." };
    case "radar":
      return { description: "여러 사용 경험 항목의 강점과 약점을 한 번에 비교하는 그래프예요.", check: "유난히 높거나 낮은 항목이 실제 응답 흐름과 맞는지 봐주세요." };
    case "quadrant":
      return { description: "중요도와 만족도를 함께 놓고 먼저 개선할 기능을 찾는 그래프예요.", check: "‘중요하지만 만족도가 낮은’ 기능은 최우선 개선 과제로 제안되므로, 실제로 먼저 개선할 대상이 맞는지 확인해주세요." };
    case "polarity":
      return { description: "사용자 의견이 긍정·부정·중립 중 어디에 많이 모였는지 보여주는 그래프예요.", check: "분류 비율과 대표 의견의 분위기가 서로 어긋나지 않는지 봐주세요." };
    default:
      return { description: "항목별 결과의 크기와 순서를 비교하는 그래프예요.", check: "가장 높은 기능과 가장 낮은 기능은 보고서의 강점·개선점으로 이어져요. 원본 응답에서 예상한 결과와 크게 다르지 않은지 확인해주세요." };
  }
}

function calculationEvidence(block: ReportBlock, stats: QuantStats) {
  if (block.id === NPS_TABLE_BLOCK_ID) return {
    source: "원본의 0~10점 추천 의향 응답",
    calculation: "9~10점은 추천자, 7~8점은 중립자, 0~6점은 비추천자로 나눈 뒤 ‘추천자 비율 − 비추천자 비율’로 계산",
    included: `${stats.nps.n}명`,
    verify: "추천 의향 문항이 맞게 연결됐는지와 0~10점 척도인지 확인이 필요합니다.",
  };
  if (block.kind === "quadrant") return {
    source: "기능 중요도 순위 응답과 기능별 0~10점 만족도 응답",
    calculation: "가로축은 평균 순위를 -5~+5의 상대 중요도로 변환하고, 세로축은 기능별 만족도 평균을 사용",
    included: `전체 응답 ${stats.respondentCount}명 중 각 문항에 값이 있는 응답`,
    verify: "순위 문항과 만족도 문항의 기능 이름이 서로 정확히 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "rank-composition") return {
    source: "원본의 기능 중요도 순위 응답",
    calculation: "각 순위에서 기능이 선택된 횟수를 해당 순위의 전체 응답 수로 나누어 비율로 계산",
    included: `최대 ${stats.respondentCount}명`,
    verify: "원본의 1위·2위·3위 열이 올바른 순서로 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "grouped-bar") return {
    source: block.id.includes("age") ? "원본의 연령과 항목별 점수 응답" : "원본의 성별과 항목별 점수 응답",
    calculation: "응답자를 그룹으로 나눈 뒤 그룹별 항목 평균을 계산",
    included: `전체 ${stats.respondentCount}명 중 그룹 정보와 점수가 모두 있는 응답`,
    verify: "그룹을 나누는 기준 열과 점수 문항이 맞게 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "stacked-bar") return {
    source: "원본의 성별과 연령 응답",
    calculation: "성별로 응답자를 나누고 각 연령대에 해당하는 인원을 합산",
    included: `전체 ${stats.respondentCount}명 중 성별과 연령이 모두 있는 응답`,
    verify: "비어 있는 성별·연령 값이 제외되는 것이 맞는지 확인이 필요합니다.",
  };
  if (block.kind === "radar") return {
    source: "원본의 사용자 경험 품질 항목별 점수",
    calculation: "각 항목의 유효 점수를 더한 뒤 응답자 수로 나눈 평균",
    included: `최대 ${stats.respondentCount}명`,
    verify: "그래프 축의 항목 이름과 원본 점수 문항이 같은 순서로 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "polarity") return {
    source: "승인된 서술형 응답의 긍정·부정·중립 분류",
    calculation: "각 분류의 응답 수를 전체 분류 응답 수로 나누어 비율로 계산",
    included: "분류가 완료된 유효 서술형 응답",
    verify: "분류 결과가 실제 응답의 분위기와 맞는지 확인이 필요합니다.",
  };
  const isFeature = block.id.startsWith("feature-");
  return {
    source: isFeature ? "원본의 기능별 0~10점 만족도 응답" : `원본에서 ‘${chartTitle(block) ?? "이 항목"}’에 연결된 응답`,
    calculation: block.kind === "chart" && block.unit === "%"
      ? "같은 답변의 수를 전체 유효 응답 수로 나누어 비율로 계산"
      : "항목별 유효 점수를 더한 뒤 해당 항목의 응답자 수로 나눈 평균",
    included: isFeature ? "기능별 유효 응답 수(n)는 각각 다를 수 있음" : `최대 ${stats.respondentCount}명`,
    verify: isFeature
      ? "기능 이름과 만족도 점수 열이 서로 바뀌지 않고 연결됐는지 확인이 필요합니다."
      : "원본 문항과 그래프 항목이 올바르게 연결됐는지 확인이 필요합니다.",
  };
}

/** 정량 도표면 근거를, 아니면 null. `ANALYSIS_EVIDENCE_BY_BLOCK`에 없는 블록의 폴백이다. */
export function quantEvidenceFor(block: ReportBlock | null, stats: QuantStats | null | undefined): AnalysisReference | null {
  if (!block || !stats) return null;
  const title = chartTitle(block);
  if (!title) return null;
  const guide = graphGuide(block);
  const evidence = calculationEvidence(block, stats);
  return {
    title,
    kind: "정량 계산",
    // 앞의 둘은 "무엇을 보는 그래프인가", 뒤의 넷은 "그 숫자가 어디서 나왔는가"다.
    bullets: [
      `무엇을 보여주나: ${guide.description}`,
      `확인할 내용: ${guide.check}`,
      `사용한 데이터: ${evidence.source}`,
      `계산 방식: ${evidence.calculation}`,
      `포함된 응답: ${evidence.included}`,
      `검증할 부분: ${evidence.verify}`,
    ],
  };
}