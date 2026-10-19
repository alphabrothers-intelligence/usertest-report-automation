/**
 * 저장된 설문을 설문 문항 작성 가이드로 검사 `npm run check:survey-lint [설문 id...]`. API 호출·과금 없음, DB 필요.
 * id를 안 주면 최근 설문 전부. 위반이 있으면 실패 코드로 끝난다(확인은 사람이 판단할 의심 표시라 실패로 치지 않는다).
 */
import postgres from "postgres";
import { lintSurvey } from "../lib/survey/lint";
import type { SurveyDraft } from "../lib/survey/types";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const ids = process.argv.slice(2);
  const rows = ids.length
    ? await sql`select id, draft from survey_drafts where id = any(${ids}::uuid[]) order by updated_at desc`
    : await sql`select id, draft from survey_drafts order by updated_at desc`;
  await sql.end();
  let violations = 0;
  for (const { id, draft } of rows as unknown as { id: string; draft: SurveyDraft }[]) {
    const issues = lintSurvey(draft);
    const bad = issues.filter((i) => i.level === "위반");
    violations += bad.length;
    console.log(`\n■ ${draft.companyName} / ${draft.productName} (${id.slice(0, 8)}) — ${draft.questions.length}문항, 위반 ${bad.length} · 확인 ${issues.length - bad.length}`);
    for (const i of issues) console.log(`  ${i.level === "위반" ? "✗" : "?"} ${i.number.padEnd(6)} [${i.principle}] ${i.message}`);
  }
  if (violations) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
