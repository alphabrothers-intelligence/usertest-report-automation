import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";
import { meanChart, workspaceSlug } from "@/lib/report/workspaceCharts";
import {
  headingBlock,
  priorityReferenceBlock,
  quadrantBlock,
  rankCompositionBlock,
  richStaticBlock,
  tableBlock,
  type ReportBlock,
} from "@/lib/report/sections";

export type FeatureExperienceServices = {
  featureQualitativeBlocks: (stats: QuantStats, idPrefix: string, questions: QuestionWithApprovedCategories[]) => ReportBlock[];
  questionsByKeyPrefix: (questions: QuestionWithApprovedCategories[], prefix: string) => QuestionWithApprovedCategories[];
  questionText: (stats: QuantStats, questionNumber: number, fallback: string) => string;
  sectionAnalysisPanelHtml: (analysis: string) => string;
  analysisEvidenceHtml: (title: string, content: string) => string;
  originalAnalysisPanelHtml: (title: string, content: string, actionHtml?: string) => string;
  sectionAiRegenerateButtonHtml: () => string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function classifyPriority(importance: number, satisfaction: number): { score: number; label: string } {
  const columnScore = importance < -2 ? 0 : importance < 2 ? 1 : 2;
  const rowScore = satisfaction >= 8 ? 0 : satisfaction >= 6 ? 1 : 2;
  const score = columnScore + rowScore - 2;
  const label = score >= 2 ? "최상" : score === 1 ? "상" : score === 0 ? "중" : score === -1 ? "하" : "최하";
  return { score, label };
}

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

function buildFeatureAnalysisText(
  stats: QuantStats,
  rankedImportance: { name: string; score: number }[],
  featureQualitative: QuestionWithApprovedCategories[],
): string {
  const total = stats.featureSatisfaction.length;
  const satisfactionRank = new Map(
    [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean).map((feature, index) => [feature.name, index + 1]),
  );
  const importanceRank = new Map(rankedImportance.map((feature, index) => [feature.name, index + 1]));
  const items = rankedImportance.map((importance) => {
    const feature = stats.featureSatisfaction.find((item) => item.name === importance.name);
    const satisfaction = feature?.mean ?? 0;
    const { score, label } = classifyPriority(importance.score, satisfaction);
    const negatives = featureQualitative
      .find((question) => question.label.includes(importance.name))
      ?.categories.filter((category) => category.polarity === "negative")
      .slice(0, 2)
      .map((category) => category.label) ?? [];
    return { name: importance.name, importance: importance.score, satisfaction, score, label, negatives };
  });

  const topSatisfaction = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean)[0];
  const topSatisfactionImportanceRank = importanceRank.get(topSatisfaction?.name ?? "") ?? 0;
  const worstBoth = items.find((item) => importanceRank.get(item.name) === total && satisfactionRank.get(item.name) === total);
  const summaryLines: string[] = [];
  if (topSatisfaction && topSatisfactionImportanceRank > Math.ceil(total / 2)) {
    summaryLines.push(`• '${topSatisfaction.name}'의 경우 만족도는 가장 높지만 중요도는 상대적으로 낮음.`);
  }
  if (worstBoth) summaryLines.push(`• '${worstBoth.name}'는 만족도·중요도 모두 낮은 특징을 보임.`);
  const urgent = items.filter((item) => item.score >= 1 && (satisfactionRank.get(item.name) ?? 0) > Math.ceil(total / 2));
  if (urgent.length > 0) {
    summaryLines.push(`• 상대 중요도-만족도 그래프를 통해, ${urgent.map((item) => `'${item.name}'`).join("·")} 기능은 중요도에 비해 만족도가 충분히 높지 않아 개선이 시급함`);
  }

  const groups: { title: string; items: typeof items }[] = [
    { title: "우선 개선 기능", items: items.filter((item) => item.score >= 1) },
    { title: "차우선 개발 기능", items: items.filter((item) => item.score === 0) },
    { title: "비우선 개발 기능", items: items.filter((item) => item.score <= -1) },
  ];
  // 패널 제목 배너가 이미 "… 종합 해석"이므로 본문에 라벨을 또 넣지 않는다(2026-08-18).
  const parts: string[] = [];
  for (const line of summaryLines) parts.push(`<p style="margin:0 0 3pt">${escapeHtml(line)}</p>`);
  for (const group of groups) {
    if (group.items.length === 0) continue;
    parts.push(`<p style="font-weight:700;margin:10pt 0 4pt">▶ ${escapeHtml(group.title)}</p>`);
    group.items.forEach((item, index) => {
      const importancePosition = importanceRank.get(item.name) ?? 0;
      const satisfactionPosition = satisfactionRank.get(item.name) ?? 0;
      parts.push(`<p style="margin:0 0 2pt">${index + 1}. '${escapeHtml(item.name)}' 기능의 경우 ${rankPhrase(importancePosition, total)} 상대 중요도(${item.importance >= 0 ? "+" : ""}${item.importance.toFixed(2)})와 ${satisfactionPhrase(satisfactionPosition, total)} 만족도(${item.satisfaction.toFixed(2)})를 가짐.</p>`);
      if (item.negatives.length > 0) parts.push(`<p style="margin:0 0 6pt">→ ${item.negatives.map(escapeHtml).join(", ")} 관련 니즈 확인</p>`);
    });
  }
  return parts.join("");
}

