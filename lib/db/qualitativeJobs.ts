import { sql } from "./client";
import type { QualitativeCallPlan, QualitativeStage1Checkpoint } from "@/lib/pipeline/orchestrate";
import type { QuestionSpec } from "@/lib/pipeline/questions";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

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

export interface QualitativeUsageSummary {
  successful_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  calculated_cost_usd: number;
  elapsed_ms: number;
}

export type QualitativeSectionAnalysisKey = "featureExperience" | "corePurchaseFactor" | "fourValues" | "fourValueItems" | "uxQuality" | "crossAnalysis";
export type QualitativeSectionAnalysisRunStatus = "running" | "completed" | "failed";

export interface QualitativeSectionAnalysisRunRow {
  id: string;
  job_id: string;
  report_id: string;
  section_key: QualitativeSectionAnalysisKey;
  attempt: number;
  status: QualitativeSectionAnalysisRunStatus;
  started_at: string;
  completed_at: string | null;
  elapsed_ms: number | null;
  error_message: string | null;
}

const TOKEN_RATES = {
  inputUsdPerMTokens: Number(process.env.QUALITATIVE_INPUT_USD_PER_MTOKENS ?? 3),
  outputUsdPerMTokens: Number(process.env.QUALITATIVE_OUTPUT_USD_PER_MTOKENS ?? 15),
  // Anthropic의 기본 프롬프트 캐시 단가 가정. 모델/계약별 값은 환경변수로 조정한다.
  cacheReadUsdPerMTokens: Number(process.env.QUALITATIVE_CACHE_READ_USD_PER_MTOKENS ?? 0.3),
  cacheWriteUsdPerMTokens: Number(process.env.QUALITATIVE_CACHE_WRITE_USD_PER_MTOKENS ?? 3.75),
};

function calculatedCost(usage: ClaudeUsageRecord): number {
  // SDK의 inputTokens가 캐시 토큰을 포함할 수 있으므로 상세 값(noCacheTokens)을 우선한다.
  const nonCachedInput = usage.noCacheTokens ?? usage.inputTokens ?? 0;
  return Number((
    (nonCachedInput / 1_000_000) * TOKEN_RATES.inputUsdPerMTokens
    + ((usage.outputTokens ?? 0) / 1_000_000) * TOKEN_RATES.outputUsdPerMTokens
    + ((usage.cacheReadTokens ?? 0) / 1_000_000) * TOKEN_RATES.cacheReadUsdPerMTokens
    + ((usage.cacheWriteTokens ?? 0) / 1_000_000) * TOKEN_RATES.cacheWriteUsdPerMTokens
  ).toFixed(8));
}

export async function saveQualitativeJobUsage(params: {
  jobId: string;
  itemId: string | null;
  phase: "stage1" | "stage2" | "section_analysis";
  usage: ClaudeUsageRecord;
}): Promise<void> {
  const { usage } = params;
  await sql`
    insert into qualitative_job_usage (
      job_id, item_id, phase, label, attempt,
      input_tokens, output_tokens, total_tokens, no_cache_tokens, cache_read_tokens, cache_write_tokens,
      elapsed_ms,
      input_usd_per_mtokens, output_usd_per_mtokens, cache_read_usd_per_mtokens, cache_write_usd_per_mtokens,
      calculated_cost_usd
    ) values (
      ${params.jobId}, ${params.itemId}, ${params.phase}, ${usage.label}, ${usage.attempt},
      ${usage.inputTokens}, ${usage.outputTokens}, ${usage.totalTokens}, ${usage.noCacheTokens}, ${usage.cacheReadTokens}, ${usage.cacheWriteTokens},
      ${usage.elapsedMs},
      ${TOKEN_RATES.inputUsdPerMTokens}, ${TOKEN_RATES.outputUsdPerMTokens}, ${TOKEN_RATES.cacheReadUsdPerMTokens}, ${TOKEN_RATES.cacheWriteUsdPerMTokens},
      ${calculatedCost(usage)}
    ) on conflict do nothing
  `;
}

