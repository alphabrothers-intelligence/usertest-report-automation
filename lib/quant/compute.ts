// raw data 정량 섹션 전체 계산 (PRD 5장 스키마 + 6.8절 상대중요도·NPS 공식). LLM 미사용.
import type { WallaRecord } from "@/lib/walla/normalize";
import {
  ageBracketDistribution,
  categoryDistribution,
  computeNps,
  meanSd,
  relativeImportance,
  type CategoryCount,
  type MeanSd,
  type NpsResult,
} from "./basic";
import { computeCrossAnalysis, type CrossAnalysis } from "./crossAnalysis";

function scores(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

export interface FeatureStat extends MeanSd {
  name: string;
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
  };
  featureSatisfaction: FeatureStat[]; // Ⅲ
  relativeImportance: { name: string; score: number }[]; // Ⅳ
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
}

export function computeQuantStats(records: WallaRecord[]): QuantStats {
  const featureNames = records[0]?.featureSatisfaction.map((f) => f.name) ?? [];

  const featureSatisfaction: FeatureStat[] = featureNames.map((name, idx) => ({
    name,
    ...meanSd(scores(records.map((r) => r.featureSatisfaction[idx]?.score ?? null))),
  }));

  const priorServiceRespondents = records.filter((r) => r.priorService.hasExperience);

  const uxLabels = ["1", "2", "3", "4"];

  return {
    respondentCount: records.length,
    demographics: {
      age: meanSd(scores(records.map((r) => r.age))),
      ageDistribution: ageBracketDistribution(records.map((r) => r.age)),
      gender: categoryDistribution(records.map((r) => r.gender)),
      os: categoryDistribution(records.map((r) => r.os)),
      avgWalkTime: categoryDistribution(records.map((r) => r.avgWalkTime)),
      walkFrequencyPerWeek: categoryDistribution(records.map((r) => r.walkFrequencyPerWeek)),
      priorServiceExperienceRate:
        records.length === 0
          ? 0
          : Math.round((priorServiceRespondents.length / records.length) * 1000) / 10,
      priorServiceSatisfaction: meanSd(
        scores(priorServiceRespondents.map((r) => r.priorService.satisfaction)),
      ),
    },
    featureSatisfaction,
    relativeImportance: relativeImportance(
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
      usability: uxLabels.map((label, idx) => ({
        name: `실용성${label}`,
        ...meanSd(scores(records.map((r) => r.uxQuality[idx]?.usability.score ?? null))),
      })),
      fun: uxLabels.map((label, idx) => ({
        name: `즐거움${label}`,
        ...meanSd(scores(records.map((r) => r.uxQuality[idx]?.fun.score ?? null))),
      })),
    },
    overallSatisfaction: meanSd(scores(records.map((r) => r.overallSatisfaction.score))),
    nps: computeNps(scores(records.map((r) => r.nps.score))),
    crossAnalysis: computeCrossAnalysis(records),
  };
}
