import { richTextToInlineHtml } from "@/lib/report/richText";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories, CategoryRow } from "@/lib/db/reports";
import { parseFourValueItemTexts } from "@/lib/pipeline/sectionAnalysis";
import { decodeImprovementLabel } from "@/lib/pipeline/stage2";
import { prepareQuote } from "@/lib/report/quoteEmphasis";
import { categoryPolarityNeedsReview } from "@/lib/pipeline/confidence";
import { findValueQuestion } from "@/lib/report/workspaceFourValues";
import { genericOf } from "@/lib/report/genericStats";
import { IMPROVEMENT_BANNER_HTML } from "@/lib/report/workspaceNps";
import { donutSvg, satisfactionHistogramSvg } from "@/lib/report/chartSvg";
import { DATA_TABLE, dataTableCss } from "@/lib/report/sectionStyle";
import { headingBlock, isFullQuestionText, textBlock, richStaticBlock, PENDING_QUALITATIVE_NOTICE, type ReportBlock } from "@/lib/report/sections";

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

export function escapeHtml(value: string): string {
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
function quoteHtml(rawQuote: string, questionKey: string, rawDisplay: string | undefined, context: string): string {
  const { quote, display: displayText } = prepareQuote(rawQuote, rawDisplay, context);
  return `<div data-report-quote data-quote-source="${escapeHtml(questionKey)}" data-quote-text="${escapeHtml(encodeURIComponent(quote))}" style="margin:0 0 4pt"><p style="display:inline;margin:0">"${richTextToInlineHtml(displayText ?? quote)}"</p></div>`;
}

function quoteGroupButton(questionKey: string, label: string): string {
  return `<span hidden data-copy-ignore contenteditable="false" data-quote-group-source="${escapeHtml(questionKey)}" data-quote-group-label="${escapeHtml(encodeURIComponent(label))}"></span>`;
}

function quoteGroupStart(questionKey: string, label: string): string {
  return `<div data-quote-group>${quoteGroupButton(questionKey, label)}`;
}

export function analysisEvidenceHtml(title: string, content: string): string {
  return `<div data-analysis-evidence data-analysis-label="${escapeHtml(encodeURIComponent(title))}">${content}</div>`;
}

/** 개선 아이디어를 **대분류마다 한 덩어리**로 만든다. 호출부가 덩어리마다 블록을 만들어야
 * 쪽 묶기가 손댈 수 있다 — 한 덩어리로 합치면 케어클 실측 2,944px(A4 세 쪽)짜리 블록이 된다. */
function improvementCategoryHtml(categories: CategoryRow[], questionKey: string): string[] {
  const byMajor = new Map<string, CategoryRow[]>();
  for (const cat of categories) {
    const { major } = decodeImprovementLabel(cat.label);
    const key = major || "기타";
    (byMajor.get(key) ?? byMajor.set(key, []).get(key)!).push(cat);
  }
  const groups: string[] = [];
  for (const [major, subs] of byMajor) {
    const out: string[] = [`${quoteGroupStart(questionKey, major)}<p style="font-weight:700;margin:10pt 0 3pt"><strong>[${richTextToInlineHtml(major)}]</strong></p>`];
    for (const sub of subs) {
      const { sub: subLabel } = decodeImprovementLabel(sub.label);
      if (subLabel) out.push(`<p style="font-weight:700;margin:5pt 0 2pt">&lt;${richTextToInlineHtml(subLabel)}&gt;</p>`);
      sub.quotes.forEach((quote, i) => out.push(quoteHtml(quote, questionKey, sub.quotes_display?.[i], `${major} ${subLabel}`)));
      out.push(BLANK_LINE_HTML);
    }
    out.push(`</div>`);
    groups.push(out.join(""));
  }
  return groups;
}

/**
 * 원본 PDF 실측 글자 크기(`pdftotext -bbox`, 2026-09-02). bbox 높이는 명목 크기의 약 1.11배라
 * 그 비율로 환산한 값이다.
 *  - Ⅲ장(한 칸): 인용문 10pt, 카테고리 라벨 11pt, 극성 배너 13pt
 *  - Ⅴ장(두 칸): 인용문 9pt, 조사 결과 박스 10pt — **두 칸이라 한 칸보다 작다**
 * 웹 편집기 본문이 13px(=9.75pt)이므로 Ⅲ장은 그대로 두고, Ⅴ장 두 칸만 9pt로 줄인다.
 */
const VALUE_COLUMN = { quote: "9pt", label: "9.5pt", header: "11pt" };

/**
 * 인사이트 한 줄 아래에 붙는 **분야별 액션 플랜**(2026-09-16 담당자 확정 양식).
 *
 * 분야명은 본문과 같은 검정 볼드, 문장은 그 아래 줄에 한 단 들여쓴다 — 담당자가 네 가지 배치를
 * 실제로 렌더해 보고 고른 형태다. 삼각형은 분야명 쪽에 붙인다(항목의 시작점을 잡아준다).
 *
 * **간격이 가시성의 전부다**: 인사이트 바로 아래 6pt를 띄워 인사이트와 액션이 붙어 보이지 않게
 * 하고, 분야끼리는 5pt를 둔다(문장-분야 1pt보다 넓어야 묶음이 갈린다).
 *
 * `▸`(U+25B8)는 웹뷰·한글에서는 정상이지만 **PDF 서브셋 폰트에서는 깨진다**(CLAUDE.md의
 * 같은 사례 3건 참고). PDF 경로로 내보내게 되면 `TriangleBullet`처럼 SVG 도형으로 바꿀 것.
 */
function fieldActionsHtml(actions: CategoryRow["field_actions"]): string {
  if (!actions || actions.length === 0) return "";
  // **분야명 한 줄 / 문장 한 줄**(2026-09-17 담당자 선택 H1 배치). 글자 크기는 본문 상속이고,
  // 박스·특수기호 없이 `•`와 볼드만 쓴다(DOCX·HWP로 나가도 그대로 남는다).
  // 간격이 위계를 만든다: 인사이트 아래 8pt(인용문 묶음과 갈라놓기), 분야 사이 6pt(액션끼리는
  // 한 묶음), 분야명과 그 문장 사이 1pt(둘이 한 줄짜리 항목으로 붙어 보이게).
  return actions.map((a, i) =>
    `<p style="font-weight:700;margin:${i === 0 ? 8 : 6}pt 0 0 14pt;text-indent:-11pt;padding-left:11pt">` +
      `• <strong>${escapeHtml(a.field)}</strong></p>` +
    `<p style="line-height:1.5;margin:1pt 0 0 25pt">${richTextToInlineHtml(a.action)}</p>`,
  ).join("");
}

function categoryHtml(cat: CategoryRow, questionKey: string, options: { compact?: boolean } = {}): string[] {
  // 한글 붙여넣기에서 CSS font-weight만으로는 굵게가 유지되지 않는 사례가 있어,
  // 인라인 스타일과 실제 의미 태그를 반드시 함께 낸다.
  const labelSize = options.compact ? `font-size:${VALUE_COLUMN.label};` : "";
  const out = [`<p style="${labelSize}font-weight:700;margin:10pt 0 3pt"><strong>[${richTextToInlineHtml(cat.label)}]</strong></p>`];
  const context = `${cat.label} ${cat.insight_final ?? cat.insight_draft}`;
  cat.quotes.slice(0, 3).forEach((quote, i) => out.push(quoteHtml(quote, questionKey, cat.quotes_display?.[i], context)));
  const hasActions = (cat.field_actions?.length ?? 0) > 0;
  out.push(`<p style="font-weight:700;font-style:italic;margin:5pt 0 ${hasActions ? 0 : 8}pt"><strong><em>→ ${richTextToInlineHtml(cat.insight_final ?? cat.insight_draft)}</em></strong></p>`);
  out.push(fieldActionsHtml(cat.field_actions));
  out.push(BLANK_LINE_HTML);
  // 카테고리 하나를 감싸는 컨테이너. **문서에 보이는 것은 아무것도 더하지 않는다**(테두리도
  // 배경도 없는 순수 래퍼) — 왼쪽 `분석 근거` 패널이 "지금 읽고 있는 묶음"을 정확히 집어내고,
  // 극성 확인이 필요한 묶음이면 그 자리에서 인용문·사유·처리 버튼을 띄우기 위한 표식이다.
  // 한글 복사기(domClipboard.walkBlock)는 블록 자식만 있는 래퍼를 그대로 펼치므로 안전하다.
  const review = cat.polarity_reviewed ? null : categoryPolarityNeedsReview(cat);
  const reviewAttributes = review
    ? ` data-polarity-review="${escapeHtml(encodeURIComponent(review.reason))}" data-polarity-review-signals="${escapeHtml(encodeURIComponent(review.signals.join("|")))}"`
    : "";
  return [
    `<div data-quote-category data-category-question="${escapeHtml(questionKey)}"` +
      ` data-category-label="${escapeHtml(encodeURIComponent(cat.label))}"` +
      ` data-category-polarity="${escapeHtml(cat.polarity ?? "")}"${reviewAttributes}>${out.join("")}</div>`,
  ];
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
    // 화면 전용 안내 — 인쇄·복사·편집 문서에는 들어가지 않는다(data-copy-ignore). PDF에 찍혀 미완성 문서처럼 보였다(2026-10-26).
    ? `<p data-copy-ignore="true" style="margin:0;color:#9ca3af">정성 요약이 아직 없습니다. 이 박스의 AI 요약 생성 버튼으로 채울 수 있습니다.</p>`
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
/** 원본 14쪽 [주관식 응답 감정 분석 도넛+%표 | 응답 요약] 2열 상자. 문항 종류와 무관하게 이 한 양식만 쓴다. */
function emotionBoxBlock(id: string, q: QuestionWithApprovedCategories, counts: Record<string, number>): ReportBlock {
  const panelHead = (title: string) => `<td style="width:50%;vertical-align:top;border:${CSS.border};padding:0"><p style="margin:0;background-color:${CSS.palette.header};color:#315c9c;font-weight:700;text-align:center;padding:5pt">${escapeHtml(title)}</p><div style="padding:6pt">`;
  const donut = donutSvg(counts);
  return richStaticBlock({
    id,
    html: `<table style="${CSS.table};margin:0 0 10pt"><tbody><tr>` +
      `${panelHead("주관식 응답 감정 분석")}${donut ? `<div style="text-align:center">${donut}</div>` : ""}${polarityTableHtml(counts)}</div></td>` +
      `${panelHead("응답 요약")}${responseSummaryHtml(q.polarity_summaries, q.question_key)}</div></td>` +
      `</tr></tbody></table>`,
    summaryQuestionKey: q.question_key,
    summaryKind: "polarity",
  });
}

export function featureQualitativeBlocks(stats: QuantStats, idPrefix: string, questions: QuestionWithApprovedCategories[], reportHasQualitative = false): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let qi = 0;
  const border = CSS.border;

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
    //
    // **단, 이 보고서에 정성 결과가 이미 있으면 대기 안내를 붙이지 않는다**(2026-09-09 정리습관
    // 실측). 그 데이터는 정량 만족도 문항 11개 중 주관식이 딸린 것이 8개뿐이라, 나머지 3개에
    // "정성 분석 승인 후 표시됩니다"가 남아 **영영 오지 않을 것을 기다리라고** 말하고 있었다.
    // 원본도 주관식이 없는 문항은 점수 박스까지만 싣는다. 분석 자체가 아직 안 돈 보고서
    // (questions가 통째로 비어 있음)에서는 대기 안내가 여전히 맞다.
    if (!q) {
      if (reportHasQualitative) continue;
      blocks.push(textBlock({
        id: `${idPrefix}-q${qi}-detail`,
        label: feature.name,
        html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`,
        pending: true,
      }));
      continue;
    }

    // (3) [감정 분석 도넛+%표 | 응답 요약] 2열.
    blocks.push(emotionBoxBlock(`${idPrefix}-q${qi}-emotionbox`, q, counts));

    // (4) 1.긍정 / 2.부정 / 3.중립 상세 카테고리 — **극성마다 한 블록**(polarityDetailBlocks 주석).
    blocks.push(...polarityDetailBlocks(idPrefix, qi, q, counts));
    blocks.push(...fieldActionTableBlock(idPrefix, qi, q, { name: feature.name, kind: "feature" }));
  }
  // 기능 문항 자체가 없는 raw data 에서만 걸린다(정성 유무와 무관).
  return blocks.length
    ? blocks
    : [textBlock({ id: idPrefix, label: "기능별 고객 경험 분석", html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true })];
}


/** 분야 순서 고정 — 데이터에 나온 순서대로 두면 문항마다 열 순서가 달라진다. */
const FIELD_ORDER = ["제품 기획", "마케팅", "SW 개발", "제품 개발"];

/**
 * 문항 끝 **인사이트 종합 및 분야별 액션 플랜** 표(2026-09-16 담당자 요청).
 *
 * 본문은 "인사이트를 읽는 그 자리에서 담당 분야를 본다"이고, 이 표는 그 반대다 — **내 분야
 * 것만 모아 본다**. 그래서 극성 안에서 같은 분야를 한 칸으로 합친다(한 인사이트가 두 분야에
 * 걸리면 그 문장이 분야마다 반복되는데, 분야 기준으로 보는 것이 목적이라 그대로 둔다).
 *
 * 액션이 없는 카테고리도 **인사이트는 본래 색 그대로** 싣고 액션 칸에 `-` 하나만 둔다
 * (연하게 칠하면 "데이터가 없다"로 읽힌다 — 2026-09-16 담당자 지적).
 */
function fieldActionTableBlock(
  idPrefix: string,
  qi: number,
  q: QuestionWithApprovedCategories,
  title: { name: string; kind?: "feature" },
): ReportBlock[] {
  const withActions = q.categories.filter((c) => (c.field_actions?.length ?? 0) > 0);
  if (withActions.length === 0) return [];

  const EDGE = "border-top:1.6pt solid #6182d6";
  const bullet = (text: string, note = "") =>
    `<span style="display:block;text-indent:-8pt;padding-left:8pt">• ${text}${note}</span>`;

  const rows: string[] = [];
  for (const pol of POLARITY_ORDER) {
    const group = q.categories.filter((c) => c.polarity === pol);
    if (group.length === 0) continue;
    // 극성 안에서 분야로 묶는다. 액션이 없는 카테고리는 "" 키로 모아 맨 뒤에 둔다.
    const byField = new Map<string, { insight: string; n: number; action: string }[]>();
    for (const cat of group) {
      const insight = cat.insight_final ?? cat.insight_draft;
      const pairs = cat.field_actions?.length
        ? cat.field_actions.map((a) => [a.field, a.action] as const)
        : [["", ""] as const];
      for (const [field, action] of pairs) {
        byField.set(field, [...(byField.get(field) ?? []), { insight, n: cat.clause_count, action }]);
      }
    }
    const fields = [...FIELD_ORDER, ""].filter((f) => byField.has(f));
    const span = fields.reduce((sum, f) => sum + byField.get(f)!.length, 0);
    let firstOfGroup = true;
    for (const field of fields) {
      const items = byField.get(field)!;
      items.forEach((item, i) => {
        const edge = firstOfGroup ? EDGE : "";
        const polCell = firstOfGroup
          ? `<td rowspan="${span}" style="${CSS.cellWith(POLARITY_BANNER[pol].bg)};font-weight:700;${EDGE}">${POLARITY_LABEL[pol]}<br>의견</td>`
          : "";
        firstOfGroup = false;
        const insightCell = `<td style="${CSS.cellLeft};${i === 0 ? edge : ""}">` +
          bullet(richTextToInlineHtml(item.insight)) + `</td>`;
        if (field === "") {
          // 액션이 없는 묶음은 **분야·액션 칸을 각각 하나로 합치고 `-`를 둔다**(2026-09-16
          // 담당자 지적) — 행마다 빈 칸이 반복되면 없는 것이 여러 번 있는 것처럼 보인다.
          const dash = (style: string) => i === 0
            ? `<td rowspan="${items.length}" style="${style};${edge}">-</td>` : "";
          rows.push(`<tr>${polCell}${dash(CSS.header)}${insightCell}${dash(CSS.cell)}</tr>`);
          return;
        }
        const fieldCell = i === 0
          ? `<td rowspan="${items.length}" style="${CSS.header};${edge}">${escapeHtml(field)}</td>` : "";
        rows.push(`<tr>${polCell}${fieldCell}${insightCell}` +
          `<td style="${CSS.cellLeft};${i === 0 ? edge : ""}">${bullet(richTextToInlineHtml(item.action))}</td></tr>`);
      });
    }
  }

  const noun = title.kind === "feature" ? "기능 인사이트" : "인사이트";
  // **제목은 표 바깥의 문단**이고 열 머리글만 `<thead>`에 둔다(2026-09-17 담당자 지시: "다음
  // 장으로 넘어간 부분에 표 제목이 또 나올 필요는 없다"). `splitBlock`은 thead만 조각마다
  // 되풀이하므로 이어지는 쪽에는 열 이름만 다시 붙는다. 제목을 표의 첫 행(tbody)에 두면
  // thead보다 **아래**에 그려져 열 이름이 제목 위로 올라간다(실측으로 확인).
  const titleHtml = `<p style="border:${DATA_TABLE.borderWidth}pt solid ${CSS.palette.border};border-bottom:none;` +
    `background-color:${CSS.palette.title};padding:3pt 6pt;margin:10pt 0 0;font-size:${DATA_TABLE.fontSize}pt;` +
    `text-align:center;font-weight:700"><strong>[${escapeHtml(title.name)}] ${noun} 종합 및 분야별 액션 플랜</strong></p>`;
  const head = `<tr><td style="${CSS.header};width:11%">구분</td><td style="${CSS.header};width:13%">분야</td>` +
    `<td style="${CSS.header};width:38%">핵심 인사이트</td><td style="${CSS.header};width:38%">액션 플랜</td></tr>`;
  // **제목·머리글은 `<thead>`에 둔다.** 표가 한 쪽을 넘겨 쪼개질 때 `splitBlock`이 조각마다
  // 이 머리를 다시 붙인다 — 예전처럼 tbody에 두면 이어지는 조각에 제목도 열 이름도 없어
  // "표가 중간에서 잘린" 화면이 된다(2026-09-16 담당자 지적). 지금 데이터(케어클 최대 724px,
  // 한 쪽 940px)는 전부 한 쪽에 들어가지만, 문항이 많은 raw data를 위한 안전망이다.
  return [richStaticBlock({
    id: `${idPrefix}-q${qi}-fieldactions`,
    html: `${titleHtml}<table style="${CSS.table}"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`,
  })];
}

/**
 * 극성 상세(1.긍정 / 2.부정 / 3.중립)를 **극성마다 한 블록씩** 만든다.
 *
 * 예전에는 세 극성을 한 블록에 묶어서 냈는데, 그 블록 하나가 A4 두세 쪽 분량(케어클 실측
 * 1,400~2,900px, 한 쪽 본문은 956px)이라 쪽 묶기(`lib/report/paginate.ts`)가 손댈 수 없었다 —
 * 쪽 카드가 통째로 늘어나 화면에서는 "페이지가 안 넘어가고", PDF에서는 브라우저가 그 카드를
 * 임의로 쪼개 여백·푸터가 어긋났다(2026-09-11 담당자 지적 3·5번).
 *
 * 쪼갤 수 있는 가장 자연스러운 자리가 극성 경계다 — 원본 보고서도 긍정/부정/중립을 각각 배너로
 * 시작한다. 블록 id는 `...-detail-1`처럼 `-detail` 접두를 유지해서, 이 문항 블록을 통째로
 * 바꿔치기하는 극성 확인 경로(`useReportEvidence`)와 HWPX 미리보기가 접두 하나로 찾게 한다.
 */
function polarityDetailBlocks(idPrefix: string, qi: number, q: QuestionWithApprovedCategories, counts: Record<string, number>, leadHtml = ""): ReportBlock[] {
  const total = counts.positive + counts.negative + counts.neutral;
  const blocks: ReportBlock[] = [];
  let bannerIndex = 0;
  for (const pol of POLARITY_ORDER) {
    const cats = q.categories.filter((c) => c.polarity === pol);
    if (cats.length === 0) continue;
    bannerIndex += 1;
    const pct = total ? ((counts[pol] / total) * 100).toFixed(1) : "0.0";
    const html = polarityBannerHtml(pol, bannerIndex, pct)
      + quoteGroupStart(q.question_key, `${POLARITY_LABEL[pol]} 의견`)
      + q.categories.filter((c) => c.polarity === pol).flatMap((cat) => categoryHtml(cat, q.question_key)).join("")
      + `</div>`;
    blocks.push(textBlock({
      id: `${idPrefix}-q${qi}-detail-${bannerIndex}`,
      label: q.label,
      html: (bannerIndex === 1 ? leadHtml : "") + html,
      styled: true,
    }));
  }
  // 극성 묶음이 하나도 없어도 응답 요약(leadHtml)은 실려야 한다.
  if (blocks.length === 0 && leadHtml) {
    blocks.push(textBlock({ id: `${idPrefix}-q${qi}-detail-1`, label: q.label, html: leadHtml, styled: true }));
  }
  return blocks;
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
export function qualitativeBlocks(idPrefix: string, questions: QuestionWithApprovedCategories[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let qi = 0;
  for (const q of questions) {
    if (q.categories.length === 0) continue;
    qi += 1;
    const hasPolarity = q.categories.some((c) => c.polarity);
    if (!hasPolarity) {
      // 개선 아이디어(2단): label이 "대분류소분류"로 인코딩돼 있으면 원본 45~49쪽처럼
      // [대분류] → <소분류> → 원문 인용(인사이트 없음) 계층으로 렌더링한다.
      const groups = improvementCategoryHtml(q.categories, q.question_key);
      // 원본 47쪽: 문항 바로 아래 "주요 의견 종합" 띠, 의견 묶음, 끝에 가로선 한 줄. 예전엔 문항 라벨
      // ("개선 아이디어 제안")을 다시 적어 문항 제목과 같은 말이 두 번 나왔다(2026-10-12 담당자 지적).
      const title = IMPROVEMENT_BANNER_HTML;
      const closing = `<p style="margin:4pt 0 12pt;border-bottom:0.75pt solid #9ca3af;font-size:2pt;line-height:1">&nbsp;</p>`;
      if (groups.length > 0) groups[groups.length - 1] += closing;
      // 대분류마다 한 블록. id 접두(`...-q1`)는 그대로라 이 문항을 접두로 찾는 곳은 안 바뀐다.
      blocks.push(...(groups.length > 0 ? groups : [""]).map((html, index) => textBlock({
        id: index === 0 ? `${idPrefix}-q${qi}` : `${idPrefix}-q${qi}-${index + 1}`,
        label: q.label,
        html: (index === 0 ? title : "") + html,
        styled: true,
      })));
      continue;
    }
    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
    for (const c of q.categories) if (c.polarity) counts[c.polarity] += c.clause_count;

    // (1) 질문 라벨 + "주관식 응답 감정 분석" 소제목 — 편집 가능한 프로즈.
    blocks.push(
      textBlock({
        id: `${idPrefix}-q${qi}-intro`,
        label: q.label,
        html: `<p style="font-weight:700;font-size:10.5pt;margin:16pt 0 6pt">${escapeHtml(q.label)}</p>`,
        styled: true,
        // 문항 제목이라 쪽 끝에 혼자 남으면 안 된다(2026-09-30 리바랩스 9쪽 실측).
        keepWithNext: true,
      }),
    );

    // (2) [감정 분석 도넛+%표 | 응답 요약] 2열 — Ⅲ장 기능 문항과 같은 상자(2026-10-06: 이 경로만 도넛·표·
    // 요약을 따로 쌓아 양식이 깨져 보였다). id는 `-chart` 그대로 — 문항 블록을 접두로 찾는 곳이 있다.
    blocks.push(emotionBoxBlock(`${idPrefix}-q${qi}-chart`, q, counts));

    // (3) 극성별 상세(1.긍정 / 2.부정 / 3.중립) — 편집 가능한 프로즈.
    blocks.push(...polarityDetailBlocks(idPrefix, qi, q, counts));
    blocks.push(...fieldActionTableBlock(idPrefix, qi, q, { name: q.label }));
  }
  return blocks;
}

/** 정성 데이터가 있으면 서식 보존 렌더링(styled+rich-static) 블록 목록으로, 없으면 기존처럼
 * "대기" 표시 블록 하나로 만든다. */
export function qualitativeBlock(id: string, label: string, questions: QuestionWithApprovedCategories[]): ReportBlock[] {
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
/**
 * 긍정·부정 두 칸짜리 의견 상자를 **묶음 하나에 한 블록씩** 쪼갠다.
 *
 * 예전에는 한 문항의 긍정·부정 전부가 **한 표의 한 행**이었다. 행 하나가 1,200px(A4 1.2쪽)라
 * 쪽 묶기도, 브라우저의 쪽 나눔도 손댈 수 없어서 인쇄하면 **빈 쪽이 하나 생기고** 그 뒤 장은
 * 종이 끝까지 글이 붙었다(2026-09-11 실측). 칸 제목은 첫 블록에만 넣는다 — 원본 보고서도 두 칸
 * 구성이 다음 쪽으로 이어질 때 제목을 다시 적지 않는다.
 */
function valueOpinionBoxHtml(positive: CategoryRow[], negative: CategoryRow[], questionKey: string): string[] {
  // **묶음 한 쌍이 한 행**이고, 행 사이 가로선은 지운다(2026-09-17).
  //
  // 한 행 두 칸(칸 하나에 그 극성 전부)으로 두면 가로선은 없어지지만, 쪽을 넘길 때 그 거대한
  // 칸을 세로로 잘라야 한다 — 실측에서 조각마다 **한쪽 칸만 차서** 긍정만 있는 쪽, 부정만 있는
  // 쪽이 줄줄이 나왔다(담당자: "제일 심각합니다"). 쌍 단위 행이면 쪽을 넘겨도 **양쪽이 같이**
  // 이어지고, 가로선만 지우면 화면은 한 칸으로 이어진 것처럼 보인다(원본 34쪽과 같은 인상).
  const rows = Math.max(positive.length, negative.length, 1);
  const body = Array.from({ length: rows }, (_, index) => {
    const last = index === rows - 1;
    const left = valueOpinionColumnHtml("긍정", positive.slice(index, index + 1), questionKey, index === 0, last);
    const right = valueOpinionColumnHtml("부정", negative.slice(index, index + 1), questionKey, index === 0, last);
    return `<tr>${left}${right}</tr>`;
  }).join("");
  const head = `<tr>${valueOpinionHeaderHtml("긍정 의견", "#dce7fa")}${valueOpinionHeaderHtml("부정 의견", "#fde4d0")}</tr>`;
  return [`${quoteGroupStart(questionKey, "긍정·부정 의견")}<table style="${CSS.table};margin:0">` +
    `<thead>${head}</thead><tbody>${body}</tbody></table></div>`];
}

/** 의견 표의 머리 칸(긍정/부정). 표가 쪽을 넘겨 쪼개져도 조각마다 따라붙는다. */
function valueOpinionHeaderHtml(title: string, background: string): string {
  return `<th style="width:50%;border:${CSS.border};padding:6pt;background-color:${background};` +
    `font-size:${VALUE_COLUMN.header};font-weight:700;text-align:center">${title}</th>`;
}

function valueOpinionColumnHtml(title: string, categories: CategoryRow[], questionKey: string, first: boolean, last: boolean): string {
  const body = categories.length
    ? categories.map((category) => categoryHtml(category, questionKey, { compact: true }).join("")).join("")
    // 제목 없는 이어지는 칸이 비었다는 것은 "그 쪽 의견이 먼저 끝났다"는 뜻이라 안내를 적지 않는다.
    : "";
  // 글자 크기를 명시하지 않으면 이 칸만 문서 기본값(16px)으로 렌더된다. 원본 실측값(9pt,
  // VALUE_COLUMN 주석 참고)에 맞춘다 — 두 칸으로 나뉜 자리라 Ⅲ장 한 칸(10pt)보다 작다.
  // 가로선을 지워 칸이 세로로 이어져 보이게 한다 — 위/아래 선은 표의 바깥 경계에만 남긴다.
  // 쪽을 넘긴 조각의 첫 행은 위 선이 없지만, 표 머리(`<thead>`)가 그 자리를 대신한다.
  const edges = `border-left:${CSS.border};border-right:${CSS.border}` +
    `;border-top:${first ? CSS.border : "none"};border-bottom:${last ? CSS.border : "none"}`;
  return `<td data-quote-section="${escapeHtml(title)} 의견" style="width:50%;vertical-align:top;${edges};padding:${first ? 10 : 0}pt 10pt ${last ? 10 : 0}pt;background-color:#ffffff;font-size:${VALUE_COLUMN.quote};line-height:1.65">
    ${body}
  </td>`;
}

/** raw data 설문 항목(stats.surveyQuestions)에서 특정 단계(stage)의 n번째 문항 Q번호와
 * 실제 원문을 찾는다 — Ⅴ장 Q번호도 "raw data가 ground truth" 원칙(CLAUDE.md)을 따라
 * 하드코딩하지 않고 여기서 계산한다. */
export function findSurveyQuestion(stats: QuantStats, stage: string, occurrenceIndex: number): { qno: number; question: string } | null {
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
function valueMeanSdTableHtml(name: string, mean: number, sd: number): string {
  // **가치 이름은 표의 제목 행**이다(원본 34쪽). 예전엔 표 위에 굵은 문단으로 한 번 더 적어
  // 문항 제목과 같은 말이 두 번 나왔다(2026-09-17 담당자 지적).
  return (
    `<table style="${CSS.table};margin:6pt 0 10pt">` +
    `<tbody><tr><td colspan="2" style="${CSS.title}">${escapeHtml(name)}</td></tr>` +
    `<tr><th style="${CSS.header}">평균</th><th style="${CSS.header}">표준편차</th></tr>` +
    `<tr><td style="${CSS.cell}">전체 ${mean.toFixed(2)}</td><td style="${CSS.cell}">${sd.toFixed(2)}</td></tr></tbody>` +
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
  // **"AI 요약 생성" 버튼은 두지 않는다**(2026-09-02 담당자 요청) — 이 박스는 정성 분석
  // 과정에서 runFourValueItemAnalysis가 항상 채운다. 예전엔 그 섹션이 실행 이력 테이블의
  // 체크 제약 때문에 한 번도 실행되지 못해(schema.sql 참고) 담당자가 매번 버튼을 눌러야
  // 했는데, 그건 자동 생성이 고장 나 있다는 신호였지 사람이 할 일이 아니었다.
  void questionKey;
  // 가치 전용 프롬프트는 3~4문장을 줄바꿈으로 분리한다. 단순 <br>보다 실제 <p>가 한글의
  // 붙여넣기에서 문단/문단 간격으로 더 안정적으로 변환되므로 줄마다 문단을 만든다.
  // richTextToInlineHtml은 **__강조__**를 <strong><u>로 바꿔 HWP에도 강조 의미가 남는다.
  const formattedText = text.split(/\r?\n+/).filter(Boolean)
    .map((line) => `<p style="margin:0 0 5pt;line-height:1.65">${richTextToInlineHtml(line)}</p>`)
    .join("");
  const action = "";
  return (
    `<table style="${CSS.table};margin:0 0 14pt"><tbody>` +
    `<tr><td style="${CSS.header};color:#000000">${action}[ ${escapeHtml(label)} 조사 결과 ]</td></tr>` +
    `<tr><td style="${CSS.cellLeft};padding:8pt">${text ? formattedText : `<p data-copy-ignore="true" style="margin:0;color:#9ca3af">이 항목의 정성 요약이 아직 생성되지 않았습니다. 의견 분석을 다시 실행하면 함께 채워집니다.</p>`}</td></tr>` +
    `</tbody></table>`
  );
}

export function fourValueQualitativeBlocks(stats: QuantStats, idPrefix: string, questions: QuestionWithApprovedCategories[], itemsText?: string, reportHasQualitative = false): ReportBlock[] {
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
    // 설문 문항 원문이 있을 때만 `Q14. …` 제목을 단다 — 없으면 가치 이름이 바로 아래 표의
    // 제목 행에 이미 있어서 같은 말이 두 번 나온다(2026-09-17 담당자 지적).
    if (survey) {
      blocks.push(headingBlock({ id: `${idPrefix}-q${index + 1}`, variant: "question", text: `Q${survey.qno}. ${survey.question}` }));
    }
    blocks.push(richStaticBlock({
      id: `${idPrefix}-meansd-${index + 1}`,
      html: valueMeanSdTableHtml(`${value.name} 만족도`, value.mean, value.sd),
    }));
    if (question && question.categories.length > 0) {
      const positive = question.categories.filter((category) => category.polarity === "positive");
      const negative = question.categories.filter((category) => category.polarity === "negative");
      blocks.push(...valueOpinionBoxHtml(positive, negative, question.question_key).map((html, part) => richStaticBlock({
        id: part === 0 ? `${idPrefix}-opinion-box-${index + 1}` : `${idPrefix}-opinion-box-${index + 1}-${part + 1}`,
        html,
      })));
      blocks.push(richStaticBlock({
        id: `${idPrefix}-summary-${index + 1}`,
        html: valueSummaryBoxHtml(value.name, question.polarity_summaries, question.question_key, itemTexts[value.name]),
        summaryQuestionKey: question.question_key,
        summaryKind: "value",
      }));
    } else if (!reportHasQualitative) {
      // 정성 분석이 끝난 보고서인데 이 가치에 주관식이 없으면(투블럭 실측) 기다릴 것이 없다 —
      // 대기 안내 대신 점수 표까지만 싣는다. 기능 문항과 같은 규칙이다.
      blocks.push(textBlock({ id: `${idPrefix}-pending-${index + 1}`, label: `${value.name} 정성 분석`, html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true }));
    }
  });
  return blocks;
}

