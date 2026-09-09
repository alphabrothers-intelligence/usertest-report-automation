import { NextResponse } from "next/server";
import { z } from "zod";
import { getReportByFileUrl } from "@/lib/db/reports";
import { createQualitativeJob } from "@/lib/db/qualitativeJobs";
import { loadQuestionSpecs } from "@/lib/pipeline/questionSource";
import { estimateQualitativeCallPlan } from "@/lib/pipeline/orchestrate";

const BodySchema = z.object({ fileUrl: z.string().url() });

/**
 * 정성 분석 작업만 등록하고 즉시 반환한다. Claude 호출은 하지 않는다.
 * 실제 실행은 /run-next가 문항의 Stage1 또는 Stage2 하나만 처리한다.
 */
export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  const report = await getReportByFileUrl(body.data.fileUrl);
  if (!report) return NextResponse.json({ error: "정량 분석을 먼저 완료하세요." }, { status: 409 });

  // **형식 검증으로 막지 않는다** — 리바랩스 형식이 아니면 역할 분류로 문항을 뽑는다.
  const source = await loadQuestionSpecs(body.data.fileUrl, report.file_name);
  if (!source.ok) return NextResponse.json({ error: source.error }, { status: 400 });
  const specs = source.specs;
  const callPlan = estimateQualitativeCallPlan(specs);
  const job = await createQualitativeJob({ reportId: report.id, specs, callPlan });
  return NextResponse.json({ job, callPlan, next: `/api/qualitative-jobs/${job.id}/run-next` }, { status: 201 });
}
