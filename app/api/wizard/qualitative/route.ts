import { NextResponse } from "next/server";
import { z } from "zod";
import { loadQuestionSpecs } from "@/lib/pipeline/questionSource";
import { estimateQualitativeCallPlan } from "@/lib/pipeline/orchestrate";
import { getReportByFileUrl } from "@/lib/db/reports";
import { createQualitativeJob, getLatestQualitativeJobForReport } from "@/lib/db/qualitativeJobs";

// app/api/chat/route.ts의 runQualitativeAnalysis 도구 본문을 그대로 옮긴 것 — 실제 Claude
// 호출(Stage1/Stage2)은 이 요청 안에서 하지 않고 job만 등록한다(/api/qualitative-jobs/[jobId]/
// run-next가 이어받아 처리). 마법사에서는 화면을 새로고침해도 중복 job이 안 생기도록, 이미
// 끝나지 않은 job이 있으면 새로 만들지 않고 그 job을 그대로 돌려준다(기존 채팅 도구엔 없던
// 안전장치 — 마법사는 재방문 가능성이 있어 필요).
const BodySchema = z.object({ fileUrl: z.string().url() });
const IN_FLIGHT_STATUSES = new Set(["queued", "running"]);

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { fileUrl } = body.data;

  const report = await getReportByFileUrl(fileUrl);
  if (!report) {
    return NextResponse.json({
      ok: false,
      error: "이 파일의 report가 아직 없습니다. quant-stats를 먼저 계산하세요.",
    });
  }

  const existingJob = await getLatestQualitativeJobForReport(report.id);
  if (existingJob && IN_FLIGHT_STATUSES.has(existingJob.status)) {
    return NextResponse.json({ ok: true, queued: true, jobId: existingJob.id, resumed: true });
  }

  // 문항은 작업 실행(run-next)과 같은 한 곳에서 뽑는다 — 리바랩스 형식이 아니면 역할 분류로(2026-10-23:
  // 이 경로만 고정 59열 검증을 남겨 둬서 WALLA에서 받은 다른 형식의 raw data가 여기서 막혔다).
  const source = await loadQuestionSpecs(fileUrl, report.file_name);
  if (!source.ok) return NextResponse.json({ ok: false, error: source.error });
  const specs = source.specs;
  const callPlan = estimateQualitativeCallPlan(specs);
  const job = await createQualitativeJob({ reportId: report.id, specs, callPlan });
  return NextResponse.json({
    ok: true,
    queued: true,
    jobId: job.id,
    totalQuestions: specs.length,
    callPlan,
  });
}
