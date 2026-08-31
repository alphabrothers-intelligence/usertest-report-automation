import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";
import { satisfactionHistogramSvg } from "@/lib/report/chartSvg";
import { richTextToInlineHtml } from "@/lib/report/richText";
import { dataTableCss } from "@/lib/report/sectionStyle";
import {
  headingBlock,
  npsBlock,
  PENDING_QUALITATIVE_NOTICE,
  richStaticBlock,
  textBlock,
  type ReportBlock,
} from "@/lib/report/sections";

export type NpsSectionServices = {
  questionsByKeys: (questions: QuestionWithApprovedCategories[], keys: string[]) => QuestionWithApprovedCategories[];
  findSurveyQuestion: (stats: QuantStats, stage: string, occurrenceIndex: number) => { qno: number; question: string } | null;
  qualitativeBlock: (id: string, label: string, questions: QuestionWithApprovedCategories[]) => ReportBlock[];
};

function npsReferenceHtml(stats: QuantStats): string {
  const nps = stats.nps;
  const css = dataTableCss();
  const rule = "border-top:1.25pt solid #6388e6";
  const head = css.title;
  const cell = css.cell;
  const npsDivider = "border-right:2pt double #4b5563";
  return [
    `<div style="margin:4pt 0 10pt;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111827;font-size:10.5pt;line-height:1.7">`,
    `<div style="${rule};padding:8pt 8pt 7pt;margin-top:6pt">`,
    `<p style="margin:0 0 3pt;padding-left:12pt;text-indent:-10pt">• 글로벌 자문 업체인 Bain &amp; Company가 실제 고객 충성도를 측정하기 위해 제시한 순수 고객추천/구매 지수 조사</p>`,
    `<p style="margin:0 0 3pt;padding-left:12pt;text-indent:-10pt">• 제품별 구매/추천 의향 조사를 통하여 고객 유지율 및 신뢰도 분석 진행하며, 사용성 테스트를 통해 NPS의 유형별 비율 산정</p>`,
    `<p style="margin:0;padding-left:12pt;text-indent:-10pt">• 창업 초기기업의 경우, 통상적으로 NPS 지수가 0보다 크면 충성 고객을 확보해 시장성이 있는 제품으로 판단</p>`,
    `</div>`,
    `<div style="${rule};padding:8pt 8pt 7pt">`,
    `<p style="margin:0 0 4pt"><strong>− 구매/추천고객 (PROMOTER, 9~10점)</strong><br><span style="padding-left:12pt">자발적으로 구매/추천할 만큼 만족도가 높은 잠재 고객</span></p>`,
    `<p style="margin:0 0 4pt"><strong>− 중립 고객 (PASSIVE, 7~8점)</strong><br><span style="padding-left:12pt">제품에 대한 보증까지는 응하지 않을 가능성이 큰 고객</span></p>`,
    `<p style="margin:0"><strong>− 비구매/비추천 고객 (DETRACTOR, 0~6점)</strong><br><span style="padding-left:12pt">실제 비구매 및 다른 이에게도 쓰지 않도록 적극적으로 의견을 표출할 수 있는 고객</span></p>`,
    `</div>`,
    `<div style="${rule};padding:8pt 8pt 10pt">`,
    `<p style="margin:0 0 4pt">− MVP TEST 내부 DB 분석 결과, NPS 지수가 음수가 나오면 시장성이 낮다고 판단함</p>`,
    `<p style="margin:0">− 실제 제품 사용 경험을 바탕으로 산정한 데이터가 아니기에 음수로 산정될 수 있으며, 지속해서 NPS 지수 추적 관리를 통해 PMF(제품시장적합도)를 높일 필요성이 있음</p>`,
    `</div>`,
    `<table style="${css.table};margin:8pt 0 0;table-layout:fixed"><thead><tr>`,
    `<th style="${head}">평균 구매 의향</th><th style="${head};${npsDivider}">NPS 지수</th><th style="${head}">구매 고객<br>(PROMOTERS)</th><th style="${head}">중립 고객<br>(PASSIVES)</th><th style="${head}">비구매 고객<br>(DETRACTORS)</th>`,
    `</tr></thead><tbody><tr>`,
    `<td style="${cell}">${nps.rawMean.toFixed(2)}</td><td style="${cell};${npsDivider}">${nps.npsScore}</td><td style="${cell}">${nps.promoterPct} %</td><td style="${cell}">${nps.passivePct} %</td><td style="${cell}">${nps.detractorPct} %</td>`,
    `</tr></tbody></table></div>`,
  ].join("");
}

