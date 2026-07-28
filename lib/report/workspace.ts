import type { ProductInfo } from "@/lib/productInfo/types";
import { richTextToHtml, richTextToInlineHtml } from "@/lib/report/richText";
import type { QuantStats } from "@/lib/quant/compute";
import type { CategoryCount } from "@/lib/quant/basic";
// 타입만 가져온다(import type) — reports.ts가 postgres를 import하지만, 타입 전용 import는
// 컴파일 시 제거되므로 클라이언트 번들에 DB 클라이언트가 딸려오지 않는다.
import type { QuestionWithApprovedCategories, CategoryRow, RecommendationRow } from "@/lib/db/reports";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import {
  chartBlock,
  headingBlock,
  groupedBarBlock,
  npsBlock,
  priorityReferenceBlock,
  quadrantBlock,
  rankCompositionBlock,
  radarBlock,
  stackedBarBlock,
  tableBlock,
  textBlock,
  richStaticBlock,
  PENDING_QUALITATIVE_NOTICE,
  type ReportSectionContent,
  type ReportBlock,
} from "@/lib/report/sections";

// --- 정성 데이터 → 원본 발행 보고서 형식 HTML (2026-07-26 연결, 원본 대조로 정밀화) ----------
// 사용자가 원본 보고서 페이지(펫 꾸미기 Q8 등)를 제시하며 "최대한 똑같게" 요청 — 그 형식은:
//   1. 긍정 의견 (33.3%)   ← 번호 + 극성 라벨 + %, 극성별 색상 배너
//   [카테고리명]           ← 대괄호, **건수 표시 없음**
//   "인용문"               ← 따옴표만, 글머리표(·) 없음
//   → 인사이트
// 배너 색상은 원본 이미지 기준: 긍정 연보라(#c0cdef, PDF chartBannerBg와 동일), 부정 연주황,
// 중립 연회색. RichReportEditor(contenteditable)가 인라인 style을 그대로 렌더링하고,
// domClipboard가 계산된 스타일을 굳혀 한글 붙여넣기에도 배경색이 유지된다.
const POLARITY_ORDER = ["positive", "negative", "neutral"] as const;
const POLARITY_LABEL: Record<string, string> = { positive: "긍정", negative: "부정", neutral: "중립" };
const POLARITY_BANNER: Record<string, { bg: string; color: string }> = {
  positive: { bg: "#c0cdef", color: "#1e293b" },
  negative: { bg: "#fde4d0", color: "#c2410c" },
  neutral: { bg: "#e8e8e8", color: "#52525b" },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function polarityBannerHtml(polarity: string, index: number, pct: string): string {
  const s = POLARITY_BANNER[polarity];
  return `<p style="background-color:${s.bg};color:${s.color};font-weight:700;padding:4pt 8pt;margin:10pt 0 6pt"><strong>${index}. ${POLARITY_LABEL[polarity]} 의견 (${pct}%)</strong></p>`;
}

// 카테고리 사이 "빈 줄"은 CSS margin으로 주면 안 된다 — 한글(HWP)은 붙여넣기 시 문단
// margin을 무시(또는 축소)해서, 화면엔 간격이 보여도 복사하면 카테고리들이 다닥다닥
// 붙어버린다(2026-07-28 사용자 실측). 그래서 각 카테고리 끝에 **진짜 빈 문단**을 넣는다 —
// 브라우저 기본 복사(드래그 선택)도, 우리 직렬화기(전체 복사 버튼)도 이 빈 <p>를 그대로
// 실어 한글에서 빈 줄로 렌더된다. 위쪽 여백(margin-top)은 이 빈 문단이 대신하므로 라벨의
// top margin은 0으로 둔다(빈 줄이 이중으로 커지지 않게).
// 빈 줄은 `<br>`만 든 문단이 아니라 `&nbsp;`(실제 내용)를 넣은 문단으로 만든다 — 브라우저가
// 드래그 선택을 클립보드 HTML로 직렬화할 때 "내용 없는 문단"은 정규화로 제거해버리는 경우가
// 있어(2026-07-28 사용자 재보고), 실제 문자(nbsp)가 있으면 문단이 살아남아 한글에서 빈 줄로
// 렌더된다.
const BLANK_LINE_HTML = `<p style="margin:0">&nbsp;</p>`;

function categoryHtml(cat: CategoryRow): string[] {
  // 한글 붙여넣기에서 CSS font-weight만으로는 굵게가 유지되지 않는 사례가 있어,
  // 인라인 스타일과 실제 의미 태그를 반드시 함께 낸다.
  const out = [`<p style="font-weight:700;margin:0 0 2pt"><strong>[${richTextToInlineHtml(cat.label)}]</strong></p>`];
  for (const quote of cat.quotes.slice(0, 3)) out.push(`<p style="margin:0 0 2pt">"${richTextToInlineHtml(quote)}"</p>`);
  out.push(`<p style="font-weight:700;font-style:italic;margin:0 0 2pt"><strong><em>→ ${richTextToInlineHtml(cat.insight_final ?? cat.insight_draft)}</em></strong></p>`);
  out.push(BLANK_LINE_HTML);
  return out;
}

// --- 원본 14페이지 "주관식 응답 감정 분석"(반원 도넛 + %표) + "응답 요약" (2026-07-26 추가) ---
// 도넛 색상은 원본 이미지 기준(배너보다 살짝 진한 톤). 도넛은 표시 전용이라 data-copy-ignore로
// 감싸 "서식 유지 복사" 대상에서 뺀다(SVG는 한글 붙여넣기에 안 실리므로 %표/요약 텍스트가 수치를
// 전달한다).
const DONUT_COLOR: Record<string, string> = { positive: "#5b73c4", negative: "#e07a3f", neutral: "#b8b8b8" };

function polarXY(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

/** 긍정/부정/중립 비율을 반원 도넛 게이지 SVG 문자열로 만든다(원본 감정분석 차트 형식). */
function donutSvg(counts: Record<string, number>): string {
  const cx = 110, cy = 112, R = 95, Ri = 56;
  const total = counts.positive + counts.negative + counts.neutral;
  if (total <= 0) return "";
  const paths: string[] = [];
  const labels: string[] = [];
  let a = 180;
  for (const pol of POLARITY_ORDER) {
    const frac = counts[pol] / total;
    if (frac <= 0) continue;
    const a0 = a;
    const a1 = a - frac * 180;
    const [ox0, oy0] = polarXY(cx, cy, R, a0);
    const [ox1, oy1] = polarXY(cx, cy, R, a1);
    const [ix1, iy1] = polarXY(cx, cy, Ri, a1);
    const [ix0, iy0] = polarXY(cx, cy, Ri, a0);
    paths.push(
      `<path d="M ${ox0.toFixed(1)} ${oy0.toFixed(1)} A ${R} ${R} 0 0 1 ${ox1.toFixed(1)} ${oy1.toFixed(1)} L ${ix1.toFixed(1)} ${iy1.toFixed(1)} A ${Ri} ${Ri} 0 0 0 ${ix0.toFixed(1)} ${iy0.toFixed(1)} Z" fill="${DONUT_COLOR[pol]}"/>`,
    );
    const [lx, ly] = polarXY(cx, cy, (R + Ri) / 2, (a0 + a1) / 2);
    labels.push(
      `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${((frac) * 100).toFixed(1)}%</text>`,
    );
    a = a1;
  }
  return `<svg viewBox="0 0 220 128" width="220" height="128" xmlns="http://www.w3.org/2000/svg">${paths.join("")}${labels.join("")}</svg>`;
}

/** 긍정/부정/중립 % + 건수 표(원본 감정분석 하단 표 형식). */
function polarityTableHtml(counts: Record<string, number>): string {
  const total = counts.positive + counts.negative + counts.neutral;
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
  const head = (bg: string, text: string) =>
    `<td style="border:0.75pt solid #d4d4d8;padding:3pt 10pt;text-align:center;background-color:${bg};font-weight:700">${text}</td>`;
  const body = (n: number) =>
    `<td style="border:0.75pt solid #d4d4d8;padding:3pt 10pt;text-align:center">${pct(n)}%<br>(${n}건)</td>`;
  return `<table style="border-collapse:collapse;margin:4pt auto 8pt"><tbody><tr>${head("#c0cdef", "긍정")}${head("#fde4d0", "부정")}${head("#e8e8e8", "중립")}</tr><tr>${body(counts.positive)}${body(counts.negative)}${body(counts.neutral)}</tr></tbody></table>`;
}

/** 극성별 응답 요약([긍정/부정/중립 의견 요약])을 원본 "응답 요약" 박스 형식 HTML로 만든다. */
export function responseSummaryHtml(ps: Partial<Record<string, string>> | null | undefined, questionKey?: string): string {
  if (!ps) return "";
  const rows: string[] = [];
  const add = (pol: string, label: string) => {
    const text = ps[pol];
    if (text) rows.push(`<p style="font-weight:700;margin:6pt 0 2pt"><strong>[${label} 의견 요약]</strong></p><p style="margin:0 0 4pt">${richTextToInlineHtml(text)}</p>`);
  };
  add("positive", "긍정");
  add("negative", "부정");
  add("neutral", "중립");
  const content = rows.length === 0
    ? `<p style="margin:0;color:#9ca3af">정성 요약이 아직 없습니다. 이 박스의 AI 요약 생성 버튼으로 채울 수 있습니다.</p>`
    : rows.join("");
  return questionKey ? `<div data-summary-key="${escapeHtml(questionKey)}">${content}</div>` : content;
}

// --- 원본 8·11·14페이지 "만족도 분포도"(0~10점 세로 막대) + "주요 키워드 도출"(워드클라우드) ---
/** 0~10점 응답자 수 배열을 원본 "만족도 분포도" 세로 막대그래프 SVG로 그린다(웹 표시 전용 —
 * SVG라 한글 붙여넣기엔 안 실리고, 아래 감정분석 %표·키워드가 수치를 전달한다). */
function satisfactionHistogramSvg(distribution: number[]): string {
  const width = 320, height = 150, padTop = 16, padBottom = 18, padX = 6;
  const maxCount = Math.max(1, ...distribution);
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const slot = plotW / distribution.length;
  const barW = slot * 0.68;
  const baseY = padTop + plotH;
  const parts = distribution.map((count, i) => {
    const cx = padX + slot * i + slot / 2;
    const h = (count / maxCount) * plotH;
    const y = baseY - h;
    const valueLabel = count > 0
      ? `<text x="${cx.toFixed(1)}" y="${(y - 3).toFixed(1)}" font-size="8" text-anchor="middle" fill="#374151">${count}</text>`
      : "";
    return (
      `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="#7fdca4"/>` +
      valueLabel +
      `<text x="${cx.toFixed(1)}" y="${(height - 5).toFixed(1)}" font-size="8" text-anchor="middle" fill="#6b7280">${i}</text>`
    );
  });
  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="${padX}" y1="${baseY}" x2="${width - padX}" y2="${baseY}" stroke="#e5e7eb"/>${parts.join("")}</svg>`
  );
}

/** 정성 문항(question_key "feature:펫 꾸미기")을 정량 featureSatisfaction(name은 정식 표시명이라
 * 짧은 key와 다를 수 있음)에 어절 겹침으로 매칭한다 — 가장 많이 겹치는 항목을 고른다. */
function findFeatureStat(stats: QuantStats, question: QuestionWithApprovedCategories) {
  const key = question.question_key.replace(/^feature:/, "");
  const keyWords = new Set(key.split(/\s+/).filter((w) => w.length >= 2));
  let best: (typeof stats.featureSatisfaction)[number] | null = null;
  let bestScore = 0;
  for (const feature of stats.featureSatisfaction) {
    if (feature.name === key) return feature;
    const overlap = feature.name.split(/\s+/).filter((w) => keyWords.has(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = feature;
    }
  }
  return best;
}

/** 기능의 Q번호·문항 원문을 설문 항목 표에서 찾는다 — featureSatisfaction와 설문의 기능 행은
 * 둘 다 raw data 컬럼 순서(6·8·…16번)라, featureSatisfaction에서의 인덱스로 매칭한다. */
function findFeatureSurveyQuestion(stats: QuantStats, featureName: string): { qno: number; question: string } | null {
  const idx = stats.featureSatisfaction.findIndex((f) => f.name === featureName);
  if (idx < 0) return null;
  return findSurveyQuestion(stats, "기능별 고객 경험 평가", idx);
}

/** 원본 8~26페이지의 "1 기능별 고객 경험 조사 결과" 문항별 구성(2026-07-28 원본 재대조):
 * Q번호 문항 → 만족도 점수 평균/표준편차 배너 → [만족도 분포도 | 주요 키워드 도출] 2열 →
 * [주관식 응답 감정 분석 도넛+%표 | 응답 요약] 2열 → 1.긍정/2.부정/3.중립 상세 카테고리.
 * 도넛·히스토그램·키워드 클라우드는 SVG/표라 rich-static, 편집 대상 프로즈(카테고리)는 styled. */
function featureQualitativeBlocks(stats: QuantStats, idPrefix: string, questions: QuestionWithApprovedCategories[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let qi = 0;
  const border = "1px solid #d4d4d8";
  const panelHead = (title: string) => `<td style="width:50%;vertical-align:top;border:${border};padding:0"><p style="margin:0;background-color:#dfe6f7;color:#315c9c;font-weight:700;text-align:center;padding:5pt">${escapeHtml(title)}</p><div style="padding:6pt">`;
  for (const q of questions) {
    if (q.categories.length === 0) continue;
    qi += 1;
    const feature = findFeatureStat(stats, q);
    const survey = feature ? findFeatureSurveyQuestion(stats, feature.name) : null;
    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
    for (const c of q.categories) if (c.polarity) counts[c.polarity] += c.clause_count;

    // (1) Q번호 질문 헤딩(시안 밑줄). 원본은 "Q7. '펫 성장 시스템' 기능의 만족도는 몇 점입니까?"
    // 형식의 완전한 문장이다 — raw data 헤더는 짧은 라벨("… 기능 만족도")이라, Q번호는 설문
    // 표에서 도출하되 문장은 정식 표시명(feature.name)으로 표준 형식을 구성한다.
    blocks.push(headingBlock({
      id: `${idPrefix}-q${qi}-heading`,
      variant: "question",
      number: survey ? `Q${survey.qno}` : undefined,
      text: `'${feature?.name ?? q.label}' 기능의 만족도는 몇 점입니까?`,
    }));

    // (2) 만족도 점수 평균/표준편차 배너 + 만족도 분포도(전체 폭). 원본은 옆에 "주요 키워드
    // 도출" 워드클라우드가 있었지만 사용자 요청으로 제외했다(2026-07-28).
    const meanSdBanner = feature
      ? `<table style="border-collapse:collapse;width:100%;margin:0 0 8pt;font-size:13px"><tbody><tr>` +
        `<td style="width:66%;background-color:#dfe6f7;text-align:center;font-weight:700;padding:6pt;border:${border}">만족도 점수 평균 : ${feature.mean.toFixed(2)} / 10</td>` +
        `<td style="background-color:#dfe6f7;text-align:center;font-weight:700;padding:6pt;border:${border}">표준편차 : ${feature.sd.toFixed(2)}</td>` +
        `</tr></tbody></table>`
      : "";
    const histogram = feature?.scoreDistribution ? satisfactionHistogramSvg(feature.scoreDistribution) : `<p style="margin:0;color:#9ca3af;text-align:center">분포 데이터 없음</p>`;
    blocks.push(richStaticBlock({
      id: `${idPrefix}-q${qi}-scorebox`,
      html: meanSdBanner +
        `<table style="border-collapse:collapse;width:100%;margin:0 0 10pt"><tbody><tr>` +
        `<td style="vertical-align:top;border:${border};padding:0"><p style="margin:0;background-color:#dfe6f7;color:#315c9c;font-weight:700;text-align:center;padding:5pt">만족도 분포도</p><div style="padding:6pt;text-align:center">${histogram}</div></td>` +
        `</tr></tbody></table>`,
    }));

    // (3) [감정 분석 도넛+%표 | 응답 요약] 2열.
    const donut = donutSvg(counts);
    blocks.push(richStaticBlock({
      id: `${idPrefix}-q${qi}-emotionbox`,
      html: `<table style="border-collapse:collapse;width:100%;margin:0 0 10pt"><tbody><tr>` +
        `${panelHead("주관식 응답 감정 분석")}${donut ? `<div style="text-align:center">${donut}</div>` : ""}${polarityTableHtml(counts)}</div></td>` +
        `${panelHead("응답 요약")}${responseSummaryHtml(q.polarity_summaries, q.question_key)}</div></td>` +
        `</tr></tbody></table>`,
      summaryQuestionKey: q.question_key,
      summaryKind: "polarity",
    }));

    // (4) 1.긍정 / 2.부정 / 3.중립 상세 카테고리(편집 가능한 styled 블록).
    const restParts: string[] = [];
    const total = counts.positive + counts.negative + counts.neutral;
    let bannerIndex = 0;
    for (const pol of POLARITY_ORDER) {
      const cats = q.categories.filter((c) => c.polarity === pol);
      if (cats.length === 0) continue;
      bannerIndex += 1;
      const pct = total ? ((counts[pol] / total) * 100).toFixed(1) : "0.0";
      restParts.push(polarityBannerHtml(pol, bannerIndex, pct));
      for (const cat of cats) restParts.push(...categoryHtml(cat));
    }
    blocks.push(textBlock({ id: `${idPrefix}-q${qi}-detail`, label: q.label, html: restParts.join(""), styled: true }));
  }
  return blocks.length
    ? blocks
    : [textBlock({ id: idPrefix, label: "기능별 고객 경험 분석", html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true })];
}

/** 문항 목록을 원본 발행 형식 블록 목록으로 만든다. 극성이 있는 문항은 (1) 질문 라벨+"감정분석"
 * 소제목, (2) 감정분석 도넛+%표, (3) 응답 요약+"1.긍정 / 2.부정 / 3.중립" 상세 배너 순으로 원본
 * 14~16페이지 구성을 그대로 따른다. 극성이 없는 개선아이디어 문항은 카테고리만 나열한다.
 *
 * **도넛(SVG)+%표(TABLE)를 styled 텍스트 블록과 분리해 rich-static 블록으로 낸다(2026-07-27
 * 실측 확인)** — RichReportEditor의 sanitizeReportHtml은 편집기에 필요한 최소 태그만 허용해서
 * SVG/TABLE을 자식 노드로 풀어버린다(`element.replaceWith(...element.childNodes)`). 이 함수가
 * 예전처럼 도넛+표를 다른 프로즈와 한 HTML 문자열로 합쳐 하나의 styled 블록으로 냈을 때, 실제로
 * 헤드리스 브라우저로 재현해보니 도넛은 "29.0%42.1%29.0%"처럼 숫자만 남고 표는
 * "긍정부정중립29.0%<br>(64건)..."처럼 칸 구분 없이 뭉개진 텍스트로 깨졌다 — 화면에 보이는
 * 순간부터 이미 깨져 있고, "브라우저 서식 복사"/"한글 서식 파일"도 그 깨진 DOM을 그대로
 * 복사하므로 한글(HWP)에도 같은 잡음이 그대로 들어간다. rich-static은 sanitizer를 거치지 않고
 * `dangerouslySetInnerHTML`로 그대로 렌더링하고(개요 표와 같은 경로), 진짜 `<table>`/`<svg>`
 * 요소가 DOM에 남으므로 도넛은 domClipboard의 SKIP_TAGS(SVG)로 복사에서 깔끔히 빠지고, 표는
 * domClipboard의 `walkTable`이 진짜 표(테두리·배경색 유지)로 변환해 한글에 그대로 들어간다.
 * 대신 편집이 필요한 질문 라벨·응답 요약·카테고리/인용문/인사이트는 여전히 styled 블록으로 남겨
 * RichReportEditor에서 수정할 수 있게 한다. */
function qualitativeBlocks(idPrefix: string, questions: QuestionWithApprovedCategories[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let qi = 0;
  for (const q of questions) {
    if (q.categories.length === 0) continue;
    qi += 1;
    const hasPolarity = q.categories.some((c) => c.polarity);
    if (!hasPolarity) {
      const parts = [`<p style="font-weight:700;font-size:12pt;margin:14pt 0 4pt">${escapeHtml(q.label)}</p>`];
      for (const cat of q.categories) parts.push(...categoryHtml(cat));
      blocks.push(textBlock({ id: `${idPrefix}-q${qi}`, label: q.label, html: parts.join(""), styled: true }));
      continue;
    }
    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
    for (const c of q.categories) if (c.polarity) counts[c.polarity] += c.clause_count;

    // (1) 질문 라벨 + "주관식 응답 감정 분석" 소제목 — 편집 가능한 프로즈.
    blocks.push(
      textBlock({
        id: `${idPrefix}-q${qi}-intro`,
        label: q.label,
        html: `<p style="font-weight:700;font-size:12pt;margin:14pt 0 4pt">${escapeHtml(q.label)}</p><p style="font-weight:700;margin:8pt 0 2pt;color:#315c9c">주관식 응답 감정 분석</p>`,
        styled: true,
      }),
    );

    // (2) 도넛 + %표 — rich-static(sanitizer 우회)으로 그대로 렌더.
    const donut = donutSvg(counts);
    blocks.push(
      richStaticBlock({
        id: `${idPrefix}-q${qi}-chart`,
        html: `${donut ? `<div style="text-align:center">${donut}</div>` : ""}${polarityTableHtml(counts)}`,
      }),
    );

    // (3) 응답 요약 + 극성별 상세(1.긍정 / 2.부정 / 3.중립) — 편집 가능한 프로즈.
    const restParts: string[] = [responseSummaryHtml(q.polarity_summaries, q.question_key)];
    const total = counts.positive + counts.negative + counts.neutral;
    let bannerIndex = 0;
    for (const pol of POLARITY_ORDER) {
      const cats = q.categories.filter((c) => c.polarity === pol);
      if (cats.length === 0) continue;
      bannerIndex += 1;
      const pct = total ? ((counts[pol] / total) * 100).toFixed(1) : "0.0";
      restParts.push(polarityBannerHtml(pol, bannerIndex, pct));
      for (const cat of cats) restParts.push(...categoryHtml(cat));
    }
    blocks.push(textBlock({ id: `${idPrefix}-q${qi}-detail`, label: q.label, html: restParts.join(""), styled: true }));
  }
  return blocks;
}

/** 정성 데이터가 있으면 서식 보존 렌더링(styled+rich-static) 블록 목록으로, 없으면 기존처럼
 * "대기" 표시 블록 하나로 만든다. */
function qualitativeBlock(id: string, label: string, questions: QuestionWithApprovedCategories[]): ReportBlock[] {
  const blocks = qualitativeBlocks(id, questions);
  return blocks.length ? blocks : [textBlock({ id, label, html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true })];
}

/**
 * Ⅴ장(4대 가치 만족도)은 Ⅲ장의 기능별 고객 경험 평가와 표현 규칙이 다르다.
 *
 * 원본은 문항별 감정 비율 도넛·3분할 표·"1.긍정/2.부정/3.중립" 배너를 반복하지 않고,
 * 질문 아래에 긍정 의견과 부정 의견을 좌우 2단 박스로 배치한다. 따라서 공용
 * `qualitativeBlocks()`를 재사용하지 않고 Ⅴ장 전용 블록을 만든다. 중립 의견은 원본의
 * 두 칸 구조를 깨지 않도록 별도 차트로 만들지 않으며, 긍정/부정 모두 없는 경우에만 안내
 * 문구로 남긴다. 표 구조 자체는 rich-static으로 두어 병합·테두리·배경색을 보존하고 웹에서
 * 각 셀을 직접 편집할 수 있다.
 */
function valueOpinionColumnHtml(title: string, background: string, categories: CategoryRow[]): string {
  const body = categories.length
    ? categories.map((category) => categoryHtml(category).join("")).join("")
    : `<p style="margin:0;color:#6b7280">분석된 ${title} 의견이 없습니다.</p>`;
  return `<td style="width:50%;vertical-align:top;border:0.75pt solid #9db6e4;padding:10pt;background-color:#ffffff">
    <p style="margin:0 0 8pt;padding:5pt 8pt;background-color:${background};font-weight:700;text-align:center">${title} 의견</p>
    ${body}
  </td>`;
}

/** raw data 설문 항목(stats.surveyQuestions)에서 특정 단계(stage)의 n번째 문항 Q번호와
 * 실제 원문을 찾는다 — Ⅴ장 Q번호도 "raw data가 ground truth" 원칙(CLAUDE.md)을 따라
 * 하드코딩하지 않고 여기서 계산한다. */
function findSurveyQuestion(stats: QuantStats, stage: string, occurrenceIndex: number): { qno: number; question: string } | null {
  let qno = 0;
  let seen = 0;
  for (const row of stats.surveyQuestions) {
    qno += 1;
    if (row.stage === stage) {
      if (seen === occurrenceIndex) return { qno, question: row.question };
      seen += 1;
    }
  }
  return null;
}

/** 원본 32~35쪽 "평균|표준편차" 2열 미니 표. */
function valueMeanSdTableHtml(mean: number, sd: number): string {
  const border = "1px solid #d4d4d8";
  return (
    `<table style="border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:13px">` +
    `<thead><tr><th style="background-color:#dfe6f7;padding:6pt;border:${border}">평균</th><th style="background-color:#dfe6f7;padding:6pt;border:${border}">표준편차</th></tr></thead>` +
    `<tbody><tr><td style="text-align:center;padding:6pt;border:${border}">전체 ${mean.toFixed(2)}</td><td style="text-align:center;padding:6pt;border:${border}">${sd.toFixed(2)}</td></tr></tbody>` +
    `</table>`
  );
}

/** 원본 "[ {가치} 조사 결과 ]" 요약 박스.
 *
 * Ⅴ장에는 Ⅲ장의 긍정·부정·중립 총평을 그대로 나열하지 않는다. `combined`에는 가치 문항 전용
 * 프롬프트가 만든 3~4문장 존댓말 요약이 저장된다. 이전에 생성해 둔 보고서는 combined 키가
 * 없을 수 있으므로, 그 경우에만 기존 극성 요약을 읽는 호환 경로를 둔다. */
export function valueSummaryBoxHtml(label: string, summaries: Partial<Record<string, string>> | null | undefined): string {
  const text = summaries?.combined
    ?? (summaries
      ? (["positive", "negative", "neutral"] as const)
          .map((polarity) => summaries[polarity])
          .filter((value): value is string => Boolean(value))
          .join(" ")
      : "");
  // 가치 전용 프롬프트는 3~4문장을 줄바꿈으로 분리한다. 단순 <br>보다 실제 <p>가 한글의
  // 붙여넣기에서 문단/문단 간격으로 더 안정적으로 변환되므로 줄마다 문단을 만든다.
  // richTextToInlineHtml은 **__강조__**를 <strong><u>로 바꿔 HWP에도 강조 의미가 남는다.
  const formattedText = text.split(/\r?\n+/).filter(Boolean)
    .map((line) => `<p style="margin:0 0 5pt;line-height:1.65">${richTextToInlineHtml(line)}</p>`)
    .join("");
  return (
    `<table style="border-collapse:collapse;width:100%;margin:0 0 14pt"><tbody>` +
    `<tr><td style="background-color:#dfe6f7;color:#000000;font-weight:700;text-align:center;padding:6pt;border:1px solid #d4d4d8">[ ${escapeHtml(label)} 조사 결과 ]</td></tr>` +
    `<tr><td style="padding:8pt;border:1px solid #d4d4d8;line-height:1.6">${text ? formattedText : "정성 요약이 아직 없습니다. 이 박스의 AI 요약 생성 버튼으로 채울 수 있습니다."}</td></tr>` +
    `</tbody></table>`
  );
}

function fourValueQualitativeBlocks(stats: QuantStats, idPrefix: string, questions: QuestionWithApprovedCategories[]): ReportBlock[] {
  const valueRows: { key: "functional" | "aesthetic" | "economic" | "social"; label: string; mean: number; sd: number }[] = [
    { key: "functional", label: "기능적 가치", mean: stats.fourValues.functional.mean, sd: stats.fourValues.functional.sd },
    { key: "aesthetic", label: "심미적 가치", mean: stats.fourValues.aesthetic.mean, sd: stats.fourValues.aesthetic.sd },
    { key: "economic", label: "경제적 가치", mean: stats.fourValues.economic.mean, sd: stats.fourValues.economic.sd },
    { key: "social", label: "사회·공공적 가치", mean: stats.fourValues.social.mean, sd: stats.fourValues.social.sd },
  ];
  const blocks: ReportBlock[] = [];
  valueRows.forEach((value, index) => {
    const question = questions.find((q) => q.question_key === `values:${value.key}`);
    const survey = findSurveyQuestion(stats, "4대 가치 만족도 평가", index);
    const heading = survey ? `Q${survey.qno}. ${survey.question}` : `${value.label} 만족도`;
    blocks.push(headingBlock({ id: `${idPrefix}-q${index + 1}`, variant: "question", text: heading }));
    blocks.push(richStaticBlock({
      id: `${idPrefix}-meansd-${index + 1}`,
      html: `<p style="font-weight:700;margin:0 0 4pt">${escapeHtml(value.label)} 만족도</p>${valueMeanSdTableHtml(value.mean, value.sd)}`,
    }));
    if (question && question.categories.length > 0) {
      const positive = question.categories.filter((category) => category.polarity === "positive");
      const negative = question.categories.filter((category) => category.polarity === "negative");
      blocks.push(richStaticBlock({
        id: `${idPrefix}-opinion-box-${index + 1}`,
        html: `<table style="width:100%;border-collapse:collapse;margin:0 0 10pt"><tbody><tr>${valueOpinionColumnHtml("긍정", "#dce7fa", positive)}${valueOpinionColumnHtml("부정", "#fde4d0", negative)}</tr></tbody></table>`,
      }));
      blocks.push(richStaticBlock({
        id: `${idPrefix}-summary-${index + 1}`,
        html: valueSummaryBoxHtml(value.label, question.polarity_summaries),
        summaryQuestionKey: question.question_key,
        summaryKind: "value",
      }));
    } else {
      blocks.push(textBlock({ id: `${idPrefix}-pending-${index + 1}`, label: `${value.label} 정성 분석`, html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true }));
    }
  });
  return blocks;
}

function questionsByKeyPrefix(qual: QuestionWithApprovedCategories[], prefix: string) {
  return qual.filter((q) => q.question_key.startsWith(prefix));
}
function questionsByKeys(qual: QuestionWithApprovedCategories[], keys: string[]) {
  return qual.filter((q) => keys.includes(q.question_key));
}

/**
 * 브라우저 편집 작업공간으로 넘기는 보고서 모델. Ⅰ~Ⅸ 섹션을 `buildReportPlan()`의 numeral/
 * title 뼈대에 실제 QuantStats 값을 채운 `chart`/`table`/`text` 블록 목록으로 만든다
 * (PRD 3.3.1, 2026-07-25 재구성). PDF/DOCX/HWPX 렌더러의 레이아웃 구현과는 분리돼 있다 —
 * 웹에서 문장이나 차트를 편집해도 기존 독립 PDF 렌더러를 변경하지 않는다.
 *
 * 정성 데이터(카테고리·인용문·인사이트)는 이번 재구성에서도 아직 연결하지 않는다 — DB에
 * 정성 분석이 승인된 테스트 보고서가 없어 검증할 수 없기 때문(2026-07-25 사용자 확인).
 * 정성이 들어갈 자리는 `pending: true` 텍스트 블록으로 정직하게 비워둔다.
 */
export type ReportWorkspaceSeed = {
  quantStats: QuantStats;
  productInfo?: ProductInfo | null;
  resultSummary?: string | null;
  sections: ReportSectionContent[];
};

function slug(label: string): string {
  return label.replace(/\s+/g, "-").replace(/[^\w가-힣-]/g, "");
}

/**
 * DB에 저장된 `quant_stats`는 그 report가 저장된 시점의 `computeQuantStats` 버전이 계산한
 * JSON 스냅샷이다 — 이후 `QuantStats`에 필드가 추가돼도 과거 report의 저장값은 소급 갱신되지
 * 않는다. 실측 확인(2026-07-25): 2026-07-20에 저장된 실제 report 하나로 이 라우트를 테스트해
 * 보니 `surveyQuestions`·`rankPositionComposition`·`demographics.genderByAgeBracket`
 * 세 필드가 빠져 있어 그대로 읽으면 크래시가 났다(각각 07-21·07-23에 추가된 필드). PDF
 * 렌더러는 이런 오래된 report를 다시 열 일이 없어 이 문제를 안 겪었지만, 웹 작업공간은
 * "언제 생성됐든 아무 report나 다시 열 수 있어야" 하므로 이 경계에서 한 번 정규화한다
 * (개별 섹션 빌더마다 `?? []`를 흩뿌리지 않고 진입점 하나에서 방어한다).
 */
function normalizeQuantStats(stats: QuantStats): QuantStats {
  return {
    ...stats,
    surveyQuestions: stats.surveyQuestions ?? [],
    rankPositionComposition: stats.rankPositionComposition ?? [],
    demographics: {
      ...stats.demographics,
      genderByAgeBracket: stats.demographics.genderByAgeBracket ?? [],
    },
  };
}

/** CategoryCount[](분포, % 단위) → 막대그래프 블록. 축 상한은 데이터 최댓값에 맞춰 자동으로 넉넉히 잡는다. */
function distributionChart(id: string, title: string, counts: CategoryCount[]): ReturnType<typeof chartBlock> {
  const items = counts.map((c) => ({ id: slug(c.label), label: c.label, value: c.percentage }));
  const dataMax = Math.max(...items.map((i) => i.value), 0);
  const axisMax = Math.min(100, Math.ceil(dataMax / 5) * 5 + 5);
  return chartBlock({ id, title, unit: "%", axisMax, items });
}

/** 평균 점수 배열(0~10점대) → 막대그래프 블록. */
function meanChart(id: string, title: string, items: { name: string; mean: number }[], unit = "점"): ReturnType<typeof chartBlock> {
  return chartBlock({
    id,
    title,
    unit,
    items: items.map((it) => ({ id: slug(it.name), label: it.name, value: it.mean })),
  });
}

function reportName(productInfo?: ProductInfo | null, fileName?: string | null): string {
  return productInfo?.serviceName ?? fileName?.replace(/\.[^.]+$/, "") ?? "사용성 테스트";
}

/** raw data 헤더에서 받은 실제 설문 문항을 Q 번호로 안전하게 찾는다.
 * 헤더가 없는 과거 데이터도 렌더링이 멈추지 않도록 기본 제목을 함께 둔다. */
function questionText(stats: QuantStats, questionNo: number, fallback: string): string {
  return stats.surveyQuestions[questionNo - 1]?.question || fallback;
}

/** 섹션 Ⅰ: 개요 — 제품 정보 표 + 설문 항목 표. 값이 없는 필드는 "입력 필요"로 남긴다(AI가 임의로 채우지 않는다는 원칙, PRD 5.0절). */
// --- Ⅰ. 개요 — PDF SectionOverview(lib/pdf/sectionsQuant.tsx)와 동일한 양식으로 렌더 --------
// PDF의 OverviewTable/SurveyQuestionTable은 라벨 셀이 연한 파랑(#dfe6f7)이고 병합 셀·테두리가
// 있는 진짜 표다. 웹의 EditableTable(열 헤더형, 회색 헤더)은 이 양식을 표현할 수 없어, 병합·
// 테두리·색상을 그대로 그리는 rich-static 블록으로 원본과 일치시킨다(2026-07-26 원본 대조).
const OVERVIEW = {
  labelBg: "#dfe6f7", // PDF OverviewTable LABEL_BG
  navy: "#315c9c", // colors.navy
  border: "#d4d4d8", // colors.border
  subtext: "#52525b", // colors.subtext (빈 값 "입력 필요")
  bannerBg: "#c0cdef", // colors.chartBannerBg (설문 표 헤더/푸터)
  stageBg: "#eef2fb", // 설문 표 단계(병합) 셀 배경
} as const;

type OverviewCell = { label: string; value?: string | null; wide?: boolean; alignLeft?: boolean; tall?: boolean };

/** PDF OverviewTable 재현: 상단 제목 배너 + 라벨(연파랑)/값 행. 한 행에 1개(wide) 또는 2개 쌍. */
function overviewTableHtml(title: string, rows: OverviewCell[][]): string {
  const border = `1px solid ${OVERVIEW.border}`;
  const cellHtml = (c: OverviewCell, valueColSpan: number) => {
    const labelTd = `<td style="width:110px;background:${OVERVIEW.labelBg};font-weight:700;text-align:center;vertical-align:middle;padding:8px 6px;border:${border}">${escapeHtml(c.label)}</td>`;
    const align = c.alignLeft ? "left" : "center";
    const valign = c.tall ? "top" : "middle";
    const extra = c.tall ? "height:150px;" : "";
    const span = valueColSpan > 1 ? ` colspan="${valueColSpan}"` : "";
    const valueTd = c.value
      ? `<td${span} style="padding:8px 10px;border:${border};text-align:${align};vertical-align:${valign};line-height:1.5;${extra}">${escapeHtml(c.value)}</td>`
      : `<td${span} style="padding:8px 10px;border:${border};text-align:${align};vertical-align:${valign};color:${OVERVIEW.subtext};${extra}">입력 필요</td>`;
    return labelTd + valueTd;
  };
  const body = rows
    .map((cells) => {
      // 4열 기준: 1개(wide) 셀이면 값이 3열을 차지, 2개 쌍이면 각 값이 1열.
      const inner = cells.map((c) => cellHtml(c, cells.length === 1 ? 3 : 1)).join("");
      return `<tr>${inner}</tr>`;
    })
    .join("");
  return (
    `<table style="border-collapse:collapse;width:100%;border:${border};font-size:13px;color:#111827;margin:0 0 14px">` +
    `<tbody>` +
    `<tr><td colspan="4" style="background:${OVERVIEW.labelBg};text-align:center;font-weight:700;color:${OVERVIEW.navy};padding:8px 5px;border:${border}">${escapeHtml(title)}</td></tr>` +
    body +
    `</tbody></table>`
  );
}

/** PDF OverviewBullet 재현: • 라벨 : 값 (빈 값은 "입력 필요" 회색). */
function overviewBulletsHtml(items: { label: string; value?: string | null }[]): string {
  const rows = items
    .map((it) => {
      const value = it.value
        ? `<span>${escapeHtml(it.value)}</span>`
        : `<span style="color:${OVERVIEW.subtext}">입력 필요</span>`;
      return `<p style="margin:0 0 5px;font-size:13px;line-height:1.5"><span style="font-weight:700">• ${escapeHtml(it.label)} : </span>${value}</p>`;
    })
    .join("");
  return `<div style="padding:2px 4px 6px">${rows}</div>`;
}

/** PDF SurveyQuestionTable 재현: 단계(병합) | Q번호 | 주요 활동 3열 + "총 N 문항" 푸터.
 * HTML은 rowspan이 있어 단계 셀을 진짜 병합 셀로 그린다(PDF는 flex 가중치로 흉내). */
function surveyTableHtml(surveyQuestions: { stage: string; question: string }[]): string {
  const border = `1px solid ${OVERVIEW.border}`;
  const headTh = (label: string, width?: string) =>
    `<th style="${width ? `width:${width};` : ""}background:${OVERVIEW.bannerBg};color:${OVERVIEW.navy};font-weight:700;text-align:center;padding:8px 5px;border:${border}">${label}</th>`;
  if (!surveyQuestions.length) {
    return (
      `<table style="border-collapse:collapse;width:100%;border:${border};font-size:13px;color:#111827">` +
      `<thead><tr>${headTh("단계", "120px")}${headTh("문항", "60px")}${headTh("주요 활동")}</tr></thead>` +
      `<tbody><tr><td colspan="3" style="padding:12px;text-align:center;color:${OVERVIEW.subtext};border:${border}">raw data 헤더를 확인하면 설문 문항이 표시됩니다.</td></tr></tbody></table>`
    );
  }
  // 연속된 같은 단계를 그룹으로 묶어 rowspan 계산.
  const stages = surveyQuestions.reduce<{ stage: string; questions: string[] }[]>((acc, row) => {
    const last = acc[acc.length - 1];
    if (last && last.stage === row.stage) last.questions.push(row.question);
    else acc.push({ stage: row.stage, questions: [row.question] });
    return acc;
  }, []);
  let qno = 0;
  const bodyRows: string[] = [];
  for (const stage of stages) {
    stage.questions.forEach((q, qi) => {
      qno += 1;
      const stageCell =
        qi === 0
          ? `<td rowspan="${stage.questions.length}" style="width:120px;background:${OVERVIEW.stageBg};font-weight:700;text-align:center;vertical-align:middle;padding:6px;border:${border}">${escapeHtml(stage.stage)}</td>`
          : "";
      bodyRows.push(
        `<tr>${stageCell}` +
          `<td style="width:60px;font-weight:700;text-align:center;padding:6px 5px;border:${border}">Q${qno}</td>` +
          `<td style="padding:6px 10px;border:${border};line-height:1.4">${escapeHtml(q)}</td></tr>`,
      );
    });
  }
  return (
    `<table style="border-collapse:collapse;width:100%;border:${border};font-size:13px;color:#111827">` +
    `<thead><tr>${headTh("단계", "120px")}${headTh("문항", "60px")}${headTh("주요 활동")}</tr></thead>` +
    `<tbody>${bodyRows.join("")}` +
    `<tr><td colspan="3" style="background:${OVERVIEW.bannerBg};color:${OVERVIEW.navy};font-weight:700;text-align:center;padding:8px;border:${border}">총 ${qno} 문항</td></tr>` +
    `</tbody></table>`
  );
}

function buildOverviewSection(stats: QuantStats, productInfo: ProductInfo | null | undefined, fileName: string | null | undefined): ReportBlock[] {
  const serviceName = reportName(productInfo, fileName);
  return [
    headingBlock({ id: "overview-h1", variant: "numbered", number: "1", text: "제품 소개" }),
    richStaticBlock({
      id: "overview-company",
      html: overviewTableHtml("기업 개요", [
        [
          { label: "기업명", value: productInfo?.companyName },
          { label: "홈페이지", value: productInfo?.homepage },
        ],
        [
          { label: "대표자", value: productInfo?.representative },
          { label: "업무 담당자", value: productInfo?.contactPerson },
        ],
      ]),
    }),
    richStaticBlock({
      id: "overview-service",
      html: overviewTableHtml("제품 및 서비스 개요", [
        [{ label: "서비스 명", value: productInfo?.serviceName ?? serviceName, wide: true }],
        [{ label: "서비스 요약", value: productInfo?.serviceSummary, wide: true, alignLeft: true }],
        [
          { label: "사업 영역", value: productInfo?.businessArea },
          { label: "산업 분야", value: productInfo?.industry },
        ],
        [
          { label: "운영 환경", value: productInfo?.operatingEnvironment },
          { label: "사업화 단계", value: productInfo?.businessStage },
        ],
        [{ label: "주요 기능", value: productInfo?.mainFeatures, wide: true, alignLeft: true, tall: true }],
      ]),
    }),
    headingBlock({ id: "overview-h2", variant: "numbered", number: "2", text: "사용성 테스트 진행 일정" }),
    richStaticBlock({
      id: "overview-schedule",
      html: overviewBulletsHtml([
        { label: "일  시", value: productInfo?.testPeriod },
        { label: "테스트 대상", value: productInfo?.testTarget ?? `${stats.respondentCount}명` },
        { label: "담당자", value: productInfo?.testManager },
      ]),
    }),
    headingBlock({ id: "overview-h3", variant: "numbered", number: "3", text: "사용성 테스트 설문 항목" }),
    richStaticBlock({
      id: "overview-survey",
      html: surveyTableHtml(stats.surveyQuestions ?? []),
    }),
  ];
}

/** 섹션 Ⅱ: 인적 사항 및 특성 조사 — 나이·성별·운영체제·걷기 습관 전부(기존엔 나이·성별만 표시되던 누락 보강). */
function buildDemographicsSection(stats: QuantStats): ReportBlock[] {
  const d = stats.demographics;
  const ageBracketNames = d.genderByAgeBracket[0]?.segments.map((s) => s.name) ?? [];
  const ageColors = ["#ffe392", "#aacef0", "#facaa8", "#c9c9c9", "#a8d6b5", "#cbb4e3"];
  return [
    headingBlock({ id: "demo-q1", variant: "question", number: "Q1", text: questionText(stats, 1, "나이를 입력해주세요") }),
    distributionChart("demo-age", "나이 분포", d.ageDistribution),
    headingBlock({ id: "demo-q2", variant: "question", number: "Q2", text: questionText(stats, 2, "성별을 선택해주세요") }),
    distributionChart("demo-gender", "성별 분포", d.gender),
    stackedBarBlock({
      id: "demo-gender-by-age",
      title: "성별별 연령대 구성",
      unit: "명",
      axisMax: Math.max(10, ...d.genderByAgeBracket.map((row) => row.segments.reduce((sum, segment) => sum + segment.count, 0))),
      categories: ageBracketNames.map((name, index) => ({ name, color: ageColors[index % ageColors.length] })),
      rows: d.genderByAgeBracket.map((row) => ({ label: row.label, segments: row.segments.map((segment) => ({ name: segment.name, value: segment.count })) })),
    }),
    headingBlock({ id: "demo-q3", variant: "question", number: "Q3", text: questionText(stats, 3, "현재 사용하시는 스마트폰 운영체제를 선택해주세요") }),
    distributionChart("demo-os", "운영체제 분포", d.os),
    headingBlock({ id: "demo-q4", variant: "question", number: "Q4", text: questionText(stats, 4, "하루 평균 걷는 시간은 어느 정도인가요?") }),
    distributionChart("demo-walktime", "하루 평균 걷는 시간", d.avgWalkTime),
    headingBlock({ id: "demo-q5", variant: "question", number: "Q5", text: questionText(stats, 5, "일주일에 몇 일 정도 산책을 하시나요?") }),
    distributionChart("demo-walkfreq", "일주일 걷기 빈도", d.walkFrequencyPerWeek),
    tableBlock({
      id: "demo-cross",
      title: "성별 × 연령대 교차표",
      headers: ["성별", ...ageBracketNames],
      rows: d.genderByAgeBracket.map((row) => [row.label, ...row.segments.map((s) => s.count)]),
    }),
    tableBlock({
      id: "demo-prior-service",
      title: "유사 서비스 경험",
      headers: ["경험자 비율", "경험자 평균 만족도", "표준편차"],
      rows: [[`${d.priorServiceExperienceRate}%`, d.priorServiceSatisfaction.mean, d.priorServiceSatisfaction.sd]],
    }),
  ];
}

/** 섹션 Ⅲ: 기능별 고객 경험 평가 — 정량(만족도·순위)만, 정성(카테고리·인용문)은 대기 표시. */
/** PDF `EditableQuadrantChart.tsx`의 `priorityColor`와 동일한 공식 — 9칸 우선순위 점수를
 * 하나로 유지해야 사분면 차트·범례·해석 텍스트의 색/등급이 서로 어긋나지 않는다. */
function classifyPriority(importance: number, satisfaction: number): { score: number; label: string } {
  const columnScore = importance < -2 ? 0 : importance < 2 ? 1 : 2;
  const rowScore = satisfaction >= 8 ? 0 : satisfaction >= 6 ? 1 : 2;
  const score = columnScore + rowScore - 2;
  const label = score >= 2 ? "최상" : score === 1 ? "상" : score === 0 ? "중" : score === -1 ? "하" : "최하";
  return { score, label };
}

/** 순위 기반 서술(가장 높은/다소 높은/보통의/낮은/가장 낮은) — 원본 29쪽 문구 패턴과 동일. */
function rankPhrase(rank: number, total: number): string {
  if (rank === 1) return "가장 높은";
  if (rank === 2) return "다소 높은";
  if (rank === total) return "가장 낮은";
  if (rank === total - 1) return "낮은";
  return "보통의";
}
function satisfactionPhrase(rank: number, total: number): string {
  if (rank === 1) return "높은";
  if (rank === total) return "가장 낮은";
  if (rank <= Math.ceil(total / 3)) return "보통 이상의";
  if (rank >= total - Math.ceil(total / 3) + 1) return "중하위";
  return "보통의";
}

/** Ⅲ장 "2 기능별 고객 경험 분석"의 "[종합 해석]" + "우선순위별 기능 분류" — 정량(상대중요도·
 * 만족도)과 이미 저장된 정성 카테고리(부정 라벨)만으로 만드는 규칙 기반 해석이다. 원본처럼
 * "왜 이 순서로 개선해야 하는지"를 사분면 우선순위 점수로 정렬해 설명하고, 근거로 쓰는 부정
 * 카테고리 라벨은 이미 Stage2가 만든 것을 그대로 인용한다 — 새 LLM 호출이나 임의 해석(예:
 * "핵심 세그먼트" 같은 비즈니스 판단)은 추가하지 않는다(2026-07-28, project_report_format_
 * fidelity 메모의 "일반화 불가능한 해석은 뺀다" 원칙과 동일). */
function buildFeatureAnalysisText(
  stats: QuantStats,
  rankedImportance: { name: string; score: number }[],
  featureQual: QuestionWithApprovedCategories[],
): string {
  const total = stats.featureSatisfaction.length;
  const satisfactionRank = new Map(
    [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean).map((f, i) => [f.name, i + 1]),
  );
  const importanceRank = new Map(rankedImportance.map((f, i) => [f.name, i + 1]));

  const items = rankedImportance.map((imp) => {
    const feature = stats.featureSatisfaction.find((f) => f.name === imp.name);
    const satisfaction = feature?.mean ?? 0;
    const { score, label } = classifyPriority(imp.score, satisfaction);
    const negatives = featureQual
      .find((q) => q.label.includes(imp.name))
      ?.categories.filter((c) => c.polarity === "negative")
      .slice(0, 2)
      .map((c) => c.label) ?? [];
    return { name: imp.name, importance: imp.score, satisfaction, score, label, negatives };
  });

  const topSatisfaction = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean)[0];
  const topSatisfactionImportanceRank = importanceRank.get(topSatisfaction?.name ?? "") ?? 0;
  const worstBoth = items.find((it) => importanceRank.get(it.name) === total && satisfactionRank.get(it.name) === total);

  const summaryLines: string[] = [];
  if (topSatisfaction && topSatisfactionImportanceRank > Math.ceil(total / 2)) {
    summaryLines.push(`• '${topSatisfaction.name}'의 경우 만족도는 가장 높지만 중요도는 상대적으로 낮음.`);
  }
  if (worstBoth) {
    summaryLines.push(`• '${worstBoth.name}'는 만족도·중요도 모두 낮은 특징을 보임.`);
  }
  const urgent = items.filter((it) => it.score >= 1 && (satisfactionRank.get(it.name) ?? 0) > Math.ceil(total / 2));
  if (urgent.length > 0) {
    summaryLines.push(
      `• 상대 중요도-만족도 그래프를 통해, ${urgent.map((it) => `'${it.name}'`).join("·")} 기능은 중요도에 비해 만족도가 충분히 높지 않아 개선이 시급함`,
    );
  }

  const groups: { title: string; items: typeof items }[] = [
    { title: "우선 개선 기능", items: items.filter((it) => it.score >= 1) },
    { title: "차우선 개발 기능", items: items.filter((it) => it.score === 0) },
    { title: "비우선 개발 기능", items: items.filter((it) => it.score <= -1) },
  ];

  const parts: string[] = [`<p style="font-weight:700;margin:6pt 0 4pt">[종합 해석]</p>`];
  for (const line of summaryLines) parts.push(`<p style="margin:0 0 3pt">${escapeHtml(line)}</p>`);

  for (const group of groups) {
    if (group.items.length === 0) continue;
    parts.push(`<p style="font-weight:700;margin:10pt 0 4pt">▶ ${escapeHtml(group.title)}</p>`);
    group.items.forEach((it, i) => {
      const impRank = importanceRank.get(it.name) ?? 0;
      const satRank = satisfactionRank.get(it.name) ?? 0;
      parts.push(
        `<p style="margin:0 0 2pt">${i + 1}. '${escapeHtml(it.name)}' 기능의 경우 ${rankPhrase(impRank, total)} 상대 중요도(${it.importance >= 0 ? "+" : ""}${it.importance.toFixed(2)})와 ${satisfactionPhrase(satRank, total)} 만족도(${it.satisfaction.toFixed(2)})를 가짐.</p>`,
      );
      if (it.negatives.length > 0) {
        parts.push(`<p style="margin:0 0 6pt">→ ${it.negatives.map(escapeHtml).join(", ")} 관련 니즈 확인</p>`);
      }
    });
  }
  return parts.join("");
}

function buildFeatureSection(stats: QuantStats, qual: QuestionWithApprovedCategories[]): ReportBlock[] {
  const ranked = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean);
  const featureQual = questionsByKeyPrefix(qual, "feature:");
  const rankedImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const segmentNames = [...new Set(stats.rankPositionComposition.flatMap((row) => row.segments.map((segment) => segment.name)))];
  const rankPalette = ["#ff7b7b", "#58b1cf", "#9bcdb8", "#5fc5c1", "#c890d5", "#ffe39a", "#aeb8c8", "#f5ad80"];
  return [
    headingBlock({ id: "feature-result-heading", variant: "numbered", number: "1", text: "기능별 고객 경험 조사 결과" }),
    // 원본 8~26쪽: "1 기능별 고객 경험 조사 결과" 맨 앞은 문항별(Q6~Q11) 상세다 — 평균/표준편차
    // 배너, 만족도 분포도, 주요 키워드 도출, 감정분석 도넛+응답요약, 1.긍정/2.부정/3.중립
    // (2026-07-28 원본 재대조로 이 위치·구성 확정).
    ...featureQualitativeBlocks(stats, "feature-qualitative", featureQual),
    // 원본 27쪽: 문항별 상세 뒤에 "기능별 만족도 조사 결과" 종합 차트 + 순위표.
    headingBlock({ id: "feature-satisfaction-heading", variant: "subheading", text: "기능별 만족도" }),
    meanChart("feature-satisfaction", "기능별 만족도 조사 결과", ranked),
    tableBlock({
      id: "feature-rank-table",
      title: "기능별 만족도 순위 종합",
      headers: ["순위", "기능", "평균 만족도", "표준편차"],
      rows: ranked.map((f, i) => [i + 1, f.name, f.mean, f.sd]),
    }),
    // 원본 27~28쪽: Q12(기능 중요도 순위) 콘텐츠 — 순위 구성·중요 순위 종합·사분면·영역별 참고
    // 지표. 예전엔 이게 Ⅳ장(핵심구매요소)에 잘못 들어가 있었다(2026-07-28 원본 재대조로 이동).
    headingBlock({ id: "feature-q12", variant: "question", number: "Q12", text: questionText(stats, 12, "기능 중 중요하다고 생각되는 순위를 순서대로 작성해주세요") }),
    rankCompositionBlock({
      id: "feature-rank-composition",
      title: "기능 중요도 순위 구성",
      candidates: segmentNames.map((name, index) => ({ name, color: rankPalette[index % rankPalette.length] })),
      rows: stats.rankPositionComposition.map((row) => ({
        rank: row.rank,
        segments: segmentNames.map((name) => ({ name, percentage: row.segments.find((segment) => segment.name === name)?.percentage ?? 0 })),
      })),
    }),
    tableBlock({
      id: "feature-importance-table",
      title: "기능별 중요 순위 종합",
      headers: ["순위", "기능", "상대 중요도"],
      rows: rankedImportance.map((item, i) => [`${i + 1}위`, item.name, item.score]),
    }),
    quadrantBlock({
      id: "feature-importance-satisfaction-quadrant",
      title: "기능별 상대 중요도-만족도 그래프",
      items: rankedImportance.map((item) => ({
        id: slug(item.name),
        name: item.name,
        importance: item.score,
        satisfaction: stats.featureSatisfaction.find((feature) => feature.name === item.name)?.mean ?? 0,
      })),
    }),
    priorityReferenceBlock({ id: "feature-priority-reference", title: "영역별 참고 지표" }),
    // 원본 29쪽: "2 기능별 고객 경험 분석"은 종합 해석 텍스트만(문항별 상세는 위 "1"에 있다).
    headingBlock({ id: "feature-analysis-heading", variant: "numbered", number: "2", text: "기능별 고객 경험 분석" }),
    textBlock({
      id: "feature-analysis-summary",
      label: "기능별 중요 순위 및 만족도 종합 해석",
      html: buildFeatureAnalysisText(stats, rankedImportance, featureQual),
      styled: true,
    }),
  ];
}

/** 섹션 Ⅳ: 핵심구매요소 — 원본 30~31쪽은 사분면 없이 응답분포+표+분석 텍스트만 있다
 * (2026-07-28 원본 재대조 — 예전엔 여기에 기능 중요도 순위구성·사분면이 잘못 들어가 있었다.
 * relativeImportance/rankPositionComposition은 Q12 "기능(펫과의 산책 등) 중요도" 데이터라
 * Ⅲ장 소속이고, Ⅳ장의 핵심구매요소는 Q13/Q16 "성취및보상요소" 같은 추상 요인이라 서로 다른
 * 데이터다 — buildFeatureSection으로 옮겼다). */
function buildCorePurchaseFactorSection(stats: QuantStats): ReportBlock[] {
  const rankedKeyFactors = [...stats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage);
  return [
    headingBlock({ id: "core-result-heading", variant: "numbered", number: "1", text: "핵심구매요소 조사 결과" }),
    headingBlock({ id: "core-q13", variant: "question", number: "Q13", text: questionText(stats, 13, "서비스를 이용 결정함에 있어서 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하십니까?") }),
    distributionChart("core-factor-dist", "핵심구매요소 조사 결과", stats.keyFactorDistribution),
    tableBlock({
      id: "core-factor-result-table",
      headers: ["No", "핵심 기능", "순위", "비율"],
      rows: rankedKeyFactors.map((item, i) => [i + 1, item.label, `${i + 1}위`, `${item.percentage}%`]),
    }),
  ];
}

/** Ⅴ장 "2"의 "[4대 가치 만족도 종합 해석]" — 원본 36쪽은 4개 가치의 긍정·부정 요지를
 * 하나의 문단으로 종합하는데, 그 정도의 자유서술 종합은 사람이 실제 내용을 읽고 판단해야
 * 안전하게 일반화된다(임의로 문단을 지어내면 특정 raw data에 안 맞을 위험이 큼 — 개요
 * 절의 "특정 프로젝트에 하드코딩하지 않는다" 원칙과 같은 이유). 대신 이미 저장된 부정
 * 카테고리 라벨을 가치별로 그대로 인용하는 불릿 형식으로 만든다 — Ⅲ장 해석과 같은 패턴. */
function buildFourValuesAnalysisText(
  rows: { label: string; mean: number; sd: number }[],
  qual: QuestionWithApprovedCategories[],
): string {
  const ranked = [...rows].sort((a, b) => b.mean - a.mean);
  const parts: string[] = [`<p style="font-weight:700;margin:6pt 0 4pt">[4대 가치 만족도 종합 해석]</p>`];
  parts.push(`<p style="margin:0 0 3pt">• '${escapeHtml(ranked[0].label)}'의 만족도가 ${ranked[0].mean.toFixed(2)}점으로 가장 높고, '${escapeHtml(ranked[ranked.length - 1].label)}'가 ${ranked[ranked.length - 1].mean.toFixed(2)}점으로 가장 낮음.</p>`);
  const valuesQual = questionsByKeyPrefix(qual, "values:");
  for (const row of ranked) {
    const question = valuesQual.find((q) => q.label.includes(row.label.replace("·", "")) || row.label.includes(q.label));
    const negatives = question?.categories.filter((c) => c.polarity === "negative").slice(0, 3).map((c) => c.label) ?? [];
    if (negatives.length > 0) {
      parts.push(`<p style="margin:0 0 3pt">• '${escapeHtml(row.label)}'(${row.mean.toFixed(2)}점): ${negatives.map(escapeHtml).join(", ")} 관련 개선 필요</p>`);
    }
  }
  return parts.join("");
}

/** 섹션 Ⅴ: 4대 가치 만족도. */
function buildFourValuesSection(stats: QuantStats, qual: QuestionWithApprovedCategories[]): ReportBlock[] {
  const rows: { label: string; mean: number; sd: number }[] = [
    { label: "기능적 가치", mean: stats.fourValues.functional.mean, sd: stats.fourValues.functional.sd },
    { label: "심미적 가치", mean: stats.fourValues.aesthetic.mean, sd: stats.fourValues.aesthetic.sd },
    { label: "경제적 가치", mean: stats.fourValues.economic.mean, sd: stats.fourValues.economic.sd },
    { label: "사회·공공적 가치", mean: stats.fourValues.social.mean, sd: stats.fourValues.social.sd },
  ];
  return [
    headingBlock({ id: "values-result-heading", variant: "numbered", number: "1", text: "4대 가치 조사 결과" }),
    ...fourValueQualitativeBlocks(stats, "four-values-qualitative", questionsByKeyPrefix(qual, "values:")),
    // 원본 36쪽: "4대 가치 만족도 종합 결과" 막대+표는 "1"이 아니라 "2 4대 가치 조사 결과
    // 분석"의 맨 앞에 있다(2026-07-28 원본 재대조로 위치 수정 — 예전엔 "1"에 있었다).
    headingBlock({ id: "values-analysis-heading", variant: "numbered", number: "2", text: "4대 가치 조사 결과 분석" }),
    meanChart("four-values-chart", "4대 가치 만족도 종합 결과", rows.map((r) => ({ name: r.label, mean: r.mean }))),
    tableBlock({
      id: "four-values-table",
      title: "4대 가치 만족도",
      headers: ["가치", "평균", "표준편차"],
      rows: rows.map((r) => [r.label, r.mean, r.sd]),
    }),
    textBlock({
      id: "four-values-analysis-summary",
      label: "4대 가치 만족도 종합 해석",
      html: buildFourValuesAnalysisText(rows, qual),
      styled: true,
    }),
  ];
}

/** 섹션 Ⅵ: 사용자 경험 품질 평가 — 실용성/즐거움 평균·표준편차 표. */
function buildUxQualitySection(stats: QuantStats): ReportBlock[] {
  const usability = stats.uxQuality.usability;
  const fun = stats.uxQuality.fun;
  return [
    headingBlock({ id: "ux-result-heading", variant: "numbered", number: "1", text: "사용자 경험 품질 평가 결과" }),
    radarBlock({
      id: "ux-radar-overall",
      title: "전체",
      axisMin: 4,
      axisMax: 6.5,
      indicators: [...usability.map((item) => item.name), ...fun.map((item) => item.name)],
      series: [{ name: "전체", color: "#8f8f8f", values: [...usability.map((item) => item.mean), ...fun.map((item) => item.mean)] }],
    }),
    radarBlock({
      id: "ux-radar-usability",
      title: "실용성",
      axisMin: 4,
      axisMax: 6.5,
      indicators: usability.map((item) => item.name),
      series: [{ name: "실용성", color: "#9ec5f8", values: usability.map((item) => item.mean) }],
    }),
    radarBlock({
      id: "ux-radar-fun",
      title: "즐거움",
      axisMin: 4,
      axisMax: 6.5,
      indicators: fun.map((item) => item.name),
      series: [{ name: "즐거움", color: "#ffcf94", values: fun.map((item) => item.mean) }],
    }),
    tableBlock({
      id: "ux-quality-table",
      title: "사용자 경험 품질 평가 결과",
      headers: ["구분", "항목", "평균", "표준편차"],
      rows: [
        ...usability.map((item) => ["실용성", item.name, item.mean, item.sd]),
        ...fun.map((item) => ["즐거움", item.name, item.mean, item.sd]),
      ],
    }),
  ];
}

/**
 * 섹션 Ⅶ: 교차 분석 — 기존엔 완전히 스텁 텍스트뿐이었다(정량 데이터는 이미 계산돼 있는데
 * 웹에 안 쓰였음, 2026-07-25 재조사로 확인). `stats.crossAnalysis`(연령대별/성별 그룹)를
 * 표로 채운다 — PDF의 클러스터 막대그래프(GroupedBarChart)와 완전히 같은 모양은 아니지만
 * (1차 단순화, 계획 문서 참고), 연령대/성별 간 차이를 표로 정확히 비교할 수 있다.
 */
function buildCrossAnalysisSection(stats: QuantStats): ReportBlock[] {
  const ca = stats.crossAnalysis;
  const featureNames = ca.byAgeGroup[0]?.featureSatisfaction.map((f) => f.name) ?? [];
  const valueLabels = ["기능적 가치", "심미적 가치", "경제적 가치", "사회·공공적 가치"] as const;
  const comparisonPalette = ["#b8d8f6", "#ffd0b2", "#ffe69a", "#d4e9cf", "#d7c4ef", "#9fd7cf"];

  const featureChart = (groups: typeof ca.byAgeGroup, title: string, idSuffix: string) =>
    groupedBarBlock({
      id: `cross-feature-chart-${idSuffix}`,
      title,
      unit: "점",
      axisMin: 4,
      axisMax: 9,
      series: groups.map((group, index) => ({ name: group.group, color: comparisonPalette[index % comparisonPalette.length] })),
      categories: featureNames.map((name) => ({
        label: name,
        values: groups.map((group) => ({ series: group.group, value: group.featureSatisfaction.find((item) => item.name === name)?.mean ?? 0 })),
      })),
    });

  const valuesChart = (groups: typeof ca.byAgeGroup, title: string, idSuffix: string) =>
    groupedBarBlock({
      id: `cross-values-chart-${idSuffix}`,
      title,
      unit: "점",
      axisMin: 4,
      axisMax: 9,
      series: groups.map((group, index) => ({ name: group.group, color: comparisonPalette[index % comparisonPalette.length] })),
      categories: valueLabels.map((label, index) => {
        const key = (["functional", "aesthetic", "economic", "social"] as const)[index];
        return { label, values: groups.map((group) => ({ series: group.group, value: group.fourValues[key] })) };
      }),
    });

  const featureTable = (groups: typeof ca.byAgeGroup, title: string, idSuffix: string) =>
    tableBlock({
      id: `cross-feature-${idSuffix}`,
      title,
      headers: ["기능", ...groups.map((g) => `${g.group}(n=${g.n})`)],
      rows: featureNames.map((name) => [
        name,
        ...groups.map((g) => g.featureSatisfaction.find((f) => f.name === name)?.mean ?? "-"),
      ]),
    });

  const valuesTable = (groups: typeof ca.byAgeGroup, title: string, idSuffix: string) =>
    tableBlock({
      id: `cross-values-${idSuffix}`,
      title,
      headers: ["4대 가치", ...groups.map((g) => `${g.group}(n=${g.n})`)],
      rows: valueLabels.map((label, i) => {
        const key = (["functional", "aesthetic", "economic", "social"] as const)[i];
        return [label, ...groups.map((g) => g.fourValues[key])];
      }),
    });

  const genderRadar = (kind: "usability" | "fun", title: string, idSuffix: string) => {
    const groups = ca.byGender;
    const indicators = groups[0]?.uxQuality[kind].map((item) => item.name) ?? [];
    return radarBlock({
      id: `cross-gender-ux-${idSuffix}`,
      title,
      axisMin: 4,
      axisMax: 9,
      indicators,
      series: groups.map((group, index) => ({
        name: group.group,
        color: comparisonPalette[index % comparisonPalette.length],
        values: group.uxQuality[kind].map((item) => item.mean),
      })),
    });
  };

  return [
    headingBlock({ id: "cross-result-heading", variant: "numbered", number: "1", text: "사용자 경험 품질 평가 결과 분석" }),
    headingBlock({ id: "cross-age-heading", variant: "subheading", text: "연령에 따른 차이" }),
    featureChart(ca.byAgeGroup, "기능별 만족도 차이", "age"),
    valuesChart(ca.byAgeGroup, "4대 가치 만족도 차이", "age"),
    featureTable(ca.byAgeGroup, "연령대별 기능 만족도 차이", "age"),
    valuesTable(ca.byAgeGroup, "연령대별 4대 가치 만족도 차이", "age"),
    headingBlock({ id: "cross-gender-heading", variant: "subheading", text: "성별에 따른 차이" }),
    featureChart(ca.byGender, "기능별 만족도 차이", "gender"),
    valuesChart(ca.byGender, "4대 가치 만족도 차이", "gender"),
    featureTable(ca.byGender, "성별 기능 만족도 차이", "gender"),
    valuesTable(ca.byGender, "성별 4대 가치 만족도 차이", "gender"),
    headingBlock({ id: "cross-gender-ux-heading", variant: "subheading", text: "사용자 경험 품질 평가" }),
    genderRadar("usability", "실용성", "usability"),
    genderRadar("fun", "즐거움", "fun"),
  ];
}

/** 섹션 Ⅷ: 종합 만족도 및 NPS 지수 — 정량 요약 표 + 종합/유사서비스/개선아이디어 정성 분석. */
function buildNpsSection(stats: QuantStats, qual: QuestionWithApprovedCategories[]): ReportBlock[] {
  const npsQual = questionsByKeys(qual, ["overallSatisfaction", "nps", "priorService", "improvementIdea"]);
  return [
    headingBlock({ id: "nps-result-heading", variant: "numbered", number: "1", text: "종합 만족도 및 NPS 지수" }),
    npsBlock({
      id: "nps-diagram",
      title: "NPS 지수 (Net Promoter Score : 순수 고객추천/구매 지수)",
      mean: stats.nps.rawMean,
      npsScore: stats.nps.npsScore,
      promoterPct: stats.nps.promoterPct,
      passivePct: stats.nps.passivePct,
      detractorPct: stats.nps.detractorPct,
    }),
    tableBlock({
      id: "nps-summary",
      title: "종합 만족도 및 NPS 지수",
      headers: ["전반적 만족도", "평균 구매 의향", "NPS 지수", "구매 고객", "중립 고객", "비구매 고객"],
      rows: [[
        stats.overallSatisfaction.mean,
        stats.nps.rawMean,
        stats.nps.npsScore,
        `${stats.nps.promoterPct}%`,
        `${stats.nps.passivePct}%`,
        `${stats.nps.detractorPct}%`,
      ]],
    }),
    ...qualitativeBlock(
      "nps-improvement-idea",
      "종합 만족도 · 개선 아이디어 분석",
      npsQual,
    ),
  ];
}

/** 섹션 Ⅸ: 종합 결과 및 제언 — 결과요약은 Tier 1(자동 생성, 승인 절차 없음)이라 그대로 표시. 전략/기능 제언은 대기 표시. */
function polarityPercentages(qual: QuestionWithApprovedCategories[], featureName: string) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const question of qual.filter((q) => q.question_key.startsWith("feature:"))) {
    for (const category of question.categories) {
      // 질문 키가 기능명을 직접 포함하는 데이터와, 카테고리 라벨에 기능명이 있는 이전 데이터 모두를 지원한다.
      if (!question.label.includes(featureName) && !category.label.includes(featureName)) continue;
      if (category.polarity && category.polarity in counts) counts[category.polarity] += category.clause_count;
    }
  }
  const total = counts.positive + counts.neutral + counts.negative;
  const pct = (value: number) => total ? Math.round((value / total) * 1000) / 10 : 0;
  return { positive: pct(counts.positive), neutral: pct(counts.neutral), negative: pct(counts.negative) };
}

function buildConclusionSection(
  stats: QuantStats,
  resultSummary: string | null | undefined,
  qual: QuestionWithApprovedCategories[],
  recommendations: RecommendationRow[],
): ReportBlock[] {
  const devPriority = recommendations.find((r) => r.section === "dev_priority");
  const featureRecs = recommendations.filter((r) => r.section.startsWith("feature_improvement:"));
  const rankedImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  return [
    headingBlock({ id: "conclusion-result-heading", variant: "numbered", number: "1", text: "사용성테스트 결과 요약" }),
    quadrantBlock({
      id: "conclusion-importance-satisfaction-quadrant",
      title: "기능별 상대 중요도-만족도 그래프",
      items: rankedImportance.map((item) => ({
        id: `conclusion-${slug(item.name)}`,
        name: item.name,
        importance: item.score,
        satisfaction: stats.featureSatisfaction.find((feature) => feature.name === item.name)?.mean ?? 0,
      })),
    }),
    tableBlock({
      id: "conclusion-feature-summary-table",
      title: "기능별 고객 경험 평가",
      headers: ["기능명", "평균 만족도 (점)", "상대 중요도", "긍정 비율 (%)", "중립 비율 (%)", "부정 의견 (%)"],
      rows: rankedImportance.map((item) => {
        const polarity = polarityPercentages(qual, item.name);
        return [item.name, stats.featureSatisfaction.find((feature) => feature.name === item.name)?.mean ?? 0, item.score, polarity.positive, polarity.neutral, polarity.negative];
      }),
    }),
    textBlock({
      id: "final-summary",
      label: "사용성테스트 결과 요약",
      // resultSummary는 Claude가 마크다운(#, ##, -)으로 쓴 원문 그대로다. 여기서 <p>로
      // 감싸버리면 RichReportEditor의 looksLikeHtml 판정이 "이미 HTML"로 오인해
      // richTextToHtml(마크다운→HTML 변환)을 건너뛰고 #/##/- 글자가 그대로 노출된다
      // (2026-07-28 실측 확인) — 감싸지 않은 원문을 그대로 넘겨야 자동 변환된다.
      html: resultSummary?.trim() || "정량 분석 결과를 바탕으로 한 결과 요약을 입력하세요.",
    }),
    devPriority
      ? textBlock({
          id: "final-strategy",
          label: "개선 전략 제언",
          html: devPriority.final ?? devPriority.draft,
          styled: true,
        })
      : textBlock({ id: "final-strategy", label: "개선 전략 제언", html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true }),
    featureRecs.length > 0
      ? textBlock({
          id: "final-feature-recs",
          label: "기능별 고객 제언 종합",
          // 제언은 6.5절 헤지워딩 자유 서술 초안이라(체크포인트 B 대상②) 표로 강제 파싱하지
          // 않고, 기능명 소제목 + 제언 문단을 그대로 나열한다 — 담당자가 검수·수정하는 게
          // 설계 의도라 원문 손실 없이 보여주는 쪽을 택했다.
          // rec.draft/final은 마크다운 원문이라, 내가 직접 붙이는 <p> 제목 태그와 섞이면
          // RichReportEditor의 looksLikeHtml 판정이 "이미 HTML"로 오인해 마크다운 변환을
          //건너뛴다(위 resultSummary와 같은 함정) — richTextToHtml로 미리 변환해서 합친다.
          html: featureRecs
            .map((rec) => {
              const featureName = rec.section.replace("feature_improvement:", "");
              return `<p style="font-weight:700;margin:10pt 0 4pt">[${escapeHtml(featureName)}]</p>${richTextToHtml(rec.final ?? rec.draft)}`;
            })
            .join(""),
          styled: true,
        })
      : textBlock({ id: "final-feature-recs", label: "기능별 고객 제언 종합", html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true }),
  ];
}

/** 저장된 raw data 정량 결과와 이미 생성된 결과 요약을 편집 가능한 웹 섹션 콘텐츠로 변환한다. */
export function buildReportWorkspaceSeed(input: {
  quantStats: QuantStats;
  productInfo?: ProductInfo | null;
  fileName?: string | null;
  resultSummary?: string | null;
  /** DB에 저장된 정성 분석 결과(문항+카테고리). 없으면 정성 섹션은 "대기"로 표시된다. */
  qualitative?: QuestionWithApprovedCategories[] | null;
  /** DB에 저장된 제언 초안(승인 여부 무관). 없으면 Ⅸ장 제언은 "대기"로 표시된다. */
  recommendations?: RecommendationRow[] | null;
}): ReportWorkspaceSeed {
  const { productInfo, fileName, resultSummary } = input;
  const stats = normalizeQuantStats(input.quantStats);
  const qual = input.qualitative ?? [];
  const recommendations = input.recommendations ?? [];
  const plan = buildReportPlan(stats.featureSatisfaction.map((f) => f.name));

  const blocksByNumeral: Record<string, ReportBlock[]> = {
    I: buildOverviewSection(stats, productInfo, fileName),
    II: buildDemographicsSection(stats),
    III: buildFeatureSection(stats, qual),
    IV: buildCorePurchaseFactorSection(stats),
    V: buildFourValuesSection(stats, qual),
    VI: buildUxQualitySection(stats),
    VII: buildCrossAnalysisSection(stats),
    VIII: buildNpsSection(stats, qual),
    IX: buildConclusionSection(stats, resultSummary, qual, recommendations),
  };

  const sections: ReportSectionContent[] = plan.map((section) => ({
    numeral: section.numeral,
    title: section.title,
    blocks: blocksByNumeral[section.numeral] ?? [],
  }));

  return { quantStats: stats, productInfo, resultSummary, sections };
}
