// 14개 문항 × Stage1/Stage2 병렬 처리 오케스트레이터 (PRD 4.2절 — 필수 요구사항).
// 절대 순차 처리하지 않는다: 문항 간 Stage1은 서로 독립적으로 동시 실행하고, 각 문항의
// Stage1이 끝나면 그 문항의 극성별 Stage2도 문항 간 동시 실행한다. 동시성은 p-limit으로
// 5~10개로 제한한다(Claude API 레이트리밋 고려, 10장).
import pLimit from "p-limit";
import type { QuestionSpec } from "./questions";
import { runStage1, runStage1ImprovementIdea, type Polarity } from "./stage1";
import {
  runStage2,
  runStage2ImprovementIdea,
  type Stage2ClauseInput,
  type Stage2Output,
  type Stage2ImprovementOutput,
} from "./stage2";
import { scoreConfidence, type ConfidenceLevel } from "./confidence";

const DEFAULT_CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 8);

export interface FlaggedClause {
  respondent_id: number;
  clause: string;
  polarity: Polarity;
  rationale: string;
  confidence: ConfidenceLevel;
}

export interface StandardQuestionResult {
  id: string;
  label: string;
  kind: "standard";
  clauses: FlaggedClause[];
  stage2ByPolarity: Partial<Record<Polarity, Stage2Output>>;
}

export interface ImprovementQuestionResult {
  id: string;
  label: string;
  kind: "improvement";
  stage2: Stage2ImprovementOutput;
}

export type QuestionResult = StandardQuestionResult | ImprovementQuestionResult;

export interface PipelineResult {
  questions: QuestionResult[];
  elapsedMs: number;
}

function groupByPolarity(clauses: FlaggedClause[]): Partial<Record<Polarity, Stage2ClauseInput[]>> {
  const groups: Partial<Record<Polarity, Stage2ClauseInput[]>> = {};
  for (const c of clauses) {
    const arr = groups[c.polarity] ?? (groups[c.polarity] = []);
    arr.push({ respondent_id: c.respondent_id, clause: c.clause });
  }
  return groups;
}

export async function runQualitativePipeline(
  specs: QuestionSpec[],
  { concurrency = DEFAULT_CONCURRENCY }: { concurrency?: number } = {},
): Promise<PipelineResult> {
  const start = Date.now();
  // Stage2 호출을 Stage1과 같은 limit 인스턴스 안에서 큐잉하면, limit이 Stage1 작업으로
  // 꽉 찬 상태에서 그 안의 Stage2 호출이 슬롯을 얻지 못해 교착 상태에 빠질 수 있다
  // (p-limit 공식 문서의 "중첩 사용 금지" 경고). 두 단계는 별도 limiter를 쓴다.
  const stage1Limit = pLimit(concurrency);
  const stage2Limit = pLimit(concurrency);

  // 1단계: 문항별 Stage1을 전부 동시에 큐잉한다 (문항 간 완전 독립).
  const stage1Jobs = specs.map((spec) =>
    stage1Limit(async (): Promise<QuestionResult> => {
      if (spec.kind === "improvement") {
        const stage1 = await runStage1ImprovementIdea({
          questionLabel: spec.label,
          inputs: spec.inputs,
        });
        const clauses: Stage2ClauseInput[] = stage1.results.flatMap((r) =>
          r.clauses.map((c) => ({ respondent_id: r.respondent_id, clause: c.clause })),
        );
        const stage2 = await runStage2ImprovementIdea({
          questionLabel: spec.label,
          clauses,
        });
        return { id: spec.id, label: spec.label, kind: "improvement", stage2 };
      }

      const stage1 = await runStage1({ questionLabel: spec.label, inputs: spec.inputs });
      const clauses: FlaggedClause[] = stage1.results.flatMap((r) =>
        r.clauses.map((c) => ({
          respondent_id: r.respondent_id,
          clause: c.clause,
          polarity: c.polarity,
          rationale: c.rationale,
          confidence: scoreConfidence(c),
        })),
      );

      // 2단계: 이 문항의 극성별 Stage2를 동시 실행한다 (문항 간에도 같은 limit을 공유).
      const grouped = groupByPolarity(clauses);
      const polarities = Object.keys(grouped) as Polarity[];
      const stage2Entries = await Promise.all(
        polarities.map((polarity) =>
          stage2Limit(async () => {
            const polarityClauses = grouped[polarity];
            if (!polarityClauses || polarityClauses.length === 0) return null;
            const result = await runStage2({
              questionLabel: spec.label,
              polarity,
              clauses: polarityClauses,
            });
            return [polarity, result] as const;
          }),
        ),
      );

      const stage2ByPolarity: Partial<Record<Polarity, Stage2Output>> = {};
      for (const entry of stage2Entries) {
        if (entry) stage2ByPolarity[entry[0]] = entry[1];
      }

      return { id: spec.id, label: spec.label, kind: "standard", clauses, stage2ByPolarity };
    }),
  );

  const questions = await Promise.all(stage1Jobs);

  return { questions, elapsedMs: Date.now() - start };
}
