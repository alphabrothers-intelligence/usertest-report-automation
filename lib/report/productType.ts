import type { QuantStats } from "@/lib/quant/compute";

/**
 * 보고서 제품형. 원본 두 보고서가 종합 제언·요약의 형식과 논리 축을 다르게 쓰는 근거다
 * (2026-07-29 원본 대조로 확정):
 * - "sw"  : 리바랩스류(소프트웨어/앱). 개선 = 기능 개발 우선순위(중요도×만족도 사분면).
 *           기능 문항에 긍정/부정/중립 "응답 요약" 박스가 있고, 4대 가치 조사 결과 요약은
 *           존댓말(~습니다) 한 단락이다.
 * - "physical" : 케어클류(실물 기기). 개선 = 구매전환율·재구매율 전략(고객 여정 변곡 + NPS).
 *           기능 문항에 응답 요약 박스가 없고(카테고리 상세로 바로), 4대 가치 조사 결과 요약은
 *           개조식 명사형 불릿이다.
 */
export type ProductType = "sw" | "physical";

/**
 * 실제품형은 "고객 여정 기반 경험 평가"(박스 개봉 → 첫 사용 → N주 시계열) 데이터를 갖는다.
 * 현재 프로덕션 WALLA 스키마/QuantStats에는 이 필드가 없어 항상 "sw"로 판정된다 — 실제품형
 * 지원을 붙이면 computeQuantStats가 customerJourney를 채우고 그 유무로 자동 분기한다.
 */
export function detectProductType(stats: QuantStats): ProductType {
  const journey = (stats as { customerJourney?: unknown }).customerJourney;
  return journey && Array.isArray(journey) && journey.length > 0 ? "physical" : "sw";
}
