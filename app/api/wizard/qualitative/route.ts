import { NextResponse } from "next/server";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { buildQuestionSpecs } from "@/lib/pipeline/questions";
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

  const loaded = await loadWallaFromUrl(fileUrl);
  if (!loaded.ok || !loaded.parsed || !loaded.validation) {
    return NextResponse.json({ ok: false, error: loaded.fetchError });
  }
  if (!loaded.validation.valid) {
    return NextResponse.json({
      ok: false,
      error: "보고서에 필요한 응답 구조를 찾지 못했습니다. 원본 파일의 질문과 응답 열을 다시 확인해주세요.",
    });
  }

  const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
  const specs = buildQuestionSpecs(records);
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
