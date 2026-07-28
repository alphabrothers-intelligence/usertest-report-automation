import { z } from "zod";

const Distribution = z.object({ label: z.string(), percentage: z.number(), count: z.number().optional() });
const MeanSd = z.object({ mean: z.number(), sd: z.number() });

/** Claude 정량 분석 → 원본 재현 렌더러 사이의 고정 계약.
 * 수치가 아닌 서술·제언은 포함하지 않아 정성 분석 호출과 분리한다. */
export const ClaudeQuantReportSchema = z.object({
  quantStats: z.object({
    respondentCount: z.number(),
    demographics: z.object({
      ageDistribution: z.array(Distribution),
      gender: z.array(Distribution),
      os: z.array(Distribution),
      avgWalkTime: z.array(Distribution),
      walkFrequencyPerWeek: z.array(Distribution),
      genderByAgeBracket: z.array(z.object({ label: z.string(), segments: z.array(z.object({ name: z.string(), count: z.number() })) })),
    }),
    featureSatisfaction: z.array(z.object({ name: z.string(), mean: z.number(), sd: z.number() })),
    relativeImportance: z.array(z.object({ name: z.string(), score: z.number() })),
    keyFactorDistribution: z.array(Distribution),
    fourValues: z.object({ functional: MeanSd, aesthetic: MeanSd, economic: MeanSd, social: MeanSd }),
    overallSatisfaction: MeanSd,
    nps: z.object({ npsScore: z.number(), promoterPct: z.number(), passivePct: z.number(), detractorPct: z.number() }),
  }),
  // 0~10점 순서의 응답자 수. 기능별 만족도 분포 그래프의 y축은 이 값을 사용한다.
  featureScoreDistributions: z.array(z.array(z.number()).length(11)),
});

export type ClaudeQuantReport = z.infer<typeof ClaudeQuantReportSchema>;
