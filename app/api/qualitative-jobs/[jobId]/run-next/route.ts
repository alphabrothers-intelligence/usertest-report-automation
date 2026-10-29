import { NextResponse } from "next/server";
import {
  claimNextQualitativeJobItem,
  completeQualitativeJobItem,
  completeQualitativeJobStage1,
  failQualitativeJobItem,
  getQualitativeJob,
  type QualitativeJobItemRow,
  type QualitativeJobRow,
} from "@/lib/db/qualitativeJobs";
import { saveQualitativeQuestionResult } from "@/lib/db/reports";
import { runPolaritySummariesForQuestion } from "@/lib/pipeline/generatePolaritySummaries";
import { runQualitativeStage1, runQualitativeStage2 } from "@/lib/pipeline/orchestrate";
import { loadQuestionSpecs } from "@/lib/pipeline/questionSource";
import { runCompletedJobFollowups } from "@/lib/pipeline/qualitativeJobFollowups";
import { recordQualitativeJobUsage } from "@/lib/pipeline/qualitativeJobUsage";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

// 한 호출은 Stage1 또는 Stage2 하나만 처리한다. Vercel의 요청 제한보다 작은 작업 단위다.
export const maxDuration = 300;

async function runStage1(job: QualitativeJobRow, item: QualitativeJobItemRow) {
  // 작업 등록과 실행은 같은 문항 추출 경로를 사용해야 한다.
  const source = await loadQuestionSpecs(job.file_url, null);
  if (!source.ok) throw new Error(source.error);
  const spec = source.specs.find((candidate) => candidate.id === item.question_key);
  if (!spec) throw new Error(`원본 raw data에서 ${item.question_key} 문항을 찾지 못했습니다.`);

  const usages: ClaudeUsageRecord[] = [];
  const checkpoint = await runQualitativeStage1(spec, { onUsage: (usage) => usages.push(usage) });
  await recordQualitativeJobUsage({
    jobId: job.id, itemId: item.id, phase: "stage1", usages,
    errorLabel: "[qualitative-job] Stage1 사용량 저장 실패",
  });
  await completeQualitativeJobStage1(item.id, checkpoint);
  return { ok: true, item: { id: item.id, questionKey: item.question_key, phase: "stage1", nextPhase: "stage2" } };
}

async function runStage2(job: QualitativeJobRow, item: QualitativeJobItemRow) {
  if (!item.checkpoint) throw new Error("Stage2 실행에 필요한 Stage1 체크포인트가 없습니다.");
  const result = await runQualitativeStage2(item.checkpoint);
  await saveQualitativeQuestionResult(job.report_id, result);

  // 문항 요약 실패는 이미 생성된 정성 분석을 취소하지 않는다.
  try {
    await runPolaritySummariesForQuestion(job.report_id, result.id);
  } catch (error) {
    console.warn(`[qualitative-job] ${result.id} 응답 요약 생성 건너뜀:`, error instanceof Error ? error.message : error);
  }
  await completeQualitativeJobItem(item.id);

  // 작업 전체가 완료된 마지막 Stage2에서만 보고서 후속 생성을 실행한다.
  const completedJob = await getQualitativeJob(job.id);
  const sectionAnalyses = completedJob?.status === "completed"
    ? await runCompletedJobFollowups(job)
    : { status: "skipped" as const };
  return {
    ok: true,
    item: { id: item.id, questionKey: item.question_key, phase: "stage2", completed: true },
    sectionAnalyses,
  };
}

export async function POST(_request: Request, context: RouteContext<"/api/qualitative-jobs/[jobId]/run-next">) {
  const { jobId } = await context.params;
  const job = await getQualitativeJob(jobId);
  if (!job) return NextResponse.json({ error: "정성 분석 작업을 찾을 수 없습니다." }, { status: 404 });
  if (["completed", "completed_with_failures", "failed", "cancelled"].includes(job.status)) {
    return NextResponse.json({ job, message: "더 처리할 문항이 없습니다." });
  }

  const item = await claimNextQualitativeJobItem(jobId);
  if (!item) return NextResponse.json({ job, message: "현재 처리할 문항이 없습니다. 다른 작업자가 처리 중일 수 있습니다." });

  try {
    const response = item.phase === "stage1" ? await runStage1(job, item) : await runStage2(job, item);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failQualitativeJobItem(item.id, message);
    return NextResponse.json({ ok: false, item: { id: item.id, questionKey: item.question_key, phase: item.phase }, error: message }, { status: 500 });
  }
}
