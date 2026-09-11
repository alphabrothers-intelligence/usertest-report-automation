/**
 * **정량을 다시 계산해도 Ⅸ장 해석이 사라지지 않는지** 실제 DB로 확인한다 —
 * `npm run check:quant-recompute`. Claude 호출 없음(과금 0). DATABASE_URL 필요.
 *
 * 2026-09-10 사고: 같은 파일로 정량만 다시 돌렸는데 result_summary와 section_analyses가
 * 통째로 지워졌다(케어클). 지금은 **수치가 실제로 바뀐 경우에만** 지운다.
 */
import { sql } from "@/lib/db/client";
import { upsertReportQuantStats, saveReportResultSummary } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";

const FILE_URL = `https://example.invalid/check-quant-recompute-${Date.now()}.csv`;
const base = { respondentCount: 3, featureSatisfaction: [{ name: "기능A", mean: 7, sd: 1 }] } as unknown as QuantStats;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function readInterpretation(id: string) {
  const [row] = await sql<{ result_summary: string | null; section_analyses: unknown }[]>`
    select result_summary, section_analyses from reports where id = ${id}`;
  return row;
}

async function main() {
  const id = await upsertReportQuantStats({ fileUrl: FILE_URL, fileName: "check.csv", respondentCount: 3, quantStats: base });
  await saveReportResultSummary(id, "## 기능별 고객 경험 평가\n• 해석 문장");
  await sql`update reports set section_analyses = ${sql.json({ fourValues: "가치 해석" })} where id = ${id}`;

  // ① 같은 수치로 다시 계산 — 해석이 남아야 한다.
  await upsertReportQuantStats({ fileUrl: FILE_URL, fileName: "check.csv", respondentCount: 3, quantStats: base });
  const same = await readInterpretation(id);
  check("같은 수치로 재계산하면 결과 요약이 남는다", Boolean(same.result_summary), `${same.result_summary?.length ?? 0}자`);
  check("같은 수치로 재계산하면 섹션 분석이 남는다", Boolean(same.section_analyses));

  // ② 수치가 바뀌면 — 낡은 해석은 버려야 한다(틀린 숫자를 말하게 두지 않는다).
  const changed = { ...base, featureSatisfaction: [{ name: "기능A", mean: 9, sd: 1 }] } as unknown as QuantStats;
  await upsertReportQuantStats({ fileUrl: FILE_URL, fileName: "check.csv", respondentCount: 3, quantStats: changed });
  const after = await readInterpretation(id);
  check("수치가 바뀌면 결과 요약을 버린다", after.result_summary === null);
  check("수치가 바뀌면 섹션 분석을 버린다", after.section_analyses === null);

  await sql`delete from reports where id = ${id}`;
  console.log(failed === 0 ? "\n4/4 PASS" : `\n${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
