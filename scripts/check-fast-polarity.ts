/**
 * 프롬프트 수정 전후 비교용 — **지금 코드의 프롬프트로 실제 파이프라인을 돌려** 극성 분포와
 * 대표 인용 일치율을 원본 발행 보고서와 대조한다.
 *
 * `check:qualitative-fidelity`는 **이미 DB에 저장된 결과**를 채점한다(무료, 과거 시점).
 * 이 스크립트는 **지금 프롬프트로 새로 생성**해서 잰다(유료, 현재 시점). 프롬프트를 고친 뒤
 * 좋아졌는지 확인하는 용도이므로, 결과를 DB에 저장하지 않는다 — 담당자가 보고 있는 보고서를
 * 건드리지 않기 위해서다.
 *
 *   npm run check:fast-polarity            # 기능 문항 6개(원본에 비율이 실린 문항)
 *   npm run check:fast-polarity -- 2       # 앞 2개만(비용 절감)
 *
 * ANTHROPIC_API_KEY 필요, 문항당 1회 호출.
 */
import { readFileSync } from "node:fs";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { runFastReportAnalysis } from "../lib/pipeline/fastReportAnalysis";
import {
  KR_BY_POLARITY,
  extractLabels,
  extractOriginalShares,
  matchesFeature,
  reportText,
  type Polarity,
} from "./publishedReport";

const RAW_DATA = "data/[리바랩스]사용성테스트 raw data.xlsx";
const POLARITIES = ["positive", "negative", "neutral"] as const;

function normalize(text: string): string {
  return text.replace(/[\s"'“”‘’·.,!?~()[\]]/g, "");
}

async function main() {
  const limit = Number(process.argv[2] ?? "6");
  const pdfText = reportText();
  const shares = extractOriginalShares(pdfText);
  const labels = extractLabels(pdfText);

  const buffer = readFileSync(new URL(`../${RAW_DATA}`, import.meta.url));
  const parsed = parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const specs = buildQuestionSpecs(records);

  // 원본에 극성 비율이 실린 문항만 비교 대상이다.
  const features = [...new Set(shares.map((share) => share.feature))].slice(0, limit);
  const errors: number[] = [];
  const predictions: { polarity: Polarity; quote: string }[] = [];
  // 보고서 인용문의 근거 강조(볼드+밑줄)가 실제로 붙는지 — 문항 단위로 통째로 비는 사고가
  // 있었다(2026-09-04). 비율만 보면 이 사고가 안 보인다.
  const highlight = { total: 0, marked: 0 };
  const quoteLengths: number[] = [];

  for (const feature of features) {
    const spec = specs.find((candidate) => candidate.kind === "standard" && matchesFeature(feature, candidate.label));
    if (!spec) {
      console.log(`${feature}: 대응하는 문항을 raw data에서 찾지 못해 건너뜁니다.`);
      continue;
    }
    const started = Date.now();
    // 문항 하나가 실패해도(모델이 clause_count 합계를 틀리면 파이프라인이 그 문항을 버린다)
    // 나머지 측정은 계속한다 — 실제 작업도 문항 단위로 재시도한다.
    let result;
    try {
      result = await runFastReportAnalysis(spec);
    } catch (error) {
      console.log(`${feature}: 생성 실패 — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const counts: Record<Polarity, number> = { positive: 0, negative: 0, neutral: 0 };
    if ("stage2ByPolarity" in result) {
      for (const [polarity, output] of Object.entries(result.stage2ByPolarity)) {
        for (const category of output?.categories ?? []) {
          counts[polarity as Polarity] += category.clause_count;
          for (const quote of category.quotes) {
            predictions.push({ polarity: polarity as Polarity, quote });
            quoteLengths.push(quote.length);
          }
          for (const display of category.quotesDisplay ?? []) {
            highlight.total += 1;
            if (display.includes("**__")) highlight.marked += 1;
          }
        }
      }
    }
    const total = POLARITIES.reduce((sum, polarity) => sum + counts[polarity], 0);
    const parts = POLARITIES.flatMap((polarity) => {
      const original = shares.find((share) => share.feature === feature && share.polarity === polarity)?.pct;
      if (original === undefined || total === 0) return [];
      const ours = (counts[polarity] / total) * 100;
      errors.push(Math.abs(ours - original));
      return [`${KR_BY_POLARITY[polarity]} ${original.toFixed(1)}→${ours.toFixed(1)}`];
    });
    console.log(`${feature} (${((Date.now() - started) / 1000).toFixed(0)}초): ${parts.join(" · ")}`);
  }

  // 대표 인용 일치율 — 방금 생성한 결과에서 원본 인용문을 찾는다(DB를 보지 않는다).
  const predictionByQuote = new Map<string, Polarity>();
  for (const prediction of predictions) {
    const key = normalize(prediction.quote);
    if (key && !predictionByQuote.has(key)) predictionByQuote.set(key, prediction.polarity);
  }
  const matched = labels.flatMap((label) => {
    const key = normalize(label.quote);
    const direct = predictionByQuote.get(key);
    if (direct) return [{ label, predicted: direct }];
    const containing = [...predictionByQuote.entries()].find(([quote]) => quote.includes(key) || key.includes(quote));
    return containing ? [{ label, predicted: containing[1] }] : [];
  });

  const rate = (hits: number, total: number) => (total === 0 ? "n/a" : `${((hits / total) * 100).toFixed(1)}% (${hits}/${total})`);
  const positiveScope = matched.filter((item) => item.label.polarity === "positive" || item.predicted === "positive");
  const positiveHits = positiveScope.filter((item) => (item.label.polarity === "positive") === (item.predicted === "positive")).length;
  const negNeu = matched.filter((item) => item.label.polarity !== "positive" && item.predicted !== "positive");
  const negNeuHits = negNeu.filter((item) => item.label.polarity === item.predicted).length;

  if (errors.length > 0) {
    const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    console.log(`\n문항별 극성 비율 평균 절대 오차: ${mae.toFixed(1)}%p (${errors.length}개 비교)`);
  }
  // 원본 발행 보고서의 인용문은 최대 129자다. 넘어가면 여러 논점이 한 덩어리로 실린 것이다.
  const over = quoteLengths.filter((length) => length > 130).length;
  console.log(`인용문 길이: 최대 ${Math.max(0, ...quoteLengths)}자, 130자 초과 ${over}건 / ${quoteLengths.length}건`);
  console.log(`근거 강조: 인용 ${highlight.total}건 중 ${highlight.marked}건 (${highlight.total ? Math.round((highlight.marked / highlight.total) * 100) : 0}%)`);
  console.log(`대표 인용 매칭 ${matched.length}건 — 긍정 vs 나머지 ${rate(positiveHits, positiveScope.length)}, 부정 vs 중립 ${rate(negNeuHits, negNeu.length)}`);
  process.exit(0);
}

void main();
