import { sql } from "./client";
import type { QualitativeCallPlan, QualitativeStage1Checkpoint } from "@/lib/pipeline/orchestrate";
import type { QuestionSpec } from "@/lib/pipeline/questions";

export type QualitativeJobStatus = "queued" | "running" | "completed" | "completed_with_failures" | "failed" | "cancelled";
export type QualitativeJobPhase = "stage1" | "stage2";

export interface QualitativeJobRow {
  id: string;
  report_id: string;
  file_url: string;
  status: QualitativeJobStatus;
  total_items: number;
  completed_items: number;
  failed_items: number;
  call_plan: QualitativeCallPlan;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface QualitativeJobItemRow {
  id: string;
  job_id: string;
  question_key: string;
  label: string;
  kind: "standard" | "improvement";
  phase: QualitativeJobPhase;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  checkpoint: QualitativeStage1Checkpoint | null;
  last_error: string | null;
}

export async function createQualitativeJob(params: {
  reportId: string;
  callPlan: QualitativeCallPlan;
  specs: QuestionSpec[];
}): Promise<QualitativeJobRow> {
  return sql.begin(async (tx) => {
    const [job] = await tx<QualitativeJobRow[]>`
      insert into qualitative_jobs (report_id, total_items, call_plan)
      values (${params.reportId}, ${params.specs.length}, ${sql.json(JSON.parse(JSON.stringify(params.callPlan)))})
      returning *, (select file_url from reports where id = ${params.reportId}) as file_url
    `;
    await tx`insert into qualitative_job_items ${tx(params.specs.map((spec) => ({
      job_id: job.id,
      question_key: spec.id,
      label: spec.label,
      kind: spec.kind,
    })))} `;
    return job;
  });
}

export async function getQualitativeJob(jobId: string): Promise<QualitativeJobRow | null> {
  const [job] = await sql<QualitativeJobRow[]>`
    select j.*, r.file_url
    from qualitative_jobs j join reports r on r.id = j.report_id
    where j.id = ${jobId}
  `;
  return job ?? null;
}

export async function getQualitativeJobItems(jobId: string): Promise<QualitativeJobItemRow[]> {
  return sql<QualitativeJobItemRow[]>`
    select * from qualitative_job_items where job_id = ${jobId}
    order by created_at, question_key
  `;
}

/** 여러 작업자가 동시에 요청해도 SKIP LOCKED로 서로 다른 문항/단계만 가져간다. */
export async function claimNextQualitativeJobItem(jobId: string): Promise<QualitativeJobItemRow | null> {
  return sql.begin(async (tx) => {
    const [candidate] = await tx<QualitativeJobItemRow[]>`
      select * from qualitative_job_items
      where job_id = ${jobId} and status = 'queued'
      order by case phase when 'stage1' then 0 else 1 end, created_at
      for update skip locked
      limit 1
    `;
    if (!candidate) return null;
    const [claimed] = await tx<QualitativeJobItemRow[]>`
      update qualitative_job_items
      set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
      where id = ${candidate.id}
      returning *
    `;
    await tx`
      update qualitative_jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
      where id = ${jobId} and status = 'queued'
    `;
    return claimed;
  });
}

async function refreshQualitativeJob(jobId: string): Promise<void> {
  await sql`
    update qualitative_jobs j
    set completed_items = counts.completed_items,
        failed_items = counts.failed_items,
        status = case
          when counts.remaining_items > 0 then 'running'
          when counts.failed_items > 0 and counts.completed_items > 0 then 'completed_with_failures'
          when counts.failed_items > 0 then 'failed'
          else 'completed'
        end,
        completed_at = case when counts.remaining_items = 0 then now() else null end,
        updated_at = now()
    from (
      select job_id,
        count(*) filter (where status = 'completed')::int as completed_items,
        count(*) filter (where status = 'failed')::int as failed_items,
        count(*) filter (where status in ('queued', 'running'))::int as remaining_items
      from qualitative_job_items where job_id = ${jobId} group by job_id
    ) counts
    where j.id = counts.job_id
  `;
}

export async function completeQualitativeJobStage1(itemId: string, checkpoint: QualitativeStage1Checkpoint): Promise<void> {
  await sql`
    update qualitative_job_items
    set phase = 'stage2', status = 'queued', checkpoint = ${sql.json(JSON.parse(JSON.stringify(checkpoint)))}, last_error = null, updated_at = now()
    where id = ${itemId}
  `;
}

export async function completeQualitativeJobItem(itemId: string): Promise<void> {
  const [item] = await sql<{ job_id: string }[]>`
    update qualitative_job_items
    set status = 'completed', completed_at = now(), last_error = null, updated_at = now()
    where id = ${itemId}
    returning job_id
  `;
  if (item) await refreshQualitativeJob(item.job_id);
}

// 실제 14문항 전체 실행(2026-07-27)에서 4문항이 "hard timeout after 90000ms"로 실패했다 —
// withClaudeGuard가 이미 1회 재시도했는데도 실패한 것들이라, 개별 호출 재시도만으로는 부족
// 하다는 뜻이다. Claude API 연결이 간헐적으로 멈추는 문제(claudeGuard.ts 주석 참고)는 같은
// 문항을 처음부터 다시 시도하면 대체로 통과하는 종류의 일시적 현상이라, 이 job 큐 레벨에서
// 한 번 더 재시도 기회를 준다. claimNextQualitativeJobItem이 클레임할 때마다 attempts를
// 이미 증가시켜 두므로, 그 값을 기준으로 상한 이하면 다시 'queued'로 되돌려 다음 워커가
// 자동으로 다시 집어가게 한다 — 클라이언트 폴링 루프를 바꿀 필요가 없다.
const MAX_ITEM_ATTEMPTS = Math.max(1, Number(process.env.QUALITATIVE_ITEM_MAX_ATTEMPTS ?? 3));

export async function failQualitativeJobItem(itemId: string, error: string): Promise<void> {
  const [item] = await sql<{ job_id: string; attempts: number; status: string }[]>`
    update qualitative_job_items
    set status = case when attempts < ${MAX_ITEM_ATTEMPTS} then 'queued' else 'failed' end,
        last_error = ${error.slice(0, 2000)},
        completed_at = case when attempts < ${MAX_ITEM_ATTEMPTS} then completed_at else now() end,
        updated_at = now()
    where id = ${itemId}
    returning job_id, attempts, status
  `;
  if (item) await refreshQualitativeJob(item.job_id);
}
