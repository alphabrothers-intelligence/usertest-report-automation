import { NextResponse } from "next/server";
import { getQualitativeJob, getQualitativeJobItems, getQualitativeJobUsageSummary } from "@/lib/db/qualitativeJobs";

export async function GET(_request: Request, context: RouteContext<"/api/qualitative-jobs/[jobId]">) {
  const { jobId } = await context.params;
  const job = await getQualitativeJob(jobId);
  if (!job) return NextResponse.json({ error: "정성 분석 작업을 찾을 수 없습니다." }, { status: 404 });
  const items = await getQualitativeJobItems(jobId);
  const usage = await getQualitativeJobUsageSummary(jobId);
  return NextResponse.json({ job, items, usage });
}
