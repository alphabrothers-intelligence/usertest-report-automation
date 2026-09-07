import { NextResponse } from "next/server";
import { getQualitativeJob, requeueFailedQualitativeJobItems } from "@/lib/db/qualitativeJobs";

export const runtime = "nodejs";

/**
 * 빠진 문항만 다시 큐에 넣는다. 워커 루프(`useQualitativeJob`)가 알아서 집어가므로
 * 이 라우트는 상태만 되돌리고 즉시 응답한다 — 분석을 여기서 돌리지 않는다.
 */
export async function POST(_request: Request, context: RouteContext<"/api/qualitative-jobs/[jobId]/retry-failed">) {
  const { jobId } = await context.params;
  const job = await getQualitativeJob(jobId);
  if (!job) return NextResponse.json({ ok: false, error: "정성 분석 작업을 찾을 수 없습니다." }, { status: 404 });

  const requeued = await requeueFailedQualitativeJobItems(jobId);
  return NextResponse.json({ ok: true, requeued, job: await getQualitativeJob(jobId) });
}
