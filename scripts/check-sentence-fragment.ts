// isSentenceFragment 판정을 tmp/ 에 남은 실제 파이프라인 결과물(quotes)로 검증한다.
// LLM 재호출 없음 — 순수 규칙 함수 점검용. `npm run check:sentence-fragment`로 실행.
import fs from "node:fs";
import path from "node:path";
import { classifyClauseEnding } from "../lib/pipeline/stage1";

const TMP_DIR = path.join(__dirname, "..", "tmp");
const SOURCE_FILES = [
  "qualitative-full-run-latest.json",
  "current-qual-output.json",
  "qualitative-three-question-load-latest.json",
];

function collectQuotes(value: unknown, out: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectQuotes(v, out));
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.quotes)) {
      for (const q of obj.quotes) if (typeof q === "string") out.add(q);
    }
    for (const v of Object.values(obj)) collectQuotes(v, out);
  }
}

const quotes = new Set<string>();
for (const file of SOURCE_FILES) {
  const full = path.join(TMP_DIR, file);
  if (!fs.existsSync(full)) continue;
  collectQuotes(JSON.parse(fs.readFileSync(full, "utf-8")), quotes);
}

const extend: string[] = [];
const review: string[] = [];
for (const q of quotes) {
  const kind = classifyClauseEnding(q);
  if (kind === "extend") extend.push(q);
  else if (kind === "review") review.push(q);
}

console.log(`전체 인용문: ${quotes.size}개`);
console.log(`자동 이어붙이기 대상(extend): ${extend.length}개`);
console.log(`검토 필요(review, 대조 연결어미): ${review.length}개`);
console.log("\n--- extend 목록 ---");
for (const f of extend) console.log(`- ${JSON.stringify(f)}`);
console.log("\n--- review 목록 ---");
for (const f of review) console.log(`- ${JSON.stringify(f)}`);
