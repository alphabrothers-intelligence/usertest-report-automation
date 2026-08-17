import type { QuantStats } from "@/lib/quant/compute";
import { splitCrossAnalysisText } from "@/lib/pipeline/sectionAnalysis";
import { richTextToHtml } from "@/lib/report/richText";
import {
  groupedBarBlock,
  headingBlock,
  radarBlock,
  tableBlock,
  textBlock,
  type ReportBlock,
} from "@/lib/report/sections";

/** 섹션 Ⅶ: 정량 교차 분석과 저장된 연령·성별 해석을 보고서 블록으로 구성한다. */
export function buildCrossAnalysisSection(stats: QuantStats, analysis?: string): ReportBlock[] {
  const { age: ageAnalysis, gender: genderAnalysis } = splitCrossAnalysisText(analysis);
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

  const ageAnalysisBlock: ReportBlock[] = ageAnalysis
    ? [textBlock({ id: "cross-age-analysis", label: "연령대별 차이 분석", html: richTextToHtml(ageAnalysis), styled: true })]
    : [];
  const genderAnalysisBlock: ReportBlock[] = genderAnalysis
    ? [textBlock({ id: "cross-gender-analysis", label: "성별에 따른 차이 분석", html: richTextToHtml(genderAnalysis), styled: true })]
    : [];

  return [
    headingBlock({ id: "cross-result-heading", variant: "numbered", number: "1", text: "사용자 경험 품질 평가 결과 분석" }),
    headingBlock({ id: "cross-age-heading", variant: "subheading", text: "연령에 따른 차이" }),
    featureChart(ca.byAgeGroup, "기능별 만족도 차이", "age"),
    valuesChart(ca.byAgeGroup, "4대 가치 만족도 차이", "age"),
    featureTable(ca.byAgeGroup, "연령대별 기능 만족도 차이", "age"),
    valuesTable(ca.byAgeGroup, "연령대별 4대 가치 만족도 차이", "age"),
    ...ageAnalysisBlock,
    headingBlock({ id: "cross-gender-heading", variant: "subheading", text: "성별에 따른 차이" }),
    featureChart(ca.byGender, "기능별 만족도 차이", "gender"),
    valuesChart(ca.byGender, "4대 가치 만족도 차이", "gender"),
    featureTable(ca.byGender, "성별 기능 만족도 차이", "gender"),
    valuesTable(ca.byGender, "성별 4대 가치 만족도 차이", "gender"),
    headingBlock({ id: "cross-gender-ux-heading", variant: "subheading", text: "사용자 경험 품질 평가" }),
    genderRadar("usability", "실용성", "usability"),
    genderRadar("fun", "즐거움", "fun"),
    ...genderAnalysisBlock,
  ];
}