export function buildFeatureSection(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  analysis: string | undefined,
  services: FeatureExperienceServices,
): ReportBlock[] {
  const ranked = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean);
  const featureQualitative = services.questionsByKeyPrefix(qualitative, "feature:");
  const rankedImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const segmentNames = [...new Set(stats.rankPositionComposition.flatMap((row) => row.segments.map((segment) => segment.name)))];
  const rankPalette = ["#ff7b7b", "#58b1cf", "#9bcdb8", "#5fc5c1", "#c890d5", "#ffe39a", "#aeb8c8", "#f5ad80"];
  return [
    headingBlock({ id: "feature-result-heading", variant: "numbered", number: "1", text: "기능별 고객 경험 조사 결과" }),
    ...services.featureQualitativeBlocks(stats, "feature-qualitative", featureQualitative),
    headingBlock({ id: "feature-satisfaction-heading", variant: "subheading", text: "기능별 만족도" }),
    meanChart("feature-satisfaction", "기능별 만족도 조사 결과", ranked),
    tableBlock({
      id: "feature-rank-table",
      title: "기능별 만족도 순위 종합",
      headers: ["순위", "기능", "평균 만족도", "표준편차"],
      rows: ranked.map((feature, index) => [index + 1, feature.name, feature.mean, feature.sd]),
    }),
    headingBlock({ id: "feature-q12", variant: "question", number: "Q12", text: services.questionText(stats, 12, "기능 중 중요하다고 생각되는 순위를 순서대로 작성해주세요") }),
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
      rows: rankedImportance.map((item, index) => [`${index + 1}위`, item.name, item.score]),
    }),
    quadrantBlock({
      id: "feature-importance-satisfaction-quadrant",
      title: "기능별 상대 중요도-만족도 그래프",
      items: rankedImportance.map((item) => ({
        id: workspaceSlug(item.name),
        name: item.name,
        importance: item.score,
        satisfaction: stats.featureSatisfaction.find((feature) => feature.name === item.name)?.mean ?? 0,
      })),
    }),
    priorityReferenceBlock({ id: "feature-priority-reference", title: "영역별 참고 지표" }),
    headingBlock({ id: "feature-analysis-heading", variant: "numbered", number: "2", text: "기능별 고객 경험 분석" }),
    richStaticBlock({
      id: "feature-analysis-summary",
      html: analysis
        ? services.sectionAnalysisPanelHtml(analysis)
        : services.analysisEvidenceHtml("기능별 중요 순위 및 만족도 종합 해석", services.originalAnalysisPanelHtml(
          "기능별 중요 순위 및 만족도 종합 해석",
          buildFeatureAnalysisText(stats, rankedImportance, featureQualitative),
          services.sectionAiRegenerateButtonHtml(),
        )),
      summaryQuestionKey: "featureExperience",
      summaryKind: "section",
    }),
  ];
}
