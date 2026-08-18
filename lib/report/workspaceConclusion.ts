import type { QuestionWithApprovedCategories, RecommendationRow } from "@/lib/db/reports";
import { splitOverallDirection } from "@/lib/pdf/sectionsQualitative";
import type { QuantStats } from "@/lib/quant/compute";
import { richTextToHtml } from "@/lib/report/richText";
import { headingBlock, quadrantBlock, richStaticBlock, rowGroupBlock, type ReportBlock } from "@/lib/report/sections";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slug(label: string): string {
  return label.replace(/\s+/g, "-").replace(/[^\w가-힣-]/g, "");
}

function polarityPercentages(qualitative: QuestionWithApprovedCategories[], featureName: string) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const question of qualitative.filter((item) => item.question_key.startsWith("feature:"))) {
    for (const category of question.categories) {
      if (!question.label.includes(featureName) && !category.label.includes(featureName)) continue;
      if (category.polarity && category.polarity in counts) counts[category.polarity] += category.clause_count;
    }
  }
  const total = counts.positive + counts.neutral + counts.negative;
  const percentage = (value: number) => total ? Math.round((value / total) * 1000) / 10 : 0;
  return {
    positive: percentage(counts.positive),
    neutral: percentage(counts.neutral),
    negative: percentage(counts.negative),
  };
}

function conclusionFeatureTableHtml(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  ranked: QuantStats["relativeImportance"],
): string {
  const rows = ranked.map((item) => ({
    name: item.name,
    satisfaction: stats.featureSatisfaction.find((feature) => feature.name === item.name)?.mean ?? 0,
    importance: item.score,
    ...polarityPercentages(qualitative, item.name),
  }));
  const maxSatisfaction = Math.max(...rows.map((row) => row.satisfaction));
  const minSatisfaction = Math.min(...rows.map((row) => row.satisfaction));
  const maxImportance = Math.max(...rows.map((row) => row.importance));
  const minImportance = Math.min(...rows.map((row) => row.importance));
  const maxPositive = Math.max(...rows.map((row) => row.positive));
  const maxNeutral = Math.max(...rows.map((row) => row.neutral));
  const maxNegative = Math.max(...rows.map((row) => row.negative));
  const cell = (value: string | number, tone?: "best" | "worst" | "neutral") => {
    const background = tone === "best" ? "#dce7f9" : tone === "worst" ? "#fde4d0" : tone === "neutral" ? "#e7e7e7" : "#ffffff";
    return `<td style="border:0.75pt solid #d4d4d8;padding:5pt 4pt;text-align:center;background-color:${background}">${value}</td>`;
  };

  return [
    `<table style="border-collapse:collapse;width:100%;table-layout:fixed;margin:0 0 10pt;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:9.5pt;line-height:1.35">`,
    `<thead><tr style="background-color:#f4f4f5">`,
    `<th style="border:0.75pt solid #d4d4d8;padding:5pt 3pt">기능명</th><th style="border:0.75pt solid #d4d4d8;padding:5pt 3pt">평균 만족도<br>(점)</th><th style="border:0.75pt solid #d4d4d8;padding:5pt 3pt">상대 중요도</th><th style="border:0.75pt solid #d4d4d8;padding:5pt 3pt">긍정 비율<br>(%)</th><th style="border:0.75pt solid #d4d4d8;padding:5pt 3pt">중립 비율<br>(%)</th><th style="border:0.75pt solid #d4d4d8;padding:5pt 3pt">부정 의견<br>(%)</th>`,
    `</tr></thead><tbody>`,
    ...rows.map((row) => `<tr>${cell(escapeHtml(row.name))}${cell(row.satisfaction.toFixed(2), row.satisfaction === maxSatisfaction ? "best" : row.satisfaction === minSatisfaction ? "worst" : undefined)}${cell(row.importance.toFixed(2), row.importance === maxImportance ? "best" : row.importance === minImportance ? "worst" : undefined)}${cell(row.positive.toFixed(1), row.positive === maxPositive ? "best" : undefined)}${cell(row.neutral.toFixed(1), row.neutral === maxNeutral ? "neutral" : undefined)}${cell(row.negative.toFixed(1), row.negative === maxNegative ? "worst" : undefined)}</tr>`),
    `</tbody></table>`,
  ].join("");
}

