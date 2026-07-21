// 14개 문항 × Stage1/Stage2 병렬 처리 오케스트레이터 (PRD 4.2절 — 필수 요구사항).
// 절대 순차 처리하지 않는다: 문항 간 Stage1은 서로 독립적으로 동시 실행하고, 각 문항의
// Stage1이 끝나면 그 문항의 극성별 Stage2도 문항 간 동시 실행한다. 동시성은 p-limit으로
// 5~10개로 제한한다(Claude API 레이트리밋 고려, 10장).
//
// **극성별 총평("[긍정 의견 요약]" 박스)은 여기 없다 — 의도적이다(2026-07-21).** 처음엔 Stage2
// 직후 같은 흐름 안에서 호출했는데, 실사용 중 그 호출 하나가 응답 없이 걸려 14문항 전체가
// 15분 넘게 멈추는 사고가 났다. 타임아웃(60초)과 개별 실패 격리(try/catch)를 넣어 "멈추는"
// 문제는 막았지만, 그 다음 "왜 이렇게 느린가"를 밝히려고 동시성을 늘리는 실험(14로 상향)과
// 문항 내부를 청크로 쪼개 병렬화하는 실험을 각각 돌려봤는데 — 둘 다 오히려 타임아웃이 대량
// 발생했다(21분간 27건 전부 실패 / 33분간 18건+ 계속 증가). 두 실험의 공통점은 "API 호출
// 개수를 늘리는 방향"이었다는 것 — 결론은 원래 안정적으로 잘 돌던 Stage1+Stage2 파이프라인
// 위에 극성 요약(문항당 최대 3회 호출 추가, 14문항이면 최대 42회)을 얹은 것 자체가 레이트리밋을
// 넘겨버렸다는 것이었다. 그래서 극성 요약은 이 기본 파이프라인에서 완전히 빼고, 사용자가
// 명시적으로 요청할 때만 별도로 실행되는 기능으로 분리했다 — lib/pipeline/polaritySummary.ts
// (개별 호출 함수)와 lib/pipeline/generatePolaritySummaries.ts(리포트 단위 오케스트레이션,
// app/api/chat/route.ts의 generatePolaritySummaries 도구가 호출) 참고.
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