export async function getQualitativeJobUsageSummary(jobId: string): Promise<QualitativeUsageSummary> {
  const [summary] = await sql<QualitativeUsageSummary[]>`
    select
      count(*)::int as successful_calls,
      coalesce(sum(input_tokens), 0)::int as input_tokens,
      coalesce(sum(output_tokens), 0)::int as output_tokens,
      coalesce(sum(total_tokens), 0)::int as total_tokens,
      coalesce(sum(cache_read_tokens), 0)::int as cache_read_tokens,
      coalesce(sum(cache_write_tokens), 0)::int as cache_write_tokens,
      coalesce(sum(calculated_cost_usd), 0)::float8 as calculated_cost_usd,
      coalesce(sum(elapsed_ms), 0)::int as elapsed_ms
    from qualitative_job_usage
    where job_id = ${jobId}
  `;
  return summary ?? {
    successful_calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0,
    cache_read_tokens: 0, cache_write_tokens: 0, calculated_cost_usd: 0, elapsed_ms: 0,
  };
}

/**
 * 4개 상위 섹션 분석의 실행 이력은 14문항 작업 상태와 분리한다.
 * 따라서 이 단계가 부분 실패해도 기존 정성 분석을 실패로 되돌리지 않는다.
 */
export async function startQualitativeSectionAnalysisRun(params: {
  jobId: string;
  reportId: string;
  sectionKey: QualitativeSectionAnalysisKey;
}): Promise<QualitativeSectionAnalysisRunRow> {
  const [run] = await sql<QualitativeSectionAnalysisRunRow[]>`
    insert into qualitative_section_analysis_runs (job_id, report_id, section_key, attempt)
    values (
      ${params.jobId},
      ${params.reportId},
      ${params.sectionKey},
      coalesce((
        select max(attempt) + 1
        from qualitative_section_analysis_runs
        where job_id = ${params.jobId} and section_key = ${params.sectionKey}
      ), 1)
    )
    returning *
  `;
  return run;
}

export async function completeQualitativeSectionAnalysisRun(runId: string): Promise<void> {
  await sql`
    update qualitative_section_analysis_runs
    set status = 'completed',
        completed_at = now(),
        elapsed_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::int),
        error_message = null,
        updated_at = now()
    where id = ${runId}
  `;
}

export async function failQualitativeSectionAnalysisRun(runId: string, error: string): Promise<void> {
  await sql`
    update qualitative_section_analysis_runs
    set status = 'failed',
        completed_at = now(),
        elapsed_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::int),
        error_message = ${error.slice(0, 2000)},
        updated_at = now()
    where id = ${runId}
  `;
}

export async function getQualitativeSectionAnalysisRuns(jobId: string): Promise<QualitativeSectionAnalysisRunRow[]> {
  return sql<QualitativeSectionAnalysisRunRow[]>`
    select * from qualitative_section_analysis_runs
    where job_id = ${jobId}
    order by created_at, section_key, attempt
  `;
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

/**
 * 보고서 생성 전, 해당 원본 데이터의 가장 최근 정성 응답 분석 작업이 실제로 끝났는지 확인한다.
 * 채팅 문구가 아니라 DB 작업 상태를 기준으로 다음 단계를 열기 위해 사용한다.
 */
export async function getLatestQualitativeJobForReport(reportId: string): Promise<QualitativeJobRow | null> {
  const [job] = await sql<QualitativeJobRow[]>`
    select j.*, r.file_url
    from qualitative_jobs j
    join reports r on r.id = j.report_id
    where j.report_id = ${reportId}
    order by j.created_at desc
    limit 1
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
    // stage2를 stage1보다 먼저 배정한다(2026-08-12 변경, 실제 stuck 사고로 발견). stage2는
    // 이미 stage1을 통과한 "거의 끝난" 문항이라 짧고 안정적으로 끝나는데, 예전엔 stage1을
    // 항상 먼저 배정해서 — 특정 문항 몇 개가 hard timeout으로 계속 재시도되면 그 몇 개가
    // 워커(동시성 3)를 전부 붙잡고, 이미 stage1을 마치고 stage2만 남은 문항들이 하나도
    // 배정받지 못한 채 무한정 대기하는 게 실측됐다(job 하나가 19분+ 동안 0/14 완료).
    // stage2를 먼저 비우면 어려운 문항이 재시도를 반복하는 동안에도 나머지 문항은 계속
    // 끝까지 진행되고, 최악의 경우에도 실패는 그 어려운 문항 몇 개로 국한된다.
    const [candidate] = await tx<QualitativeJobItemRow[]>`
      select * from qualitative_job_items
      where job_id = ${jobId} and status = 'queued'
      order by case phase when 'stage2' then 0 else 1 end, created_at
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
