/**
 * PRD 9.2절 극성 판정 일치율 측정 — **제품이 실제로 쓰는 경로 기준**(2026-09-02 전면 교체).
 *
 * ## 예전 판의 문제
 *
 * 옛 스크립트는 손으로 옮겨 적은 24건을 `runStage1`(절 분리 경로)에 넣어 쟀다. 그런데 보고서는
 * 그 경로를 쓰지 않는다 — 실제로는 `runFastReportAnalysis`(앵커 경로)가 문항 전체를 한 번에
 * 분류한다. 즉 **제품과 무관한 숫자**였고, 부정/중립 표본이 14건뿐이라 1건 차이로 합격선을
 * 넘나들었다.
 *
 * ## 지금 재는 것
 *
 * - **정답**: 실제 발행 보고서 PDF의 "1. 긍정 의견 / 2. 부정 의견 / 3. 중립 의견" 아래에 실린
 *   인용문. 사람이 옮겨 적지 않고 `pdftotext`로 뽑으므로 표본이 늘어도 손이 안 간다(8~26쪽
 *   기준 60건 이상).
 * - **예측**: DB에 저장된 그 보고서의 카테고리(제품 경로가 만든 결과)에서 같은 인용문이 어느
 *   극성 묶음에 들어갔는지. **새로 API를 호출하지 않는다** — 이미 만들어진 산출물을 재므로
 *   비용 0이고, "지금 담당자가 보고 있는 보고서"를 그대로 평가한다.
 * - 인용문이 그대로 안 보이면 **같은 응답자의 같은 문항 응답**에서 뽑힌 인용문으로 한 번 더
 *   맞춰본다(모델이 같은 답변의 다른 구간을 대표로 고른 경우).
 *
 * ## 한계(숫자를 읽을 때 반드시 같이 볼 것)
 *
 * 제품이 대표로 뽑아 보고서에 실은 인용문만 평가 대상이 된다 — 전수가 아니라 **대표 인용
 * 표본**이다. 매칭되지 않은 정답 개수도 같이 출력하니, 그 비율이 크면 일치율을 과신하지 말 것.
 *
 * 사용법: `npm run check:qualitative-fidelity`
 *   - `pdftotext`(poppler) 필요: `brew install poppler`
 *   - `data/`의 발행 보고서 PDF와 raw data가 있어야 한다(gitignore라 CI에서는 못 돈다).
 *   - `DATABASE_URL` 필요. API 호출·과금 없음.
 */
import { readFileSync } from "node:fs";
import { sql } from "../lib/db/client";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import {
  KR_BY_POLARITY,
  PAGE_RANGE,
  extractLabels,
  extractOriginalShares,
  matchesFeature,
  reportText,
  type Label,
  type Polarity,
} from "./publishedReport";

const RAW_DATA = "data/[리바랩스]사용성테스트 raw data.xlsx";

