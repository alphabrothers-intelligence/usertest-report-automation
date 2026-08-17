/* 이미 DB에 저장된 보고서 결과를 로컬 POC 입력 JSON으로만 내보낸다. */
const fs = require("node:fs/promises");
const path = require("node:path");
const postgres = require("postgres");

const reportId = process.argv[2];
const output = process.argv[3];
if (!reportId || !output) {
  throw new Error("사용법: node --env-file=.env.local export-db-report.cjs <report-id> <output.json>");
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

async function main() {
  const [report] = await sql`
    select id, report_name, file_name, product_type, product_info, quant_stats,
      result_summary, section_analyses, workspace_draft
    from reports where id = ${reportId}
  `;
  if (!report) throw new Error("보고서를 찾을 수 없습니다.");

  const questions = await sql`
    select q.question_key, q.label, q.kind, q.polarity_summaries,
      coalesce(jsonb_agg(jsonb_build_object(
        'polarity', c.polarity,
        'label', c.label,
        'clauseCount', c.clause_count,
        'quotes', c.quotes,
        'quotesDisplay', c.quotes_display,
        'insight', coalesce(c.insight_final, c.insight_draft)
      ) order by c.polarity, c.label) filter (where c.id is not null), '[]'::jsonb) as categories
    from questions q
    left join categories c on c.question_id = q.id
    where q.report_id = ${reportId}
    group by q.id
    order by q.created_at
  `;
  const recommendations = await sql`
    select section, coalesce(final, draft) as text
    from recommendations where report_id = ${reportId} order by created_at
  `;

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ report, questions, recommendations }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ reportId, questions: questions.length, recommendations: recommendations.length, output }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await sql.end(); });
