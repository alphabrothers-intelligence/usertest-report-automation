import { sql } from "./client";
import type { SurveyDraft } from "@/lib/survey/types";

export interface SurveyListItem {
  id: string;
  sourceFileName: string | null;
  companyName: string;
  productName: string;
  questionCount: number;
  updatedAt: string;
}

export async function createSurvey(draft: SurveyDraft, sourceFileName: string | null): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into survey_drafts (source_file_name, draft) values (${sourceFileName}, ${sql.json(draft as never)})
    returning id`;
  return row.id;
}

export async function getSurvey(id: string): Promise<{ draft: SurveyDraft; sourceFileName: string | null } | null> {
  const [row] = await sql<{ draft: SurveyDraft; source_file_name: string | null }[]>`
    select draft, source_file_name from survey_drafts where id = ${id}`;
  return row ? { draft: row.draft, sourceFileName: row.source_file_name } : null;
}

export async function updateSurvey(id: string, draft: SurveyDraft): Promise<boolean> {
  const rows = await sql`update survey_drafts set draft = ${sql.json(draft as never)}, updated_at = now() where id = ${id} returning id`;
  return rows.length > 0;
}

export async function deleteSurvey(id: string): Promise<boolean> {
  const rows = await sql`delete from survey_drafts where id = ${id} returning id`;
  return rows.length > 0;
}

export async function listSurveys(limit = 50): Promise<SurveyListItem[]> {
  const rows = await sql<{ id: string; source_file_name: string | null; company: string | null; product: string | null; count: number; updated_at: Date }[]>`
    select id, source_file_name, draft->>'companyName' as company, draft->>'productName' as product,
           jsonb_array_length(draft->'questions') as count, updated_at
    from survey_drafts order by updated_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    sourceFileName: r.source_file_name,
    companyName: r.company ?? "",
    productName: r.product ?? "",
    questionCount: r.count,
    updatedAt: r.updated_at.toISOString(),
  }));
}