/** 비교용 정규화 — 공백·따옴표·문장부호 차이는 같은 인용문으로 본다. */
function normalize(text: string): string {
  return text.replace(/[\s"'“”‘’·.,!?~()\[\]]/g, "");
}

async function main() {
  const pdfText = reportText();
  const labels = extractLabels(pdfText);
  const originalShares = extractOriginalShares(pdfText);
  if (labels.length === 0) throw new Error("발행 보고서에서 정답 인용문을 찾지 못했습니다.");

  // 평가 대상: 정성 분석이 들어 있는 가장 최근 보고서(= 담당자가 보고 있는 것).
  // **파일명으로 거르지 않는다** — 업로드 경로에서 온 파일명은 한글이 자모 분리(NFD)로 저장돼
  // `like '%리바랩스%'`(NFC)에 안 걸린다(2026-09-02 실측으로 확인).
  const [report] = await sql<{ id: string; file_name: string; created_at: Date }[]>`
    select r.id, r.file_name, r.created_at from reports r
    where exists (select 1 from questions q join categories c on c.question_id = q.id where q.report_id = r.id)
    order by r.created_at desc limit 1
  `;
  if (!report) throw new Error("비교할 정성 분석 결과가 DB에 없습니다.");
  const rows = await sql<{ question_key: string; polarity: Polarity | null; quotes: string[]; clause_count: number }[]>`
    select q.question_key, c.polarity, c.quotes, c.clause_count from categories c
    join questions q on q.id = c.question_id
    where q.report_id = ${report.id} and c.polarity is not null
  `;

  // 제품이 뽑은 인용문 → 극성. 같은 인용문이 두 번 나오면 먼저 저장된 것을 쓴다.
  const predictionByQuote = new Map<string, { polarity: Polarity; questionKey: string }>();
  for (const row of rows) {
    for (const quote of row.quotes) {
      const key = normalize(quote);
      if (key && !predictionByQuote.has(key)) predictionByQuote.set(key, { polarity: row.polarity!, questionKey: row.question_key });
    }
  }

  // 같은 응답자 폴백용: raw data의 서술형 응답 원문 → 그 응답에서 뽑힌 인용문의 극성.
  const buffer = readFileSync(new URL(`../${RAW_DATA}`, import.meta.url));
  const parsed = parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const responses: string[] = records.flatMap((record) => [
    ...record.featureSatisfaction.map((feature) => feature.reason),
    ...Object.values(record.values).map((value) => value.reason),
    record.keyFactor.reason,
    record.priorService.reason,
    record.overallSatisfaction.reason,
    record.nps.reason,
    record.improvementIdea,
  ].filter((value): value is string => Boolean(value && value.trim())));
  const polarityByResponse = new Map<string, Polarity>();
  for (const response of responses) {
    const normalized = normalize(response);
    for (const [quoteKey, prediction] of predictionByQuote) {
      if (normalized.includes(quoteKey)) {
        polarityByResponse.set(normalized, prediction.polarity);
        break;
      }
    }
  }

  const matched: { label: Label; predicted: Polarity; via: "quote" | "response" }[] = [];
  const unmatched: Label[] = [];
  for (const label of labels) {
    const key = normalize(label.quote);
    const direct = predictionByQuote.get(key);
    if (direct) {
      matched.push({ label, predicted: direct.polarity, via: "quote" });
      continue;
    }
    const containing = [...polarityByResponse.entries()].find(([response]) => response.includes(key));
    if (containing) matched.push({ label, predicted: containing[1], via: "response" });
    else unmatched.push(label);
  }

  const rate = (hits: number, total: number) => (total === 0 ? "n/a" : `${((hits / total) * 100).toFixed(1)}% (${hits}/${total})`);
  const positiveScope = matched.filter((item) => item.label.polarity === "positive" || item.predicted === "positive");
  const positiveHits = positiveScope.filter((item) => (item.label.polarity === "positive") === (item.predicted === "positive")).length;
  const negNeu = matched.filter((item) => item.label.polarity !== "positive" && item.predicted !== "positive");
  const negNeuHits = negNeu.filter((item) => item.label.polarity === item.predicted).length;
  const exact = matched.filter((item) => item.label.polarity === item.predicted).length;

  console.log(`평가 대상 보고서: ${report.file_name} (${report.created_at.toISOString().slice(0, 10)}, ${report.id.slice(0, 8)})`);
  console.log(`정답 표본: ${labels.length}건 (${PAGE_RANGE.from}~${PAGE_RANGE.to}쪽) / 매칭 ${matched.length}건 · 미매칭 ${unmatched.length}건`);
  console.log(`  - 인용문 직접 일치 ${matched.filter((item) => item.via === "quote").length}건, 같은 응답 일치 ${matched.filter((item) => item.via === "response").length}건`);
  console.log("");
  console.log(`긍정 vs 나머지: ${rate(positiveHits, positiveScope.length)}  (PRD 1.3절 목표 90%+)`);
  console.log(`부정 vs 중립:   ${rate(negNeuHits, negNeu.length)}  (목표 75%+)`);
  console.log(`전체 일치:      ${rate(exact, matched.length)}`);

  // --- 문항별 극성 비율(전수 기준) ---
  // 인용문 표본은 "제품이 대표로 뽑은 것"에 한정되지만, 비율은 응답 전체가 반영된 값이라
  // 편향이 없다. 대표 인용 일치율이 좋아도 이 비율이 크게 어긋나면 보고서는 다른 그림이 된다.
  const shareRows = new Map<string, Record<Polarity, number>>();
  for (const row of rows) {
    const current = shareRows.get(row.question_key) ?? { positive: 0, negative: 0, neutral: 0 };
    current[row.polarity!] += row.clause_count;
    shareRows.set(row.question_key, current);
  }
  const errors: number[] = [];
  const shareLines: string[] = [];
  for (const feature of [...new Set(originalShares.map((share) => share.feature))]) {
      const key = [...shareRows.keys()].find((candidate) => matchesFeature(feature, candidate));
    if (!key) continue;
    const counts = shareRows.get(key)!;
    const total = counts.positive + counts.negative + counts.neutral;
    if (total === 0) continue;
    const parts: string[] = [];
    for (const polarity of ["positive", "negative", "neutral"] as const) {
      const original = originalShares.find((share) => share.feature === feature && share.polarity === polarity)?.pct;
      if (original === undefined) continue;
      const ours = (counts[polarity] / total) * 100;
      errors.push(Math.abs(ours - original));
      parts.push(`${KR_BY_POLARITY[polarity]} ${original.toFixed(1)}→${ours.toFixed(1)}`);
    }
    shareLines.push(`  ${feature}: ${parts.join(" · ")}`);
  }
  if (errors.length > 0) {
    const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    console.log(`\n문항별 극성 비율(원본→생성, 응답 전수 기준) — 평균 절대 오차 ${mae.toFixed(1)}%p, ${errors.length}개 비교`);
    for (const line of shareLines) console.log(line);
  }

  const wrong = matched.filter((item) => item.label.polarity !== item.predicted);
  if (wrong.length > 0) {
    console.log(`\n불일치 ${wrong.length}건:`);
    for (const item of wrong) {
      console.log(`  ${item.label.page}쪽 정답 ${KR_BY_POLARITY[item.label.polarity]} → 생성 ${KR_BY_POLARITY[item.predicted]}`);
      console.log(`    "${item.label.quote.slice(0, 70)}"`);
    }
  }
  // 표본 대표성 경고 — 매칭률이 낮으면 위 일치율은 "대표 인용문에 한정된" 숫자다.
  if (matched.length < labels.length * 0.5) {
    console.log(`\n주의: 정답의 절반 이상이 생성 결과에 없어(${unmatched.length}건) 위 수치는 표본이 좁습니다.`);
  }
  process.exit(0);
}

void main();
