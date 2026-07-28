// raw data 정량 섹션 전체 계산 (PRD 5장 스키마 + 6.8절 상대중요도·NPS 공식). LLM 미사용.
import type { WallaRecord } from "@/lib/walla/normalize";
import { buildSurveyQuestionRows, type SurveyQuestionRow } from "@/lib/pipeline/surveyQuestions";
import {
  ageBracketDistribution,
  ageBracketLabel,
  AGE_BRACKETS,
  categoryDistribution,
  computeNps,
  crossTabCount,
  meanSd,
  scoreHistogram,
  normalizeRangeOptionLabel,
  rankPositionComposition,
  relativeImportance,
  type CategoryCount,
  type CrossTabRow,
  type MeanSd,
  type NpsResult,
  type RankPositionComposition,
} from "./basic";
import { computeCrossAnalysis, type CrossAnalysis } from "./crossAnalysis";

function scores(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

export interface FeatureStat extends MeanSd {
  name: string;
  /** 0~10점 구간별 응답자 수(원본 "만족도 분포도" 세로 막대그래프용). 인덱스 = 점수. */
  scoreDistribution?: number[];
}

export interface QuantStats {
  respondentCount: number;
  demographics: {
    age: MeanSd;
    ageDistribution: CategoryCount[];
    gender: CategoryCount[];
    os: CategoryCount[];
    avgWalkTime: CategoryCount[];
    walkFrequencyPerWeek: CategoryCount[];
    priorServiceExperienceRate: number; // %
    priorServiceSatisfaction: MeanSd; // 경험자 중
    genderByAgeBracket: CrossTabRow[]; // 성별×연령대 교차표
  };
  featureSatisfaction: FeatureStat[]; // Ⅲ
  relativeImportance: { name: string; score: number }[]; // Ⅳ
  rankPositionComposition: RankPositionComposition[]; // Ⅳ (Q12 순위별 응답자 구성비)
  keyFactorDistribution: CategoryCount[]; // Ⅳ
  fourValues: {
    functional: MeanSd;
    aesthetic: MeanSd;
    economic: MeanSd;
    social: MeanSd;
  }; // Ⅴ
  uxQuality: {
    usability: FeatureStat[]; // 실용성1~4
    fun: FeatureStat[]; // 즐거움1~4
  }; // Ⅵ
  overallSatisfaction: MeanSd; // Ⅷ
  nps: NpsResult; // Ⅷ
  crossAnalysis: CrossAnalysis; // Ⅶ
  // Ⅰ장 "3. 설문 항목" 표 — 실제 raw data 헤더에서 도출한 문항 목록(2026-07-23). headerRow가
  // 없으면 빈 배열(golden 테스트 등 헤더 없이 통계만 확인하는 경로).
  surveyQuestions: SurveyQuestionRow[];
}

export function computeQuantStats(records: WallaRecord[], headerRow?: unknown[]): QuantStats {
  const featureNames = records[0]?.featureSatisfaction.map((f) => f.name) ?? [];

  const featureSatisfaction: FeatureStat[] = featureNames.map((name, idx) => {
    const featureScores = scores(records.map((r) => r.featureSatisfaction[idx]?.score ?? null));
    return { name, ...meanSd(featureScores), scoreDistribution: scoreHistogram(featureScores) };
  });

  const priorServiceRespondents = records.filter((r) => r.priorService.hasExperience);

  const uxIndices = [0, 1, 2, 3] as const;

  return {
    respondentCount: records.length,
    demographics: {
      age: meanSd(scores(records.map((r) => r.age))),
      ageDistribution: ageBracketDistribution(records.map((r) => r.age)),
      gender: categoryDistribution(records.map((r) => r.gender)),
      os: categoryDistribution(records.map((r) => r.os)),
      avgWalkTime: categoryDistribution(records.map((r) => r.avgWalkTime), normalizeRangeOptionLabel),
      walkFrequencyPerWeek: categoryDistribution(
        records.map((r) => r.walkFrequencyPerWeek),
        normalizeRangeOptionLabel,
      ),
      priorServiceExperienceRate:
        records.length === 0
          ? 0
          : Math.round((priorServiceRespondents.length / records.length) * 1000) / 10,
      priorServiceSatisfaction: meanSd(
        scores(priorServiceRespondents.map((r) => r.priorService.satisfaction)),
      ),
      genderByAgeBracket: crossTabCount(
        records.map((r) => r.gender),
        records.map((r) => (r.age === null ? null : ageBracketLabel(r.age))),
        [...AGE_BRACKETS],
      ),
    },
    featureSatisfaction,
    relativeImportance: relativeImportance(
      records.map((r) => r.rank),
      featureNames,
    ),
    rankPositionComposition: rankPositionComposition(
      records.map((r) => r.rank),
      featureNames,
    ),
    keyFactorDistribution: categoryDistribution(records.map((r) => r.keyFactor.choice)),
    fourValues: {
      functional: meanSd(scores(records.map((r) => r.values.functional.score))),
      aesthetic: meanSd(scores(records.map((r) => r.values.aesthetic.score))),
      economic: meanSd(scores(records.map((r) => r.values.economic.score))),
      social: meanSd(scores(records.map((r) => r.values.social.score))),
    },
    uxQuality: {
      usability: uxIndices.map((idx) => ({
        name: records[0]?.uxQuality[idx]?.usability.name ?? `실용성${idx + 1}`,
        ...meanSd(scores(records.map((r) => r.uxQuality[idx]?.usability.score ?? null))),
      })),
      fun: uxIndices.map((idx) => ({
        name: records[0]?.uxQuality[idx]?.fun.name ?? `즐거움${idx + 1}`,
        ...meanSd(scores(records.map((r) => r.uxQuality[idx]?.fun.score ?? null))),
      })),
    },
    overallSatisfaction: meanSd(scores(records.map((r) => r.overallSatisfaction.score))),
    nps: computeNps(scores(records.map((r) => r.nps.score))),
    crossAnalysis: computeCrossAnalysis(records),
    surveyQuestions: headerRow ? buildSurveyQuestionRows(headerRow) : [],
  };
}