function resultSummaryPart(resultSummary: string | null | undefined, aliases: string[], fallback: string): string {
  if (!resultSummary?.trim()) return fallback;
  const headings = [...resultSummary.matchAll(/^##\s+(.+?)\s*$/gm)];
  const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const index = headings.findIndex((heading) => aliases.some((alias) => normalize(heading[1]).includes(normalize(alias))));
  if (index < 0) return fallback;
  const start = (headings[index].index ?? 0) + headings[index][0].length;
  const end = headings[index + 1]?.index ?? resultSummary.length;
  const part = resultSummary.slice(start, end).trim();
  return part ? richTextToHtml(part) : fallback;
}

/** "항목 | 주요 의견" 표에서 기능별 고객 경험 평가를 제외한 나머지 행들. 각 행의 오른쪽 칸
 * 내용을 HTML로 만들어 돌려주고, 표 구조 자체는 row-group 블록이 그린다(행별로 표를 따로
 * 만들면 표가 끊겨 보이기 때문 — 2026-08-18). */
function conclusionEvidenceRows(stats: QuantStats, resultSummary: string | null | undefined): { id: string; label: string; html: string }[] {
  const values = [
    ["기능적 가치", stats.fourValues.functional.mean],
    ["심미적 가치", stats.fourValues.aesthetic.mean],
    ["경제적 가치", stats.fourValues.economic.mean],
    ["사회·공공적 가치", stats.fourValues.social.mean],
  ] as const;
  const topFactors = [...stats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage).slice(0, 3);
  const usability = stats.uxQuality.usability;
  const fun = stats.uxQuality.fun;
  const lowestUx = [...usability, ...fun].sort((a, b) => a.mean - b.mean)[0];
  const coreFallback = `<p style="margin:0">상위 선택 항목은 ${topFactors.map((item) => `<strong>${escapeHtml(item.label)}(${item.percentage}%)</strong>`).join(", ")}로 집계되었습니다.</p>`;
  const valuesFallback = `<p style="margin:0">${values.map(([labelText, value]) => `<strong>${labelText}</strong> ${value.toFixed(2)}점`).join(", ")}으로 집계되었습니다. 항목별 수치는 원자료 기반 정량 결과입니다.</p>`;
  const uxFallback = `<p style="margin:0">실용성 평균은 ${(usability.reduce((sum, item) => sum + item.mean, 0) / Math.max(usability.length, 1)).toFixed(2)}점, 즐거움 평균은 ${(fun.reduce((sum, item) => sum + item.mean, 0) / Math.max(fun.length, 1)).toFixed(2)}점입니다.${lowestUx ? ` 가장 낮은 항목은 <strong>${escapeHtml(lowestUx.name)}(${lowestUx.mean.toFixed(2)}점)</strong>입니다.` : ""}</p>`;
  const npsFallback = `<p style="margin:0">전반적 만족도는 <strong>${stats.overallSatisfaction.mean.toFixed(2)}점</strong>, 평균 구매 의향은 <strong>${stats.nps.rawMean.toFixed(2)}점</strong>, NPS 지수는 <strong>${stats.nps.npsScore}</strong>입니다.</p>`;
  const crossFallback = `<p style="margin:0">연령·성별별 차이는 교차 분석의 정량 차트와 표를 함께 참조합니다.</p>`;
  const font = `font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.5pt;line-height:1.65`;
  const wrap = (html: string) => `<div style="${font}">${html}</div>`;
  return [
    { id: "conclusion-row-core-factor", label: "핵심구매요소", html: wrap(resultSummaryPart(resultSummary, ["핵심구매요소"], coreFallback)) },
    { id: "conclusion-row-four-values", label: "4대 가치 만족도", html: wrap(resultSummaryPart(resultSummary, ["4대 가치", "4대가치"], valuesFallback)) },
    { id: "conclusion-row-ux-quality", label: "사용자 경험 품질 평가", html: wrap(resultSummaryPart(resultSummary, ["사용자 경험 품질", "UX"], uxFallback)) },
    { id: "conclusion-row-cross-analysis", label: "교차 분석", html: wrap(resultSummaryPart(resultSummary, ["교차 분석"], crossFallback)) },
    { id: "conclusion-row-nps", label: "종합 만족도 및 NPS 지수", html: wrap(resultSummaryPart(resultSummary, ["종합 만족도", "NPS"], npsFallback)) },
  ];
}

function conclusionStrategyTableHtml(stats: QuantStats, recommendations: RecommendationRow[]): string {
  const devPriority = recommendations.find((item) => item.section === "dev_priority");
  const overallDirection = recommendations.find((item) => item.section === "overall_direction");
  const featureRecommendations = recommendations.filter((item) => item.section.startsWith("feature_improvement:"));
  const cell = "border:0.75pt solid #d4d4d8;padding:10pt 12pt;vertical-align:top";
  const label = "border:0.75pt solid #d4d4d8;padding:10pt 7pt;vertical-align:middle;text-align:center;background-color:#dfe7f6;font-weight:700;width:18%";
  const priority = devPriority
    ? richTextToHtml(splitOverallDirection(devPriority.final ?? devPriority.draft).rest ?? devPriority.final ?? devPriority.draft)
    : `<p style="margin:0;color:#6b7280">개발 우선순위 제언은 정성 분석 승인 후 표시됩니다.</p>`;
  const overall = overallDirection
    ? richTextToHtml(overallDirection.final ?? overallDirection.draft)
    : `<p style="margin:0">핵심구매요소, 만족도·상대 중요도, NPS 지수를 함께 참조하여 우선 개선 항목을 검토할 필요가 있습니다. 현재 NPS 지수는 <strong>${stats.nps.npsScore}</strong>입니다.</p>`;
  const features = featureRecommendations.length > 0
    ? featureRecommendations.map((recommendation, index) => {
      const [title, ...body] = (recommendation.final ?? recommendation.draft).split(/\r?\n/);
      return `<p style="margin:9pt 0 3pt;font-weight:700"><strong>${index + 1}. ${escapeHtml(title.trim())}</strong></p>${richTextToHtml(body.join("\n"))}`;
    }).join("")
    : `<p style="margin:0;color:#6b7280">기능 개선 제언은 정성 분석 승인 후 표시됩니다.</p>`;
  return `<table style="border-collapse:collapse;width:100%;margin:0 0 12pt;table-layout:fixed;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.5pt;line-height:1.65"><tbody><tr><td style="${label}">전반적 방향성</td><td style="${cell}">${overall}</td></tr><tr><td style="${label}">개발 우선순위 제언</td><td style="${cell}">${priority}</td></tr><tr><td style="${label}">기능 개선 제안</td><td style="${cell}">${features}</td></tr></tbody></table>`;
}

function featureCustomerRecommendationsHtml(recommendations: RecommendationRow[]): string {
  const row = recommendations.find((item) => item.section === "feature_customer_recommendations");
  if (!row) return `<p style="margin:0;color:#6b7280;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.5pt">기능별 고객 제언은 정성 분석 승인 후 표시됩니다.</p>`;
  let parsed: { features: { featureName: string; actions: string[] }[] };
  try {
    parsed = JSON.parse(row.final ?? row.draft);
  } catch {
    return `<p style="margin:0;color:#b91c1c">기능별 고객 제언 데이터를 읽지 못했습니다.</p>`;
  }
  const banner = "background-color:#dbe5f5;padding:6pt 8pt;font-weight:700;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.5pt;margin:12pt 0 0";
  const cell = "border:0.75pt solid #d4d4d8;padding:7pt 10pt;vertical-align:middle;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.5pt";
  const label = "border:0.75pt solid #d4d4d8;padding:7pt 10pt;vertical-align:middle;text-align:center;background-color:#f3f4f6;font-weight:700;width:18%";
  return parsed.features.map((feature, featureIndex) => {
    const rows = feature.actions.map((action, actionIndex) => `<tr><td style="${label}">고객 제언 ${actionIndex + 1}</td><td style="${cell}">${escapeHtml(action)}</td></tr>`).join("");
    return `<p style="${banner}">[기능 ${featureIndex + 1}] ${escapeHtml(feature.featureName)}</p><table style="border-collapse:collapse;width:100%;margin:4pt 0 0;table-layout:fixed"><tbody>${rows}</tbody></table>`;
  }).join("");
}

export function buildConclusionSection(
  stats: QuantStats,
  resultSummary: string | null | undefined,
  qualitative: QuestionWithApprovedCategories[],
  recommendations: RecommendationRow[],
): ReportBlock[] {
  const rankedImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  return [
    headingBlock({ id: "conclusion-result-heading", variant: "numbered", number: "1", text: "사용성테스트 결과 요약" }),
    // 원본처럼 머리행부터 마지막 행까지 이어지는 표 하나. 기능별 고객 경험 평가 행만 차트를
    // 품기 때문에 정적 HTML 표가 아니라 row-group 블록으로 그린다.
    rowGroupBlock({
      id: "conclusion-summary-table",
      headers: ["항목", "주요 의견"],
      rows: [
        {
          id: "conclusion-row-feature-experience",
          label: "기능별 고객 경험 평가",
          blocks: [
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
            richStaticBlock({ id: "conclusion-feature-summary-table", html: conclusionFeatureTableHtml(stats, qualitative, rankedImportance) }),
            richStaticBlock({
              id: "conclusion-feature-summary-bullets",
              html: `<div style="font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.5pt;line-height:1.65">${resultSummaryPart(resultSummary, ["기능별 고객 경험 평가"], "")}</div>`,
            }),
          ],
        },
        ...conclusionEvidenceRows(stats, resultSummary).map((row) => ({
          id: row.id,
          label: row.label,
          blocks: [richStaticBlock({ id: `${row.id}-body`, html: row.html })],
        })),
      ],
    }),
    headingBlock({ id: "conclusion-strategy-heading", variant: "numbered", number: "2", text: "개선 전략 제언" }),
    richStaticBlock({ id: "conclusion-strategy-table", html: conclusionStrategyTableHtml(stats, recommendations) }),
    headingBlock({ id: "conclusion-feature-customer-heading", variant: "numbered", number: "3", text: "기능별 고객 제언 종합" }),
    richStaticBlock({ id: "conclusion-feature-customer-table", html: featureCustomerRecommendationsHtml(recommendations) }),
  ];
}
