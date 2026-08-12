import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const reports = await sql`
    select r.id, r.file_name, r.respondent_count, r.created_at,
           (select count(*) from questions q where q.report_id = r.id) as question_count,
           (select count(*) from categories c join questions q on c.question_id = q.id where q.report_id = r.id) as category_count
    from reports r
    order by r.created_at desc
  `;
  for (const r of reports) {
    console.log(r);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
