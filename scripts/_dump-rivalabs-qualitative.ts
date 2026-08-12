// 이미 DB에 저장된 리바랩스 정성 분석 결과(Stage1/2, 2026-08-03 실행분)를 JSON으로 떨군다.
// 새 LLM 호출 없음 -- 순수 조회. lib/db/는 수정하지 않는다.
//
// polaritySummaries의 원문에는 **굵게**/__밑줄__ 마크다운이 섞여 있다(결과요약 프롬프트가
// 이렇게 생성 -- CLAUDE.md에 이미 기록된 것과 같은 원인). lib/pdf/richText.tsx·lib/docx/
// helpers.ts가 이미 쓰는 공용 파서(lib/report/richText.ts의 parseRichRuns)를 그대로
// 재사용해 {text, bold, underline} run 배열로 바꿔서 같이 저장한다 -- Python 쪽에서 직접
// 마크다운을 파싱하지 않고(같은 로직을 두 언어로 중복 구현하는 대신) 이미 파싱된 결과만
// 받아 hwpx run으로 옮기기만 하면 되게 하기 위함(2026-08-05, 처음엔 마크다운 기호만 지우고
// 실제 볼드/밑줄 서식을 안 살렸다가 사용자 지적으로 발견).
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { parseRichRuns, type RichTextRun } from "../lib/report/richText";

const REPORT_ID = "4b8d2cde-f602-4b0b-b8b4-325d845b99b3";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

function withRuns(text: string | null | undefined): { text: string; runs: RichTextRun[] } {
  const value = text ?? "";
  return { text: value, runs: parseRichRuns(value) };
}

async function main() {
  const questions = await sql`
    select id, question_key, label, kind, polarity_summaries
    from questions where report_id = ${REPORT_ID}
  `;
  const result: Record<string, unknown> = {};
  for (const q of questions) {
    const categories = await sql`
      select polarity, label, clause_count, quotes, insight_draft, insight_final, insight_approved
      from categories where question_id = ${q.id}
      order by polarity, clause_count desc
    `;
    const clauseCounts = await sql`
      select polarity, count(*)::int as n from clauses where question_id = ${q.id} group by polarity
    `;
    const ps = q.polarity_summaries as Record<string, string> | null;
    const polaritySummariesWithRuns = ps
      ? Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, withRuns(v)]))
      : null;
    result[q.question_key] = {
      label: q.label,
      kind: q.kind,
      polaritySummaries: polaritySummariesWithRuns,
      clauseCounts,
      categories,
    };
  }
  writeFileSync(process.argv[2] ?? "/tmp/rivalabs-qualitative.json", JSON.stringify(result, null, 2), "utf-8");
  console.log(`WROTE with ${questions.length} questions`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
