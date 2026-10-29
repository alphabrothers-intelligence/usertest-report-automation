import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories } from "@/lib/db/reports";

/**
 * 정성 문항은 DB 생성 시각이 아닌 설문지의 논리적 문항 순서로 정렬한다.
 *
 * 같은 원자료를 재분석하거나 일부 문항만 다시 생성하면 `created_at` 순서가 바뀔 수 있다.
 * 그러면 Q6~Q12 기능 결과가 뒤섞여 보이는 문제가 생기므로, 통계 모델의 기능 순서와
 * 설문 스키마의 문항 순서를 기준으로 한 번 정렬한 뒤 모든 섹션에서 재사용한다.
 */
function qualitativeQuestionOrder(stats: QuantStats, question: QuestionWithApprovedCategories): number {
  if (question.question_key.startsWith("feature:")) {
    const featureName = question.question_key.slice("feature:".length);
    const featureIndex = stats.featureSatisfaction.findIndex((feature) => feature.name === featureName);
    return 600 + (featureIndex >= 0 ? featureIndex : 99);
  }

  const fixedOrder: Record<string, number> = {
    // 기능 만족도/중요도(Q6~Q12) 다음의 유사 서비스 경험 문항
    priorService: 1500,
    // 핵심구매요소(Q13~) 뒤에 이어지는 4대 가치 문항
    "values:functional": 2300,
    "values:aesthetic": 2400,
    "values:economic": 2500,
    "values:social": 2600,
    // 보고서 말미의 종합 만족도·추천 의향·개선 아이디어
    overallSatisfaction: 3500,
    nps: 3600,
    improvementIdea: 3700,
  };
  return fixedOrder[question.question_key] ?? Number.MAX_SAFE_INTEGER;
}

export function orderQualitativeQuestions(stats: QuantStats, qual: QuestionWithApprovedCategories[]) {
  return [...qual].sort((left, right) => {
    const orderDifference = qualitativeQuestionOrder(stats, left) - qualitativeQuestionOrder(stats, right);
    if (orderDifference !== 0) return orderDifference;
    return left.question_key.localeCompare(right.question_key, "ko");
  });
}

export function questionsByKeyPrefix(qual: QuestionWithApprovedCategories[], prefix: string) {
  return qual.filter((q) => q.question_key.startsWith(prefix));
}
export function questionsByKeys(qual: QuestionWithApprovedCategories[], keys: string[]) {
  const questionByKey = new Map(qual.map((question) => [question.question_key, question]));
  // `filter`는 DB 저장 순서를 보존한다. 요청한 키 순서로 명시적으로 꺼내야 Q 번호가 고정된다.
  return keys.flatMap((key) => {
    const question = questionByKey.get(key);
    return question ? [question] : [];
  });
}

