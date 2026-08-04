// 마법사 정량 리뷰 화면에서 "사람이 다시 봐야 할 지표"를 규칙 기반으로 표시한다. LLM 재호출
// 없음(lib/pipeline/hedgeCheck.ts·confidence.ts와 같은 패턴) — 정량 계산 자체를 바꾸지 않고,
// 이미 계산된 QuantStats 위에 "왜 이 숫자가 나왔는지" 이유를 붙이기만 한다.
import type { QuantStats } from "./compute";

export interface ReviewFlag {
  location: string;
  message: string;
  severity: "info" | "warning";
}

const HIGH_SD_THRESHOLD = 2.5; // 0~10점 척도 기준 — 이 이상이면 응답이 크게 갈렸다고 봄
const LOW_SAMPLE_THRESHOLD = 10; // 교차분석 그룹 표본이 이 미만이면 해석 주의
const PRIORITY_IMPORTANCE_THRESHOLD = 2; // 상대중요도(-5~5) 이 값 이상
const PRIORITY_SATISFACTION_THRESHOLD = 6; // 만족도(0~10) 이 값 이하

export function flagQuantStatsForReview(stats: QuantStats): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  for (const f of stats.featureSatisfaction) {
    if (f.sd >= HIGH_SD_THRESHOLD) {
      flags.push({
        location: `기능별 만족도 > ${f.name}`,
        message: `표준편차 ${f.sd.toFixed(2)} — 평균만 보면 오해할 수 있어요. 응답이 양극화됐을 가능성이 있으니 긍정/부정 비율을 같이 확인하세요.`,
        severity: "warning",
      });
    }
  }

  if (stats.demographics.priorServiceSatisfaction.n < stats.respondentCount) {
    flags.push({
      location: "인적사항 > 유사 서비스 경험자 만족도",
      message: `이 값은 전체 응답자 ${stats.respondentCount}명이 아니라, 경험이 있다고 답한 ${stats.demographics.priorServiceSatisfaction.n}명만의 평균이에요.`,
      severity: "info",
    });
  }

  if (stats.nps.npsScore < 0) {
    flags.push({
      location: "종합만족도 및 NPS",
      message: `NPS 지수가 음수(${stats.nps.npsScore})예요. 초기 기업에서는 흔한 수치라 오류는 아니지만, 이 숫자가 왜 나왔는지 맥락을 같이 챙겨보세요.`,
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
        location: `핵심구매요소 > ${item.name}`,
        message: `중요도는 높은데(${item.score.toFixed(2)}) 만족도는 낮아요(${satisfaction.toFixed(2)}) — 최우선 개선 후보로 눈여겨보세요.`,
        severity: "warning",
      });
    }
  }

  for (const group of [...stats.crossAnalysis.byAgeGroup, ...stats.crossAnalysis.byGender]) {
    if (group.n > 0 && group.n < LOW_SAMPLE_THRESHOLD) {
      flags.push({
        location: `교차분석 > ${group.group}`,
        message: `이 그룹의 표본이 ${group.n}명으로 적어요 — 그룹 간 차이를 해석할 때 주의하세요.`,
        severity: "info",
      });
    }
  }

  const namesByMean = new Map<number, string[]>();
  for (const f of stats.featureSatisfaction) {
    const rounded = Number(f.mean.toFixed(2));
    namesByMean.set(rounded, [...(namesByMean.get(rounded) ?? []), f.name]);
  }
  for (const [mean, names] of namesByMean) {
    if (names.length > 1) {
      flags.push({
        location: `기능별 만족도 순위 > ${names.join(", ")}`,
        message: `만족도가 ${mean.toFixed(2)}로 동점이에요 — 표에 나온 순서는 임의로 정해진 것이라 실제 우선순위 차이는 없다고 보세요.`,
        severity: "info",
      });
    }
  }

  return flags;
}
