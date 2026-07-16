// 정성 처리 대상 14개 문항을 raw data 레코드에서 추출한다 (PRD 6.1절).
// 기능 6개 + 4대가치 4개 + 유사서비스만족도 1 + 전반적만족도 1 + NPS 1 + 개선아이디어 1 = 14.
import type { WallaRecord } from "@/lib/walla/normalize";
import type { Stage1Input } from "./stage1";

export interface StandardQuestionSpec {
  id: string;
  label: string;
  kind: "standard";
  inputs: Stage1Input[];
}

export interface ImprovementQuestionSpec {
  id: string;
  label: string;
  kind: "improvement";
  inputs: { respondent_id: number; reason: string }[];
}

export type QuestionSpec = StandardQuestionSpec | ImprovementQuestionSpec;

function standardQuestion(
  id: string,
  label: string,
  entries: { respondentId: number; score: number | null; reason: string | null }[],
): StandardQuestionSpec {
  return {
    id,
    label,
    kind: "standard",
    inputs: entries
      .filter((e): e is { respondentId: number; score: number; reason: string | null } => e.score !== null)
      .map((e) => ({
        respondent_id: e.respondentId,
        score: e.score,
        reason: e.reason ?? "",
      })),
  };
}

export function buildQuestionSpecs(records: WallaRecord[]): QuestionSpec[] {
  const featureCount = records[0]?.featureSatisfaction.length ?? 0;

  const featureQuestions: StandardQuestionSpec[] = Array.from({ length: featureCount }, (_, i) => {
    const name = records[0]?.featureSatisfaction[i]?.name ?? `기능${i + 1}`;
    return standardQuestion(
      `feature:${name}`,
      `'${name}' 기능 만족도`,
      records.map((r) => ({
        respondentId: r.respondentId,
        score: r.featureSatisfaction[i]?.score ?? null,
        reason: r.featureSatisfaction[i]?.reason ?? null,
      })),
    );
  });

  const valueSpecs: [string, string, (r: WallaRecord) => { score: number | null; reason: string | null }][] = [
    ["values:functional", "기능적 가치 만족도", (r) => r.values.functional],
    ["values:aesthetic", "심미적 가치 만족도", (r) => r.values.aesthetic],
    ["values:economic", "경제적 가치 만족도", (r) => r.values.economic],
    ["values:social", "사회·공공적 이슈 가치 만족도", (r) => r.values.social],
  ];
  const valueQuestions: StandardQuestionSpec[] = valueSpecs.map(([id, label, pick]) =>
    standardQuestion(
      id,
      label,
      records.map((r) => {
        const sr = pick(r);
        return { respondentId: r.respondentId, score: sr.score, reason: sr.reason };
      }),
    ),
  );

  const priorServiceQuestion = standardQuestion(
    "priorService",
    "유사(경쟁) 걷기 서비스 만족도",
    records
      .filter((r) => r.priorService.hasExperience)
      .map((r) => ({
        respondentId: r.respondentId,
        score: r.priorService.satisfaction,
        reason: r.priorService.reason,
      })),
  );

  const overallQuestion = standardQuestion(
    "overallSatisfaction",
    "전반적인 만족도",
    records.map((r) => ({
      respondentId: r.respondentId,
      score: r.overallSatisfaction.score,
      reason: r.overallSatisfaction.reason,
    })),
  );

  const npsQuestion = standardQuestion(
    "nps",
    "NPS",
    records.map((r) => ({
      respondentId: r.respondentId,
      score: r.nps.score,
      reason: r.nps.reason,
    })),
  );

  const improvementQuestion: ImprovementQuestionSpec = {
    id: "improvementIdea",
    label: "개선 아이디어 제안",
    kind: "improvement",
    inputs: records
      .filter((r) => r.improvementIdea !== null)
      .map((r) => ({ respondent_id: r.respondentId, reason: r.improvementIdea as string })),
  };

  return [
    ...featureQuestions,
    ...valueQuestions,
    priorServiceQuestion,
    overallQuestion,
    npsQuestion,
    improvementQuestion,
  ];
}
