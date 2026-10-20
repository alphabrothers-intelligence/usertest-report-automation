import { sql } from "./client";
import type { SurveyDraft } from "@/lib/survey/types";

export interface SurveyListItem {
  id: string;
  sourceFileName: string | null;
  companyName: string;
  productName: string;
  questionCount: number;
  updatedAt: string;
  /** 제품별로 나눈 설문이면 원래 설문 id. */
  parentId: string | null;
}

export async function createSurvey(
  draft: SurveyDraft,
  sourceFileName: string | null,
  opts: { sourceFileUrl?: string | null; parentId?: string | null } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into survey_drafts (source_file_name, source_file_url, parent_id, draft)
    values (${sourceFileName}, ${opts.sourceFileUrl ?? null}, ${opts.parentId ?? null}, ${sql.json(draft as never)})
    returning id`;
  return row.id;
}

export async function getSurvey(id: string): Promise<{ draft: SurveyDraft; sourceFileName: string | null; sourceFileUrl: string | null } | null> {
  const [row] = await sql<{ draft: SurveyDraft; source_file_name: string | null; source_file_url: string | null }[]>`
    select draft, source_file_name, source_file_url from survey_drafts where id = ${id}`;
  return row ? { draft: row.draft, sourceFileName: row.source_file_name, sourceFileUrl: row.source_file_url } : null;
}

export async function updateSurvey(id: string, draft: SurveyDraft): Promise<boolean> {
  // 내용이 같으면 수정 시각을 그대로 둔다 — 기획안 만들기가 설문을 함께 저장해도 목록 순서가 바뀌지 않게.
  const json = sql.json(draft as never);
  const rows = await sql`
    update survey_drafts set draft = ${json},
      updated_at = case when draft is distinct from ${json}::jsonb then now() else updated_at end
    where id = ${id} returning id`;
  return rows.length > 0;
}

export async function deleteSurvey(id: string): Promise<boolean> {
  const rows = await sql`delete from survey_drafts where id = ${id} returning id`;
  return rows.length > 0;
}

export async function listSurveys(limit = 50): Promise<SurveyListItem[]> {
  const rows = await sql<{ id: string; source_file_name: string | null; company: string | null; product: string | null; count: number; updated_at: Date; parent_id: string | null }[]>`
    select id, source_file_name, parent_id, draft->>'companyName' as company, draft->>'productName' as product,
           jsonb_array_length(draft->'questions') as count, updated_at
    from survey_drafts order by updated_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    sourceFileName: r.source_file_name,
    companyName: r.company ?? "",
    productName: r.product ?? "",
    questionCount: r.count,
    updatedAt: r.updated_at.toISOString(),
    parentId: r.parent_id,
  }));
}

// ── 기획안(survey_plans) ─────────────────────────────────────────────────

export interface PlanListItem {
  id: string;
  surveyId: string | null;
  companyName: string;
  productName: string;
  fileName: string;
  blobUrl: string;
  questionCount: number;
  createdAt: string;
  /** 설문이 지워졌으면 null, 기획안을 만든 뒤 문항이 바뀌었으면 true. */
  surveyChanged: boolean | null;
}

/** 만들 때의 문항 md5를 DB가 계산한다 — jsonb 텍스트로 비교해야 지금 설문과 같은 기준이 된다. */
export async function createPlan(p: { surveyId: string; draft: SurveyDraft; fileName: string; blobUrl: string }): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into survey_plans (survey_id, company_name, product_name, file_name, blob_url, question_count, questions_hash)
    values (${p.surveyId}, ${p.draft.companyName}, ${p.draft.productName}, ${p.fileName}, ${p.blobUrl},
            ${p.draft.questions.length}, md5((${sql.json(p.draft.questions as never)}::jsonb)::text))
    returning id`;
  return row.id;
}

export async function listPlans(limit = 100): Promise<PlanListItem[]> {
  const rows = await sql<{ id: string; survey_id: string | null; company_name: string; product_name: string; file_name: string; blob_url: string; question_count: number; created_at: Date; changed: boolean | null }[]>`
    select p.id, p.survey_id, p.company_name, p.product_name, p.file_name, p.blob_url, p.question_count, p.created_at,
           case when s.id is null then null else md5((s.draft->'questions')::text) <> p.questions_hash end as changed
    from survey_plans p left join survey_drafts s on s.id = p.survey_id
    order by p.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    surveyId: r.survey_id,
    companyName: r.company_name,
    productName: r.product_name,
    fileName: r.file_name,
    blobUrl: r.blob_url,
    questionCount: r.question_count,
    createdAt: r.created_at.toISOString(),
    surveyChanged: r.changed,
  }));
}

export async function deletePlan(id: string): Promise<string | null> {
  const [row] = await sql<{ blob_url: string }[]>`delete from survey_plans where id = ${id} returning blob_url`;
  return row?.blob_url ?? null;
}