function npsJudgmentHtml(
  nps: QuantStats["nps"],
  generated?: { lines: string[] } | null,
): string {
  const generatedLines = generated?.lines?.filter((line) => typeof line === "string" && line.trim()) ?? [];
  if (generatedLines.length === 3) {
    return [
      `<div style="margin:8pt 0 0;font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.7">`,
      ...generatedLines.map((line, index) => `<p style="margin:0 ${index === 2 ? "0" : "0 5pt"};padding-left:14pt;text-indent:-12pt">▶ ${richTextToInlineHtml(line.trim())}</p>`),
      `</div>`,
    ].join("");
  }
  const marketability = nps.npsScore >= 0 ? "양호한 시장성" : "낮은 시장성";
  const urgency = nps.npsScore >= 0 ? "추세를 지속적으로 관리할 필요가 있음" : "개선 전략의 수립이 시급하다고 사료됨";
  return [
    `<div style="margin:8pt 0 0;font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.7">`,
    `<p style="margin:0 0 5pt;padding-left:14pt;text-indent:-12pt">▶ 구매의향, 추천의향을 NPS 지수로 환산했을 때, ${nps.npsScore}으로 <strong><u>'${marketability}'</u></strong> 수준으로 판단되어 ${urgency}</p>`,
    `<p style="margin:0 0 5pt;padding-left:14pt;text-indent:-12pt">▶ 구매 고객 대비 중립 고객(${nps.passivePct}%) 비율을 확인할 때, <strong><u>사용자들의 구매 전환을 일으키는 요소를 보완할 필요가 있음</u></strong></p>`,
    `<p style="margin:0;padding-left:14pt;text-indent:-12pt">▶ 전체 기능에 대한 고도화 및 사용자에게 도출된 불편 사항, 개선 사항을 반영하여 <strong><u>사용자의 만족도를 높이는 방안이 필요함</u></strong></p>`,
    `</div>`,
  ].join("");
}

function overallSatisfactionResultHtml(stats: QuantStats): string {
  const distribution = stats.overallSatisfactionDistribution ?? Array.from({ length: 11 }, () => 0);
  const hasDistribution = distribution.some((count) => count > 0);
  const total = distribution.reduce((sum, value) => sum + value, 0) || 1;
  const bracketPct = (start: number, end: number) => Math.round((distribution.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / total) * 1000) / 10;
  const css = dataTableCss();
  const border = css.border;
  return [
    `<div style="font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111827;font-size:10.5pt;line-height:1.6">`,
    `<div style="border-top:4px solid #4fc8e8;border-left:${border};border-right:${border};border-bottom:${border};padding:0;margin:0 0 10pt">`,
    `<p style="margin:0;background-color:${css.palette.title};padding:5pt;text-align:center;font-weight:700">[ 전반적 만족도 조사 결과 ]</p>`,
    `<div style="padding:7pt;text-align:center">${hasDistribution ? satisfactionHistogramSvg(distribution) : `<p style="margin:20pt 0;color:#64748b">원본 raw data에서 만족도 분포를 불러오는 중입니다.</p>`}</div></div>`,
    `<table style="${css.table};margin:0 0 10pt"><thead><tr><th colspan="3" style="${css.title}">종합만족도 평가</th></tr><tr><th style="${css.header}">구분</th><th style="${css.header}">평균 만족도</th><th style="${css.header}">표준편차</th></tr></thead><tbody><tr><td style="${css.cell}">전체</td><td style="${css.cell}">${stats.overallSatisfaction.mean.toFixed(2)}</td><td style="${css.cell}">${stats.overallSatisfaction.sd.toFixed(2)}</td></tr></tbody></table>`,
    `<p style="margin:7pt 0 3pt;font-weight:700">[만족도 구간별 비율]</p>`,
    `<table style="${css.table};margin:0"><thead><tr><th style="${css.cellWith("#fde4d0")};font-weight:700">부정 고객<br>(0~6점)</th><th style="${css.cellWith("#e8e8e8")};font-weight:700">중립 고객<br>(7~8점)</th><th style="${css.cellWith("#dce8fb")};font-weight:700">긍정 고객<br>(9~10점)</th></tr></thead><tbody><tr><td style="${css.cell}">${bracketPct(0, 6)}%</td><td style="${css.cell}">${bracketPct(7, 8)}%</td><td style="${css.cell}">${bracketPct(9, 10)}%</td></tr></tbody></table>`,
    `</div>`,
  ].join("");
}

