// 마법사 정량 리뷰 화면에서 "사람이 다시 봐야 할 지표"를 규칙 기반으로 표시한다. LLM 재호출
// 없음(lib/pipeline/hedgeCheck.ts·confidence.ts와 같은 패턴) — 정량 계산 자체를 바꾸지 않고,
// 이미 계산된 QuantStats 위에 "왜 이 숫자가 나왔는지" 이유를 붙이기만 한다.
import type { QuantStats } from "./compute";

export interface ReviewFlag {
  sectionNumeral: "II" | "III" | "VII" | "VIII";
  targetBlockId: string;
  title?: string;
  location: string;
  message: string;
  severity: "info" | "warning";
}

const LOW_SAMPLE_THRESHOLD = 10; // 교차분석 그룹 표본이 이 미만이면 해석 주의
const PRIORITY_IMPORTANCE_THRESHOLD = 2; // 상대중요도(-5~5) 이 값 이상
const PRIORITY_SATISFACTION_THRESHOLD = 6; // 만족도(0~10) 이 값 이하

export function flagQuantStatsForReview(stats: QuantStats): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (stats.demographics.priorServiceSatisfaction.n < stats.respondentCount) {
    flags.push({
      sectionNumeral: "II",
      targetBlockId: "demo-prior-service",
      location: "인적사항 > 유사 서비스 경험자 만족도",
      message: `이 그래프는 전체 ${stats.respondentCount}명이 아니라 유사 서비스를 써본 ${stats.demographics.priorServiceSatisfaction.n}명만 보여줘요. 전체 사용자 결과처럼 보이지 않는지 확인해주세요.`,
      severity: "info",
    });
  }

  if (stats.nps.npsScore < 0) {
    flags.push({
      sectionNumeral: "VIII",
      targetBlockId: "nps-diagram",
      location: "종합만족도 및 NPS",
      message: `추천하겠다는 사람보다 추천하지 않겠다는 사람이 더 많아요. 계산 오류라는 뜻은 아니며, 어떤 불편이 이 결과를 만들었는지 다음 의견 분석에서 연결해 확인해주세요.`,
      severity: "info",
    });
  }

  const satisfactionByName = new Map(stats.featureSatisfaction.map((f) => [f.name, f.mean]));
  for (const item of stats.relativeImportance) {
    const satisfaction = satisfactionByName.get(item.name);
    if (
      satisfaction !== undefined &&
      item.score >= PRIORITY_IMPORTANCE_THRESHOLD &&
      satisfaction <= PRIORITY_SATISFACTION_THRESHOLD
    ) {
      flags.push({
        sectionNumeral: "III",
        targetBlockId: "feature-importance-satisfaction-quadrant",
        location: `기능별 상대 중요도·만족도 > ${item.name}`,
        message: `사용자가 중요하게 생각하지만 만족하지 못한 기능이에요. 보고서에서 ‘먼저 고칠 기능’으로 표시해도 되는지 확인해주세요.`,
        severity: "warning",
      });
    }
  }

  for (const group of stats.crossAnalysis.byAgeGroup) {
    if (group.n > 0 && group.n < LOW_SAMPLE_THRESHOLD) {
      flags.push({
        sectionNumeral: "VII",
        targetBlockId: "cross-feature-chart-age",
        location: `교차분석 > ${group.group}`,
        message: `이 그룹은 ${group.n}명뿐이라 한두 명의 답변이 그래프를 크게 바꿀 수 있어요. 다른 그룹보다 높거나 낮다고 단정하지 않았는지 확인해주세요.`,
        severity: "info",
      });
    }
  }
  for (const group of stats.crossAnalysis.byGender) {
    if (group.n > 0 && group.n < LOW_SAMPLE_THRESHOLD) {
      flags.push({
        sectionNumeral: "VII",
        targetBlockId: "cross-feature-chart-gender",
        location: `교차분석 > ${group.group}`,
        message: `이 그룹은 ${group.n}명뿐이라 한두 명의 답변이 그래프를 크게 바꿀 수 있어요. 다른 그룹보다 높거나 낮다고 단정하지 않았는지 확인해주세요.`,
        severity: "info",
      });
    }
  }

  const namesByMean = new Map<number, string[]>();
  for (const f of stats.featureSatisfaction) {
    const rounded = Number(f.mean.toFixed(2));
    namesByMean.set(rounded, [...(namesByMean.get(rounded) ?? []), f.name]);
  }
  for (const names of namesByMean.values()) {
    if (names.length > 1) {
      flags.push({
        sectionNumeral: "III",
        targetBlockId: "feature-satisfaction",
        location: `기능별 만족도 순위 > ${names.join(", ")}`,
        message: `두 기능의 평균 점수가 같아요. 화면에 먼저 나온 기능이 더 좋은 기능은 아니므로 같은 순위로 이해해주세요.`,
        severity: "info",
      });
    }
  }

  return flags;
}
