import { readFileSync, writeFileSync } from "node:fs";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { runQualitativePipeline } from "../lib/pipeline/orchestrate";

const POL = { positive: "긍정", negative: "부정", neutral: "중립" } as const;

async function main() {
  const path = new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url);
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const parsed = parseWallaWorkbook(ab);
  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const specs = buildQuestionSpecs(records);
  console.log(`전체 ${specs.length}문항 실행 (Stage1=${process.env.ANTHROPIC_STAGE1_MODEL}, Stage2=sonnet), 동시성 기본...`);
  const t0 = Date.now();
  const result = await runQualitativePipeline(specs);
  const secs = (result.elapsedMs / 1000).toFixed(0);
  console.log(`\n처리 ${secs}초, 실패 ${result.failedQuestionCount}문항`);
  if (result.failedQuestions.length) console.log("실패:", result.failedQuestions.map((f) => `${f.label}(${f.error})`).join("; "));

  // 1) 나중에 무료로 DB에 넣을 수 있는 원본 JSON
  writeFileSync(new URL("../output/정성분석_전체_pipeline.json", import.meta.url), JSON.stringify(result), "utf8");

  // 2) 사람이 읽고 원본과 대조할 md
  const md: string[] = [`# 정성 분석 전체 (14문항) — 최신 Haiku 실행\n`, `> Stage1=Haiku, Stage2=Sonnet · 처리 ${secs}초 · 실패 ${result.failedQuestionCount}\n`];
  for (const q of result.questions) {
    if (q.kind === "improvement") {
      md.push(`\n## ${q.label} (개선 아이디어)`);
      for (const cat of q.stage2.categories) {
        md.push(`\n**[${cat.label}]** (${cat.clause_count}건)`);
        md.push(`→ ${cat.insight}`);
        cat.quotes.slice(0, 3).forEach((x) => md.push(`- "${x}"`));
      }
      continue;
    }
    const total = q.clauses.length;
    const cnt: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
    for (const c of q.clauses) cnt[c.polarity] = (cnt[c.polarity] ?? 0) + 1;
    const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
    md.push(`\n## ${q.label}`);
    md.push(`총 절 ${total} · 긍정 ${pct(cnt.positive)}% · 부정 ${pct(cnt.negative)}% · 중립 ${pct(cnt.neutral)}%`);
    let i = 0;
    for (const pol of ["positive", "negative", "neutral"] as const) {
      const s2 = q.stage2ByPolarity[pol];
      if (!s2 || s2.categories.length === 0) continue;
      i += 1;
      md.push(`\n### ${i}. ${POL[pol]} 의견 (${pct(cnt[pol])}%)`);
      s2.categories.forEach((cat) => {
        md.push(`\n**[${cat.label}]** (${cat.clause_count}건)`);
        md.push(`→ ${cat.insight}`);
        cat.quotes.slice(0, 3).forEach((x) => md.push(`- "${x}"`));
      });
    }
  }
  writeFileSync(new URL("../output/정성분석_전체_14문항.md", import.meta.url), md.join("\n"), "utf8");
  console.log("저장: output/정성분석_전체_14문항.md , output/정성분석_전체_pipeline.json");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