function overallSatisfactionInsightHtml(stats: QuantStats): string {
  const distribution = stats.overallSatisfactionDistribution ?? Array.from({ length: 11 }, () => 0);
  const total = distribution.reduce((sum, value) => sum + value, 0) || 1;
  const bracketPct = (start: number, end: number) => Math.round((distribution.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / total) * 1000) / 10;
  const negative = bracketPct(0, 6);
  const neutral = bracketPct(7, 8);
  const positive = bracketPct(9, 10);
  return [
    `<div style="font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111827;font-size:10.5pt;line-height:1.7;margin:10pt 0 2pt">`,
    `<p style="margin:0 0 4pt;font-weight:700">[주요 시사점]</p>`,
    `<p style="margin:0 0 3pt;padding-left:12pt;text-indent:-10pt">• 긍정 고객(9~10점)은 ${positive}%이며, 전반적 만족도 평균은 ${stats.overallSatisfaction.mean.toFixed(2)}점으로 확인됨.</p>`,
    `<p style="margin:0 0 3pt;padding-left:12pt;text-indent:-10pt">• 중립 고객(7~8점)은 ${neutral}%이며, 추가 사용·추천 의향으로 전환될 수 있는 응답 비율을 확인함.</p>`,
    `<p style="margin:0;padding-left:12pt;text-indent:-10pt">• 부정 고객(0~6점)은 ${negative}%이며, 해당 응답에서 언급된 개선 요구는 다음 개선 아이디어 문항에서 확인할 수 있음.</p>`,
    `</div>`,
  ].join("");
}

/** 섹션 Ⅷ: 종합 만족도 및 NPS 지수. */
export function buildNpsSection(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  services: NpsSectionServices,
): ReportBlock[] {
  const [overallQuestion] = services.questionsByKeys(qualitative, ["overallSatisfaction"]);
  const [npsQuestion] = services.questionsByKeys(qualitative, ["nps"]);
  const [improvementQuestion] = services.questionsByKeys(qualitative, ["improvementIdea"]);
  const overallSurvey = services.findSurveyQuestion(stats, "종합 만족도", 0);
  const improvementSurvey = services.findSurveyQuestion(stats, "개선 아이디어", 0);
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
    richStaticBlock({ id: "nps-reference-and-summary", html: npsReferenceHtml(stats) }),
    richStaticBlock({ id: "nps-judgments", html: npsJudgmentHtml(stats.nps, npsQuestion?.polarity_summaries?.nps_judgment) }),
    headingBlock({
      id: "nps-overall-question",
      variant: "question",
      number: overallSurvey ? `Q${overallSurvey.qno}` : undefined,
      text: overallSurvey?.question ?? overallQuestion?.label ?? "전반적인 만족도(종합 점수)는 몇 점입니까?",
    }),
    richStaticBlock({ id: "nps-overall-result", html: overallSatisfactionResultHtml(stats) }),
    richStaticBlock({ id: "nps-overall-insights", html: overallSatisfactionInsightHtml(stats) }),
    headingBlock({ id: "nps-improvement-heading", variant: "numbered", number: "2", text: "개선 아이디어" }),
    headingBlock({
      id: "nps-improvement-question",
      variant: "question",
      number: improvementSurvey ? `Q${improvementSurvey.qno}` : undefined,
      text: improvementSurvey?.question ?? improvementQuestion?.label ?? "개선 아이디어 제안",
    }),
    ...(improvementQuestion
      ? services.qualitativeBlock("nps-improvement-idea", "개선 아이디어", [improvementQuestion])
      : [textBlock({ id: "nps-improvement-idea", label: "개선 아이디어", html: `<p>${PENDING_QUALITATIVE_NOTICE}</p>`, pending: true })]),
  ];
}
