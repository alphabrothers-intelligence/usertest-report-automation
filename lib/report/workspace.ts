import type { ProductInfo } from "@/lib/productInfo/types";
import { richTextToHtml, richTextToInlineHtml } from "@/lib/report/richText";
import type { QuantStats } from "@/lib/quant/compute";
// 타입만 가져온다(import type) — reports.ts가 postgres를 import하지만, 타입 전용 import는
// 컴파일 시 제거되므로 클라이언트 번들에 DB 클라이언트가 딸려오지 않는다.
import type { QuestionWithApprovedCategories, CategoryRow, RecommendationRow, SectionAnalyses } from "@/lib/db/reports";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import type { SectionPlan } from "@/lib/agent/sectionPlan";
import { parseFourValueItemTexts } from "@/lib/pipeline/sectionAnalysis";
import { decodeImprovementLabel } from "@/lib/pipeline/stage2";
import { buildConclusionSection } from "@/lib/report/workspaceConclusion";
import { buildOverviewSection } from "@/lib/report/workspaceOverview";
import { buildDemographicsSection } from "@/lib/report/workspaceDemographics";
import { buildFeatureSection } from "@/lib/report/workspaceFeatureExperience";
import { buildCorePurchaseFactorSection } from "@/lib/report/workspaceCorePurchaseFactor";
import { buildFourValuesSection, findValueQuestion } from "@/lib/report/workspaceFourValues";
import { genericOf } from "@/lib/report/genericStats";
import { buildUxQualitySection } from "@/lib/report/workspaceUxQuality";
import { buildCrossAnalysisSection } from "@/lib/report/workspaceCrossAnalysis";
import { buildJourneySection } from "@/lib/report/workspaceJourney";
import { buildNpsSection } from "@/lib/report/workspaceNps";
import { donutSvg, satisfactionHistogramSvg } from "@/lib/report/chartSvg";
import { dataTableCss } from "@/lib/report/sectionStyle";
import {
  headingBlock,
  isFullQuestionText,
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
/** 표 서식은 문서 전체가 같은 토큰을 쓴다(sectionStyle.ts). 색·크기 리터럴을 다시 쓰지 말 것. */
const CSS = dataTableCss();
const POLARITY_ORDER = ["positive", "negative", "neutral"] as const;
const POLARITY_LABEL: Record<string, string> = { positive: "긍정", negative: "부정", neutral: "중립" };
type PolaritySummaryText = Partial<Record<"positive" | "negative" | "neutral" | "combined", string>>;
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
  return `<p style="background-color:${s.bg};color:${s.color};font-size:10pt;line-height:1.45;font-weight:700;padding:4pt 8pt;margin:14pt 0 8pt"><strong>${index}. ${POLARITY_LABEL[polarity]} 의견 (${pct}%)</strong></p>`;
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

/** 개선 아이디어(2단) 렌더링 — 원본 45~49쪽 형식: [대분류] → <소분류> → 원문 인용 다수.
 * 카테고리 label이 "대분류소분류"로 인코딩돼 있으므로 대분류로 묶어 계층을 복원한다.
 * 인사이트(→ 요약)는 원본에 없으므로 붙이지 않고, 인용은 3개 제한 없이 전부 보여준다. */
// displayText(quotesDisplay의 해당 항목, 근거 구간에 **__..__** 마킹)가 있으면 화면 표시에
// 쓰고, data-quote-text는 항상 마킹 없는 원문 quote를 쓴다 — quote-source/quote-ending/
// quote-completion API가 raw data 원문과 정확히 대조하는 기준이라 여기 마킹이 섞이면 안 된다.
function quoteHtml(quote: string, questionKey: string, displayText?: string): string {
  return `<div data-report-quote data-quote-source="${escapeHtml(questionKey)}" data-quote-text="${escapeHtml(encodeURIComponent(quote))}" style="margin:0 0 4pt"><p style="display:inline;margin:0">"${richTextToInlineHtml(displayText ?? quote)}"</p></div>`;
}

function quoteGroupButton(questionKey: string, label: string): string {
  return `<span hidden data-copy-ignore contenteditable="false" data-quote-group-source="${escapeHtml(questionKey)}" data-quote-group-label="${escapeHtml(encodeURIComponent(label))}"></span>`;
}

function quoteGroupStart(questionKey: string, label: string): string {
  return `<div data-quote-group>${quoteGroupButton(questionKey, label)}`;
}

function analysisEvidenceHtml(title: string, content: string): string {
  return `<div data-analysis-evidence data-analysis-label="${escapeHtml(encodeURIComponent(title))}">${content}</div>`;
}

function improvementCategoryHtml(categories: CategoryRow[], questionKey: string): string[] {
  const byMajor = new Map<string, CategoryRow[]>();
  for (const cat of categories) {
    const { major } = decodeImprovementLabel(cat.label);
    const key = major || "기타";
    (byMajor.get(key) ?? byMajor.set(key, []).get(key)!).push(cat);
  }
  const out: string[] = [];
  for (const [major, subs] of byMajor) {
    out.push(`${quoteGroupStart(questionKey, major)}<p style="font-weight:700;margin:10pt 0 3pt"><strong>[${richTextToInlineHtml(major)}]</strong></p>`);
    for (const sub of subs) {
      const { sub: subLabel } = decodeImprovementLabel(sub.label);
      if (subLabel) out.push(`<p style="font-weight:700;margin:5pt 0 2pt">&lt;${richTextToInlineHtml(subLabel)}&gt;</p>`);
      sub.quotes.forEach((quote, i) => out.push(quoteHtml(quote, questionKey, sub.quotes_display?.[i])));
      out.push(BLANK_LINE_HTML);
    }
    out.push(`</div>`);
  }
  return out;
}

function categoryHtml(cat: CategoryRow, questionKey: string): string[] {
  // 한글 붙여넣기에서 CSS font-weight만으로는 굵게가 유지되지 않는 사례가 있어,
  // 인라인 스타일과 실제 의미 태그를 반드시 함께 낸다.
  const out = [`<p style="font-weight:700;margin:10pt 0 3pt"><strong>[${richTextToInlineHtml(cat.label)}]</strong></p>`];
  cat.quotes.slice(0, 3).forEach((quote, i) => out.push(quoteHtml(quote, questionKey, cat.quotes_display?.[i])));
  out.push(`<p style="font-weight:700;font-style:italic;margin:3pt 0 8pt"><strong><em>→ ${richTextToInlineHtml(cat.insight_final ?? cat.insight_draft)}</em></strong></p>`);
  out.push(BLANK_LINE_HTML);
  return out;
}

// --- 원본 14페이지 "주관식 응답 감정 분석"(반원 도넛 + %표) + "응답 요약" (2026-07-26 추가) ---
// 도넛 색상은 원본 이미지 기준(배너보다 살짝 진한 톤). 도넛은 표시 전용이라 data-copy-ignore로
// 감싸 "서식 유지 복사" 대상에서 뺀다(SVG는 한글 붙여넣기에 안 실리므로 %표/요약 텍스트가 수치를
// 전달한다).

/** 긍정/부정/중립 % + 건수 표(원본 감정분석 하단 표 형식). */
function polarityTableHtml(counts: Record<string, number>): string {
  const total = counts.positive + counts.negative + counts.neutral;
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
  const head = (bg: string, text: string) =>
    `<td style="${CSS.cellWith(bg)};font-weight:700">${text}</td>`;
  const body = (n: number) => `<td style="${CSS.cell}">${pct(n)}%<br>(${n}건)</td>`;
  return `<table style="${CSS.table};width:auto;margin:4pt auto 8pt"><tbody><tr>${head(CSS.palette.title, "긍정")}${head("#fde4d0", "부정")}${head("#e8e8e8", "중립")}</tr><tr>${body(counts.positive)}${body(counts.negative)}${body(counts.neutral)}</tr></tbody></table>`;
}

/** 극성별 응답 요약([긍정/부정/중립 의견 요약])을 원본 "응답 요약" 박스 형식 HTML로 만든다. */
export function responseSummaryHtml(ps: PolaritySummaryText | null | undefined, questionKey?: string): string {
  const rows: string[] = [];
  const add = (pol: "positive" | "negative" | "neutral", label: string) => {
    const text = ps?.[pol];
    if (text) rows.push(`<p style="font-weight:700;margin:6pt 0 2pt"><strong>[${label} 의견 요약]</strong></p><p style="margin:0 0 4pt">${richTextToInlineHtml(text)}</p>`);
  };
  add("positive", "긍정");
  add("negative", "부정");
  add("neutral", "중립");
  const content = rows.length === 0
    ? `<p style="margin:0;color:#9ca3af">정성 요약이 아직 없습니다. 이 박스의 AI 요약 생성 버튼으로 채울 수 있습니다.</p>`
    : rows.join("");
  // 별도 툴바가 아니라 실제 "응답 요약" 셀 안에서만 실행한다. contenteditable=false로
  // 본문 편집 중 버튼이 지워지는 일을 막고, data-copy-ignore로 한글 복사 대상에서도 제외한다.
  const action = questionKey
    ? `<div data-copy-ignore contenteditable="false" style="margin:0 0 6pt;text-align:right"><button type="button" data-ai-summary="${escapeHtml(questionKey)}" style="border:1px solid #315c9c;border-radius:3pt;background:#ffffff;color:#315c9c;padding:3pt 7pt;font-size:9pt;font-weight:700;cursor:pointer">AI 요약 생성</button></div>`
    : "";
  return questionKey ? `<div data-summary-key="${escapeHtml(questionKey)}">${action}${content}</div>` : content;
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
  const border = CSS.border;
  const panelHead = (title: string) => `<td style="width:50%;vertical-align:top;border:${border};padding:0"><p style="margin:0;background-color:${CSS.palette.header};color:#315c9c;font-weight:700;text-align:center;padding:5pt">${escapeHtml(title)}</p><div style="padding:6pt">`;

  // **이 페이지의 주인은 정량(기능)이고 정성은 있으면 얹는다**(2026-08-25 원본 재대조로 수정).
  // 예전에는 정성 문항을 순회해서 `categories.length === 0`이면 문항을 통째로 건너뛰었는데,
  // 원본 8쪽 상단 절반(만족도 평균·표준편차 배너 + 만족도 분포도)은 raw data만으로 그려지는
  // 정량 블록이다. 정성 분석 전이거나 한 문항이 실패했을 때 그 문항 페이지가 통째로
  // 사라져(= 원본에 있는 쪽이 없어져) 보고서 구조 자체가 달라지던 문제를 고친다 —
  // 정성 실패가 정량 결과까지 못 내보내게 만들면 안 된다는 원칙(PRD 11장 15번과 같은 방향).
  const byFeature = new Map<string, QuestionWithApprovedCategories>();
  for (const q of questions) {
    if (q.categories.length === 0) continue;
    const matched = findFeatureStat(stats, q);
    if (matched && !byFeature.has(matched.name)) byFeature.set(matched.name, q);
  }

  for (const feature of stats.featureSatisfaction) {
    qi += 1;
    const q = byFeature.get(feature.name) ?? null;
    const survey = findFeatureSurveyQuestion(stats, feature.name);
    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
    if (q) for (const c of q.categories) if (c.polarity) counts[c.polarity] += c.clause_count;

    // (1) Q번호 질문 헤딩(시안 밑줄). 원본은 "Q7. '펫 성장 시스템' 기능의 만족도는 몇 점입니까?"
    // 형식의 완전한 문장이다. raw data 헤더가 전체 문항이면 **그것을 그대로 쓰고**(원문 우선),
    // 리바랩스처럼 짧은 라벨("… 기능 만족도")이면 정식 표시명으로 표준 문장을 만든다.
    blocks.push(headingBlock({
      id: `${idPrefix}-q${qi}-heading`,
      variant: "question",
      number: survey ? `Q${survey.qno}` : undefined,
      text: isFullQuestionText(survey?.question) ? survey!.question : `'${feature.name}' 기능의 만족도는 몇 점입니까?`,
    }));

    // (2) 만족도 점수 평균/표준편차 배너 + 만족도 분포도(전체 폭). 원본은 옆에 "주요 키워드
    // 도출" 워드클라우드가 있었지만 사용자 요청으로 제외했다(2026-07-28).
    const meanSdBanner =
      `<table style="${CSS.table};margin:0 0 8pt"><tbody><tr>` +
        `<td style="${CSS.header};width:66%">만족도 점수 평균 : ${feature.mean.toFixed(2)} / 10</td>` +
        `<td style="${CSS.header}">표준편차 : ${feature.sd.toFixed(2)}</td>` +
        `</tr></tbody></table>`;
    const histogram = feature.scoreDistribution ? satisfactionHistogramSvg(feature.scoreDistribution) : `<p style="margin:0;color:#9ca3af;text-align:center">분포 데이터 없음</p>`;
    blocks.push(richStaticBlock({
      id: `${idPrefix}-q${qi}-scorebox`,
      html: meanSdBanner +
        `<table style="${CSS.table};margin:0 0 10pt"><tbody><tr>` +
        `<td style="vertical-align:top;border:${border};padding:0"><p style="margin:0;background-color:${CSS.palette.header};color:#315c9c;font-weight:700;text-align:center;padding:5pt">만족도 분포도</p><div style="padding:6pt;text-align:center">${histogram}</div></td>` +
        `</tr></tbody></table>`,
    }));

    // (3)(4)는 정성 결과가 있을 때만. 없으면 이 문항 페이지가 사라지는 대신 대기 안내만 남는다.
    if (!q) {
      blocks.push(textBlock({
        id: `${idPrefix}-q${qi}-detail`,
        label: feature.name,
        html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`,
        pending: true,
      }));
      continue;
    }

    // (3) [감정 분석 도넛+%표 | 응답 요약] 2열.
    const donut = donutSvg(counts);
    blocks.push(richStaticBlock({
      id: `${idPrefix}-q${qi}-emotionbox`,
      html: `<table style="${CSS.table};margin:0 0 10pt"><tbody><tr>` +
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
      restParts.push(quoteGroupStart(q.question_key, `${POLARITY_LABEL[pol]} 의견`));
      for (const cat of cats) restParts.push(...categoryHtml(cat, q.question_key));
      restParts.push(`</div>`);
    }
    blocks.push(textBlock({ id: `${idPrefix}-q${qi}-detail`, label: q.label, html: restParts.join(""), styled: true }));
  }
  // 기능 문항 자체가 없는 raw data 에서만 걸린다(정성 유무와 무관).
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
      // 개선 아이디어(2단): label이 "대분류소분류"로 인코딩돼 있으면 원본 45~49쪽처럼
      // [대분류] → <소분류> → 원문 인용(인사이트 없음) 계층으로 렌더링한다.
      const parts = [`<p style="font-weight:700;font-size:10.5pt;margin:16pt 0 6pt">${escapeHtml(q.label)}</p>`];
      parts.push(...improvementCategoryHtml(q.categories, q.question_key));
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
        html: `<p style="font-weight:700;font-size:10.5pt;margin:16pt 0 6pt">${escapeHtml(q.label)}</p><p style="font-weight:700;margin:10pt 0 4pt;color:#315c9c">주관식 응답 감정 분석</p>`,
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
      restParts.push(quoteGroupStart(q.question_key, `${POLARITY_LABEL[pol]} 의견`));
      for (const cat of cats) restParts.push(...categoryHtml(cat, q.question_key));
      restParts.push(`</div>`);
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
function valueOpinionColumnHtml(title: string, background: string, categories: CategoryRow[], questionKey: string): string {
  const body = categories.length
    ? categories.map((category) => categoryHtml(category, questionKey).join("")).join("")
    : `<p style="margin:0;color:#6b7280">분석된 ${title} 의견이 없습니다.</p>`;
  return `<td data-quote-section="${escapeHtml(title)} 의견" style="width:50%;vertical-align:top;border:${CSS.border};padding:10pt;background-color:#ffffff">
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
  return (
    `<table style="${CSS.table};margin:6pt 0 10pt">` +
    `<thead><tr><th style="${CSS.header}">평균</th><th style="${CSS.header}">표준편차</th></tr></thead>` +
    `<tbody><tr><td style="${CSS.cell}">전체 ${mean.toFixed(2)}</td><td style="${CSS.cell}">${sd.toFixed(2)}</td></tr></tbody>` +
    `</table>`
  );
}

/** 원본 "[ {가치} 조사 결과 ]" 요약 박스.
 *
 * Ⅴ장에는 Ⅲ장의 긍정·부정·중립 총평을 그대로 나열하지 않는다. `combined`에는 가치 문항 전용
 * 프롬프트가 만든 3~4문장 존댓말 요약이 저장된다. 이전에 생성해 둔 보고서는 combined 키가
 * 없을 수 있으므로, 그 경우에만 기존 극성 요약을 읽는 호환 경로를 둔다. */
export function valueSummaryBoxHtml(label: string, summaries: PolaritySummaryText | null | undefined, questionKey?: string, overrideText?: string): string {
  const text = overrideText
    ?? summaries?.combined
    ?? (summaries
      ? (["positive", "negative", "neutral"] as const)
          .map((polarity) => summaries[polarity])
          .filter((value): value is string => Boolean(value))
          .join(" ")
      : "");
  // overrideText(sectionAnalysis.ts 자동 생성분)가 있으면 이미 채워진 값이니 "AI 요약 생성"
  // 버튼을 보여줄 필요가 없다 — questionKey를 비워 버튼을 감춘다.
  questionKey = overrideText ? undefined : questionKey;
  // 가치 전용 프롬프트는 3~4문장을 줄바꿈으로 분리한다. 단순 <br>보다 실제 <p>가 한글의
  // 붙여넣기에서 문단/문단 간격으로 더 안정적으로 변환되므로 줄마다 문단을 만든다.
  // richTextToInlineHtml은 **__강조__**를 <strong><u>로 바꿔 HWP에도 강조 의미가 남는다.
  const formattedText = text.split(/\r?\n+/).filter(Boolean)
    .map((line) => `<p style="margin:0 0 5pt;line-height:1.65">${richTextToInlineHtml(line)}</p>`)
    .join("");
  const action = questionKey
    ? `<button type="button" data-copy-ignore contenteditable="false" data-ai-summary="${escapeHtml(questionKey)}" style="float:right;border:1px solid #315c9c;border-radius:3pt;background:#ffffff;color:#315c9c;padding:3pt 7pt;font-size:9pt;font-weight:700;cursor:pointer">AI 요약 생성</button>`
    : "";
  return (
    `<table style="${CSS.table};margin:0 0 14pt"><tbody>` +
    `<tr><td style="${CSS.header};color:#000000">${action}[ ${escapeHtml(label)} 조사 결과 ]</td></tr>` +
    `<tr><td style="${CSS.cellLeft};padding:8pt">${text ? formattedText : "정성 요약이 아직 없습니다. 이 박스의 AI 요약 생성 버튼으로 채울 수 있습니다."}</td></tr>` +
    `</tbody></table>`
  );
}

function fourValueQualitativeBlocks(stats: QuantStats, idPrefix: string, questions: QuestionWithApprovedCategories[], itemsText?: string): ReportBlock[] {
  // 2026-08-03: sectionAnalysis.ts의 runFourValueItemAnalysis(항상 파이프라인의 일부로 자동
  // 생성)가 있으면 그 텍스트를 쓴다 — opt-in "AI 요약 생성" 버튼(polaritySummary.ts)은 이
  // 자동 생성이 아직 없는(구버전 report 등) 경우의 폴백으로만 남긴다. 원본은 이 문단이
  // 선택적("나중에 채울 것")이 아니라 항상 있는 필수 구성요소이기 때문이다.
  const itemTexts = parseFourValueItemTexts(itemsText ?? "");
  // **축 이름·개수는 raw data 에서 온다**(genericOf). 예전엔 기능적/심미적/경제적/사회·공공적
  // 네 개를 영문 키까지 박아 읽어서, 축이 3개거나 이름이 다른 raw data 에서는 0.00점짜리
  // 문항이 네 개 찍혔다 — 바로 위 조사 결과 표(workspaceFourValues)는 이미 배열을 읽고
  // 있었으므로 같은 장 안에서 표와 문항 목록이 서로 어긋나 있었다.
  const valueRows = genericOf(stats).valueAxes;
  const blocks: ReportBlock[] = [];
  valueRows.forEach((value, index) => {
    const question = findValueQuestion(questions, value.name);
    const survey = findSurveyQuestion(stats, "4대 가치 만족도 평가", index);
    const heading = survey ? `Q${survey.qno}. ${survey.question}` : `${value.name} 만족도`;
    blocks.push(headingBlock({ id: `${idPrefix}-q${index + 1}`, variant: "question", text: heading }));
    blocks.push(richStaticBlock({
      id: `${idPrefix}-meansd-${index + 1}`,
      html: `<p style="font-weight:700;margin:0 0 4pt">${escapeHtml(value.name)} 만족도</p>${valueMeanSdTableHtml(value.mean, value.sd)}`,
    }));
    if (question && question.categories.length > 0) {
      const positive = question.categories.filter((category) => category.polarity === "positive");
      const negative = question.categories.filter((category) => category.polarity === "negative");
      blocks.push(richStaticBlock({
        id: `${idPrefix}-opinion-box-${index + 1}`,
        html: `${quoteGroupStart(question.question_key, "긍정·부정 의견")}<table style="${CSS.table};margin:0 0 10pt"><tbody><tr>${valueOpinionColumnHtml("긍정", "#dce7fa", positive, question.question_key)}${valueOpinionColumnHtml("부정", "#fde4d0", negative, question.question_key)}</tr></tbody></table></div>`,
      }));
      blocks.push(richStaticBlock({
        id: `${idPrefix}-summary-${index + 1}`,
        html: valueSummaryBoxHtml(value.name, question.polarity_summaries, question.question_key, itemTexts[value.name]),
        summaryQuestionKey: question.question_key,
        summaryKind: "value",
      }));
    } else {
      blocks.push(textBlock({ id: `${idPrefix}-pending-${index + 1}`, label: `${value.name} 정성 분석`, html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true }));
    }
  });
  return blocks;
}

/**
 * 정성 문항은 DB 생성 시각이 아닌 설문지의 논리적 문항 순서로 정렬한다.
 *
 * 같은 원자료를 재분석하거나 일부 문항만 다시 생성하면 `created_at` 순서가 바뀔 수 있다.
 * 그러면 Q6~Q12 기능 결과가 뒤섞여 보이는 문제가 생기므로, 통계 모델의 기능 순서와
 * 설문 스키마의 문항 순서를 기준으로 한 번 정렬한 뒤 모든 섹션에서 재사용한다.
 */
function qualitativeQuestionOrder(stats: QuantStats, question: QuestionWithApprovedCategories): number {
  if (question.question_key.startsWith("feature:")) {
    const featureName = question.question_key.slice("feature:".length);
    const featureIndex = stats.featureSatisfaction.findIndex((feature) => feature.name === featureName);
    return 600 + (featureIndex >= 0 ? featureIndex : 99);
  }

  const fixedOrder: Record<string, number> = {
    // 기능 만족도/중요도(Q6~Q12) 다음의 유사 서비스 경험 문항
    priorService: 1500,
    // 핵심구매요소(Q13~) 뒤에 이어지는 4대 가치 문항
    "values:functional": 2300,
    "values:aesthetic": 2400,
    "values:economic": 2500,
    "values:social": 2600,
    // 보고서 말미의 종합 만족도·추천 의향·개선 아이디어
    overallSatisfaction: 3500,
    nps: 3600,
    improvementIdea: 3700,
  };
  return fixedOrder[question.question_key] ?? Number.MAX_SAFE_INTEGER;
}

function orderQualitativeQuestions(stats: QuantStats, qual: QuestionWithApprovedCategories[]) {
  return [...qual].sort((left, right) => {
    const orderDifference = qualitativeQuestionOrder(stats, left) - qualitativeQuestionOrder(stats, right);
    if (orderDifference !== 0) return orderDifference;
    return left.question_key.localeCompare(right.question_key, "ko");
  });
}

function questionsByKeyPrefix(qual: QuestionWithApprovedCategories[], prefix: string) {
  return qual.filter((q) => q.question_key.startsWith(prefix));
}
function questionsByKeys(qual: QuestionWithApprovedCategories[], keys: string[]) {
  const questionByKey = new Map(qual.map((question) => [question.question_key, question]));
  // `filter`는 DB 저장 순서를 보존한다. 요청한 키 순서로 명시적으로 꺼내야 Q 번호가 고정된다.
  return keys.flatMap((key) => {
    const question = questionByKey.get(key);
    return question ? [question] : [];
  });
}

/**
 * 브라우저 편집 작업공간으로 넘기는 보고서 모델. Ⅰ~Ⅸ 섹션을 `buildReportPlan()`의 numeral/
 * title 뼈대에 실제 QuantStats 값을 채운 `chart`/`table`/`text` 블록 목록으로 만든다
 * (PRD 3.3.1, 2026-07-25 재구성). PDF/DOCX/HWPX 렌더러의 레이아웃 구현과는 분리돼 있다 —
 * 웹에서 문장이나 차트를 편집해도 기존 독립 PDF 렌더러를 변경하지 않는다.
 *
 * 정성 데이터(카테고리·인용문·인사이트)는 DB에 저장된 승인 문항을 그대로 연결한다.
 * 아직 생성·승인되지 않은 문항만 `pending: true` 텍스트 블록으로 정직하게 비워 둔다.
 */
export type ReportWorkspaceSeed = {
  quantStats: QuantStats;
  productInfo?: ProductInfo | null;
  resultSummary?: string | null;
  sections: ReportSectionContent[];
};

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

/** raw data 헤더에서 받은 실제 설문 문항을 Q 번호로 안전하게 찾는다.
 * 헤더가 없는 과거 데이터도 렌더링이 멈추지 않도록 기본 제목을 함께 둔다. */
function questionText(stats: QuantStats, questionNo: number, fallback: string): string {
  return stats.surveyQuestions[questionNo - 1]?.question || fallback;
}

/** 섹션 Ⅲ: 기능별 고객 경험 평가 — 정량(만족도·순위)만, 정성(카테고리·인용문)은 대기 표시. */
/** 원본 분석 페이지처럼 제목띠와 본문을 하나의 표형 패널로 묶는다.
 * 편집 가능한 본문·복사·내보내기가 동일한 HTML 구조를 공유한다. */
function originalAnalysisPanelHtml(title: string, content: string, actionHtml = ""): string {
  return [
    `<div style="margin:6pt 0 12pt;border:0.75pt solid #8ea7de;border-top:3pt solid #4fc8e8;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.8pt;line-height:1.75;color:#111827">`,
    `<p style="margin:0;padding:7pt 10pt;text-align:center;background-color:${CSS.palette.title};border-bottom:${CSS.border};font-weight:700;color:#111827">${actionHtml}[ ${escapeHtml(title)} ]</p>`,
    `<div style="padding:10pt 14pt">${content}</div>`,
    `</div>`,
  ].join("");
}

/** sectionAnalysis.ts가 생성하는 섹션 단위 종합 해석 4종의 제목·구성.
 * 여기 없는 크로스분석(crossAnalysis)은 웹 문서에 별도 재생성 버튼을 아직 두지 않는다. */
export type SectionAnalysisRegenKey = "featureExperience" | "corePurchaseFactor" | "fourValues" | "uxQuality";
const SECTION_ANALYSIS_TITLES: Record<SectionAnalysisRegenKey, string> = {
  featureExperience: "기능별 중요 순위 및 만족도 종합 해석",
  corePurchaseFactor: "핵심구매요소 중요 순위 및 만족도 종합 해석",
  fourValues: "4대 가치 만족도 종합 해석",
  uxQuality: "사용자 경험 품질 평가 결과 분석",
};

/** "정성 분석 대기"였던 섹션 종합 해석(핵심구매요소·UX 품질)이나, 저장된 LLM 분석 없이 규칙
 * 기반 폴백만 나오던 섹션(기능별·4대 가치)에 공통으로 붙이는 재생성 버튼. 클릭하면
 * /api/report-section-analysis가 sectionAnalysis.ts를 다시 돌려 이 패널을 새로 채운다. */
function sectionAiRegenerateButtonHtml(section: SectionAnalysisRegenKey): string {
  return `<button type="button" data-copy-ignore contenteditable="false" data-ai-summary="${escapeHtml(section)}" style="float:right;border:1px solid #315c9c;border-radius:3pt;background:#ffffff;color:#315c9c;padding:3pt 7pt;font-size:9pt;font-weight:700;cursor:pointer">AI 분석 재생성</button>`;
}

/** sectionAnalysis.ts가 만든 텍스트(analysis)를 패널 HTML로 렌더링한다. 웹 문서 최초
 * 렌더링과 재생성 버튼 응답(app/api/report-section-analysis/route.ts) 양쪽이 이 함수 하나를
 * 공유해, 버튼으로 교체된 패널이 페이지를 새로고침했을 때 나오는 것과 항상 같은 모양이 되게 한다. */
/** 패널 제목 배너가 이미 "… 종합 해석"/"… 세부 해석"이므로, 본문 첫 줄의 [종합 해석]/[세부 해석]
 * 라벨은 같은 말이 두 번 보이게 한다(2026-08-18 지적). 이 라벨은 uxQuality 분할·PDF 렌더러가
 * 쓰는 구조 마커라 생성 단계에서 없앨 수 없어, 화면에 넣기 직전에만 벗긴다. */
function stripAnalysisLabel(text: string): string {
  return text.replace(/^\s*\[(?:종합|세부) 해석\]\s*/u, "").trim();
}

export function sectionAnalysisPanelHtml(section: SectionAnalysisRegenKey, analysis: string): string {
  const button = sectionAiRegenerateButtonHtml(section);
  if (section === "uxQuality") {
    const splitIndex = analysis.indexOf("[세부 해석]");
    const overview = splitIndex >= 0 ? analysis.slice(0, splitIndex).trim() : analysis;
    const detail = splitIndex >= 0 ? analysis.slice(splitIndex).trim() : "";
    return (
      originalAnalysisPanelHtml("사용자 경험 품질 평가 종합 해석", richTextToHtml(stripAnalysisLabel(overview)), button) +
      (detail ? originalAnalysisPanelHtml("사용자 경험 품질 세부 해석", richTextToHtml(stripAnalysisLabel(detail))) : "")
    );
  }
  const title = SECTION_ANALYSIS_TITLES[section];
  const panel = originalAnalysisPanelHtml(title, richTextToHtml(stripAnalysisLabel(analysis)), button);
  return section === "corePurchaseFactor" ? panel : analysisEvidenceHtml(title, panel);
}

/** 저장된 raw data 정량 결과와 이미 생성된 결과 요약을 편집 가능한 웹 섹션 콘텐츠로 변환한다. */
/**
 * 옛 고정 목차(리바랩스 기준 9장)의 출력 번호 → 표준목차 시트 식별자.
 *
 * 둘은 **같지 않다**. 시트에는 조건부 장인 `IV 고객 여정`이 네 번째 자리에 있어서, 리바랩스처럼
 * 그 장이 없는 데이터는 다섯 번째 장(핵심구매요소)이 출력 번호로는 Ⅳ가 된다. 옛 경로는 이
 * 어긋남 없이 번호를 그대로 키로 썼으므로, 새 키(식별자)로 옮기면서 한 번만 변환한다.
 *
 * ponytail: 옛 고정 목차(`buildReportPlan`)가 지워지면 이 표도 같이 지운다.
 */
const LEGACY_ID_BY_NUMERAL: Record<string, string> = {
  IV: "V", // 핵심구매요소
  V: "VI", // 4대 가치 만족도
  VI: "VII", // 사용자 경험 품질 평가
  VII: "VIII", // 교차 분석
  VIII: "IX", // 종합 만족도 및 NPS 지수
  IX: "X", // 종합 결과 및 제언
};

export function buildReportWorkspaceSeed(input: {
  quantStats: QuantStats;
  productInfo?: ProductInfo | null;
  fileName?: string | null;
  resultSummary?: string | null;
  /** DB에 저장된 정성 분석 결과(문항+카테고리). 없으면 정성 섹션은 "대기"로 표시된다. */
  qualitative?: QuestionWithApprovedCategories[] | null;
  /** DB에 저장된 제언 초안(승인 여부 무관). 없으면 Ⅸ장 제언은 "대기"로 표시된다. */
  recommendations?: RecommendationRow[] | null;
  /** DB에 저장된 섹션 단위 정성 분석(Ⅲ.2·Ⅳ·Ⅴ.2·Ⅵ.2). 없으면 규칙 기반 fallback/대기 표시. */
  sectionAnalyses?: SectionAnalyses | null;
  /**
   * 역할 분류 에이전트가 만든 장 목록(PRD 2.2.2절 3단계). 주면 **그 데이터에 실제로 있는
   * 장만** 그 순서·번호로 나온다(케어클은 고객 여정 장이 생기고, 정리습관은 가치·UX 장이
   * 빠진다). 없으면 예전처럼 리바랩스 기준 9장 고정 목차를 쓴다.
   */
  sectionPlan?: SectionPlan | null;
}): ReportWorkspaceSeed {
  const { productInfo, fileName, resultSummary } = input;
  const stats = normalizeQuantStats(input.quantStats);
  const qual = orderQualitativeQuestions(stats, input.qualitative ?? []);
  const recommendations = input.recommendations ?? [];
  const sa = input.sectionAnalyses ?? {};
  const plan = buildReportPlan(stats.featureSatisfaction.map((f) => f.name));

  // 키는 **표준목차 시트의 고정 식별자**(I~X)다. 출력 번호(numeral)는 생성된 장에만 순서대로
  // 붙으므로 키로 쓰면 안 된다 — 이젠오토는 교차 분석이 여섯 번째 장이지만 식별자는 VIII이다.
  const blocksById: Record<string, ReportBlock[]> = {
    I: buildOverviewSection(stats, productInfo, fileName),
    II: buildDemographicsSection(stats),
    IV: buildJourneySection(stats),
    III: buildFeatureSection(stats, qual, sa.featureExperience, {
      featureQualitativeBlocks,
      questionsByKeyPrefix,
      questionText,
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("featureExperience", analysis),
      analysisEvidenceHtml,
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("featureExperience"),
    }),
    V: buildCorePurchaseFactorSection(stats, sa.corePurchaseFactor, {
      questionText,
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("corePurchaseFactor", analysis),
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("corePurchaseFactor"),
    }),
    VI: buildFourValuesSection(stats, qual, sa.fourValues, sa.fourValueItems, {
      fourValueQualitativeBlocks,
      questionsByKeyPrefix,
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("fourValues", analysis),
      analysisEvidenceHtml,
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("fourValues"),
    }),
    VII: buildUxQualitySection(stats, sa.uxQuality, {
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("uxQuality", analysis),
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("uxQuality"),
    }),
    VIII: buildCrossAnalysisSection(stats, sa.crossAnalysis),
    IX: buildNpsSection(stats, qual, {
      questionsByKeys,
      findSurveyQuestion,
      qualitativeBlock,
    }),
    X: buildConclusionSection(stats, resultSummary, qual, recommendations),
  };

  // 에이전트 목차가 있으면 **그 데이터에 실제로 있는 장만** 그 순서·번호로 낸다.
  // 없으면 예전처럼 리바랩스 기준 9장 고정 목차(numeral이 곧 식별자였다).
  const sections: ReportSectionContent[] = input.sectionPlan
    ? input.sectionPlan.chapters.map((chapter) => ({
      numeral: chapter.numeral,
      title: chapter.title,
      blocks: blocksById[chapter.id] ?? [],
    }))
    : plan.map((section) => ({
      numeral: section.numeral,
      title: section.title,
      blocks: blocksById[LEGACY_ID_BY_NUMERAL[section.numeral] ?? section.numeral] ?? [],
    }));

  return { quantStats: stats, productInfo, resultSummary, sections };
}
