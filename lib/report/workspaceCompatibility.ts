import type { QuantStats } from "@/lib/quant/compute";

/**
 * DB에 저장된 `quant_stats`는 그 report가 저장된 시점의 `computeQuantStats` 버전이 계산한
 * JSON 스냅샷이다 — 이후 `QuantStats`에 필드가 추가돼도 과거 report의 저장값은 소급 갱신되지
 * 않는다. 실측 확인(2026-07-25): 2026-07-20에 저장된 실제 report 하나로 이 라우트를 테스트해
 * 보니 `surveyQuestions`·`rankPositionComposition`·`demographics.genderByAgeBracket`
 * 세 필드가 빠져 있어 그대로 읽으면 크래시가 났다(각각 07-21·07-23에 추가된 필드). PDF
 * 렌더러는 이런 오래된 report를 다시 열 일이 없어 이 문제를 안 겪었지만, 웹 작업공간은
 * "언제 생성됐든 아무 report나 다시 열 수 있어야" 하므로 이 경계에서 한 번 정규화한다
 * (개별 섹션 빌더마다 `?? []`를 흩뿌리지 않고 진입점 하나에서 방어한다).
 */
export function normalizeQuantStats(stats: QuantStats): QuantStats {
  return {
    ...stats,
    surveyQuestions: stats.surveyQuestions ?? [],
    rankPositionComposition: stats.rankPositionComposition ?? [],
    demographics: {
      ...stats.demographics,
      genderByAgeBracket: stats.demographics.genderByAgeBracket ?? [],
    },
    // 2026-09-09: valueAxes가 생기기 전(~2026-09-04)에 저장된 보고서는 이 필드가 없어서 Ⅶ장
    // 교차 분석이 `undefined.map`으로 터졌다 — 웹뷰가 500으로 아예 열리지 않았다(리바랩스
    // 9/4 보고서 실측). 새 필드를 QuantStats에 더할 때는 옛 저장본을 여기서 같이 메울 것.
    crossAnalysis: {
      byAgeGroup: (stats.crossAnalysis?.byAgeGroup ?? []).map((group) => ({ ...group, valueAxes: group.valueAxes ?? [] })),
      byGender: (stats.crossAnalysis?.byGender ?? []).map((group) => ({ ...group, valueAxes: group.valueAxes ?? [] })),
    },
  };
}

