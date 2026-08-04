import fs from "node:fs";
import { put } from "@vercel/blob";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { estimateQualitativeCallPlan } from "../lib/pipeline/orchestrate";
import { upsertReportQuantStats } from "../lib/db/reports";
import { createQualitativeJob, getQualitativeJob, getQualitativeJobUsageSummary } from "../lib/db/qualitativeJobs";
import { sql } from "../lib/db/client";

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== 1. raw data 업로드(실제 Vercel Blob) ===");
  const buffer = fs.readFileSync("data/[리바랩스]사용성테스트 raw data.xlsx");
  const blob = await put(`e2e-test-${Date.now()}.xlsx`, buffer, {
    access: "private",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    addRandomSuffix: true,
  });
  console.log("blob url:", blob.url);

  console.log("=== 2. 정량 통계 계산(LLM 미사용) ===");
  const parsed = parseWallaWorkbook(buffer);
  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const quantStats = computeQuantStats(records, parsed.headerRow);
  const reportId = await upsertReportQuantStats({
    fileUrl: blob.url,
    fileName: "[리바랩스]사용성테스트 raw data.xlsx",
    respondentCount: records.length,
    quantStats,
  });
  console.log("reportId:", reportId);

  console.log("=== 3. 정성 분석 job 생성 (14문항) ===");
  const specs = buildQuestionSpecs(records);
  const callPlan = estimateQualitativeCallPlan(specs);
  const job = await createQualitativeJob({ reportId, specs, callPlan });
  console.log("jobId:", job.id, "예상 호출 계획:", callPlan);

  console.log("=== 4. /run-next를 워커 3개로 반복 호출(실제 브라우저와 동일 경로) ===");
  const t0 = Date.now();
  let stopped = false;
  let lastLog = 0;

  const pollStatus = async (): Promise<string> => {
    const res = await fetch(`${BASE_URL}/api/qualitative-jobs/${job.id}`, { cache: "no-store" });
    const data = await res.json();
    const now = Date.now();
    if (now - lastLog > 15000) {
      lastLog = now;
      console.log(
        `[${Math.round((now - t0) / 1000)}s] status=${data.job.status} completed=${data.job.completed_items}/${data.job.total_items} failed=${data.job.failed_items}`,
      );
    }
    return data.job.status as string;
  };

  const worker = async () => {
    while (!stopped) {
      const res = await fetch(`${BASE_URL}/api/qualitative-jobs/${job.id}/run-next`, { method: "POST" });
      const data = await res.json();
      const status = await pollStatus();
      if (["completed", "completed_with_failures", "failed", "cancelled"].includes(status)) {
        stopped = true;
        return;
      }
      if (!data.ok && !data.item) await new Promise((r) => setTimeout(r, 1500));
    }
  };

  await Promise.all([worker(), worker(), worker()]);
  const t1 = Date.now();
  const totalSeconds = Math.round((t1 - t0) / 1000);

  console.log("=== 5. 최종 상태 + 비용 집계 ===");
  const finalJob = await getQualitativeJob(job.id);
  const usage = await getQualitativeJobUsageSummary(job.id);
  const byPhase = await sql<{ phase: string; calls: number; input_tokens: number; output_tokens: number; cost: number }[]>`
    select phase, count(*)::int as calls, coalesce(sum(input_tokens),0)::int as input_tokens,
           coalesce(sum(output_tokens),0)::int as output_tokens, coalesce(sum(calculated_cost_usd),0)::float8 as cost
    from qualitative_job_usage where job_id = ${job.id} group by phase order by phase
  `;

  console.log(JSON.stringify({
    totalWallSeconds: totalSeconds,
    totalWallMinutes: (totalSeconds / 60).toFixed(1),
    finalStatus: finalJob?.status,
    completedItems: finalJob?.completed_items,
    failedItems: finalJob?.failed_items,
    usage,
    byPhase,
  }, null, 2));

  console.log(`reportId=${reportId} jobId=${job.id} (정리용으로 남겨둠, 필요시 이후 raw SQL로 삭제 가능)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
