import type { QuantStats } from "@/lib/quant/compute";
import { splitCrossAnalysisText } from "@/lib/pipeline/sectionAnalysis";
import { richTextToHtml } from "@/lib/report/richText";
import {
  groupedBarBlock,
  headingBlock,
  radarBlock,
  richStaticBlock,
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

  // 원본 41~42쪽의 구간 제목("연령대별 차이"/"연령에 따른 차이")은 본문 폭 전체를 채우는 라벤더
  // 배너다. heading 블록에는 이 변형이 없어 정적 HTML로 그린다(편집 대상이 아닌 구조 라벨).
  const sectionBanner = (id: string, title: string) =>
    richStaticBlock({
      id,
      html: `<p style="margin:14pt 0 10pt;padding:6pt;text-align:center;font-weight:700;background-color:#dce6f7;border-top:2pt solid #4a5f9e;border-bottom:0.75pt solid #8ea7de">${title}</p>`,
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
    ? [textBlock({ id: "cross-gender-analysis", label: "연령에 따른 차이 분석", html: richTextToHtml(genderAnalysis), styled: true })]
    : [];

  // 원본 41~42쪽 구성: 절 제목은 "교차 분석 결과 및 분석"(예전엔 Ⅵ장 제목이 잘못 복사돼 있었다),
  // 그 아래 구간 배너 2개("연령대별 차이"/"연령에 따른 차이" — 두 번째는 원본 표기 그대로다.
  // 실제 내용은 성별 비교이며 원본 제목이 잘못된 것으로 보이지만 사용자 요청으로 원본을 따른다).
  // 원본에 없는 교차 요약 표 4종은 제거했다(2026-08-18) — 같은 값이 이미 차트에 라벨로 있다.
  return [
    headingBlock({ id: "cross-result-heading", variant: "numbered", number: "1", text: "교차 분석 결과 및 분석" }),
    sectionBanner("cross-age-banner", "연령대별 차이"),
    featureChart(ca.byAgeGroup, "기능별 만족도 차이", "age"),
    valuesChart(ca.byAgeGroup, "4대 가치 만족도 차이", "age"),
    ...ageAnalysisBlock,
    sectionBanner("cross-gender-banner", "연령에 따른 차이"),
    featureChart(ca.byGender, "기능별 만족도 차이", "gender"),
    valuesChart(ca.byGender, "4대 가치 만족도 차이", "gender"),
    headingBlock({ id: "cross-gender-ux-heading", variant: "subheading", text: "[사용자 경험 품질 평가]" }),
    genderRadar("usability", "실용성", "usability"),
    genderRadar("fun", "즐거움", "fun"),
    ...genderAnalysisBlock,
  ];
}
