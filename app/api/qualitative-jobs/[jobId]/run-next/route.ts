import { NextResponse } from "next/server";
import {
  claimNextQualitativeJobItem,
  completeQualitativeJobItem,
  completeQualitativeJobStage1,
  failQualitativeJobItem,
  getQualitativeJob,
} from "@/lib/db/qualitativeJobs";
import { saveQualitativeQuestionResult } from "@/lib/db/reports";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { buildQuestionSpecs } from "@/lib/pipeline/questions";
import {
  runQualitativeStage1,
  runQualitativeStage2,
  type QualitativeStage1Checkpoint,
} from "@/lib/pipeline/orchestrate";

// 한 호출은 Stage1 또는 Stage2 하나만 처리한다. Vercel의 요청 제한보다 작은 작업 단위다.
export const maxDuration = 300;

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
    if (item.phase === "stage1") {
      const loaded = await loadWallaFromUrl(job.file_url);
      if (!loaded.ok || !loaded.parsed || !loaded.validation?.valid) {
        throw new Error(loaded.fetchError ?? "WALLA raw data를 다시 읽지 못했습니다.");
      }
      const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
      const spec = buildQuestionSpecs(records).find((candidate) => candidate.id === item.question_key);
      if (!spec) throw new Error(`원본 raw data에서 ${item.question_key} 문항을 찾지 못했습니다.`);
      const checkpoint = await runQualitativeStage1(spec);
      await completeQualitativeJobStage1(item.id, checkpoint);
      return NextResponse.json({ ok: true, item: { id: item.id, questionKey: item.question_key, phase: "stage1", nextPhase: "stage2" } });
    }

    if (!item.checkpoint) throw new Error("Stage2 실행에 필요한 Stage1 체크포인트가 없습니다.");
    const result = await runQualitativeStage2(item.checkpoint as QualitativeStage1Checkpoint);
    await saveQualitativeQuestionResult(job.report_id, result);
    await completeQualitativeJobItem(item.id);
    return NextResponse.json({ ok: true, item: { id: item.id, questionKey: item.question_key, phase: "stage2", completed: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failQualitativeJobItem(item.id, message);
    return NextResponse.json({ ok: false, item: { id: item.id, questionKey: item.question_key, phase: item.phase }, error: message }, { status: 500 });
  }
}
