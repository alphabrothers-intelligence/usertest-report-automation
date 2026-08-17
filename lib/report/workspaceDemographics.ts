import type { QuantStats } from "@/lib/quant/compute";
import { distributionChart } from "@/lib/report/workspaceCharts";
import { headingBlock, stackedBarBlock, tableBlock, type ReportBlock } from "@/lib/report/sections";

function questionText(stats: QuantStats, questionNumber: number, fallback: string): string {
  return stats.surveyQuestions[questionNumber - 1]?.question || fallback;
}

export function buildDemographicsSection(stats: QuantStats): ReportBlock[] {
  const demographics = stats.demographics;
  const ageBracketNames = demographics.genderByAgeBracket[0]?.segments.map((segment) => segment.name) ?? [];
  const ageColors = ["#ffe392", "#aacef0", "#facaa8", "#c9c9c9", "#a8d6b5", "#cbb4e3"];
  return [
    headingBlock({ id: "demo-q1", variant: "question", number: "Q1", text: questionText(stats, 1, "나이를 입력해주세요") }),
    distributionChart("demo-age", "나이 분포", demographics.ageDistribution),
    headingBlock({ id: "demo-q2", variant: "question", number: "Q2", text: questionText(stats, 2, "성별을 선택해주세요") }),
    distributionChart("demo-gender", "성별 분포", demographics.gender),
    stackedBarBlock({
      id: "demo-gender-by-age",
      title: "성별별 연령대 구성",
      unit: "명",
      axisMax: Math.max(10, ...demographics.genderByAgeBracket.map((row) => row.segments.reduce((sum, segment) => sum + segment.count, 0))),
      categories: ageBracketNames.map((name, index) => ({ name, color: ageColors[index % ageColors.length] })),
      rows: demographics.genderByAgeBracket.map((row) => ({ label: row.label, segments: row.segments.map((segment) => ({ name: segment.name, value: segment.count })) })),
    }),
    headingBlock({ id: "demo-q3", variant: "question", number: "Q3", text: questionText(stats, 3, "현재 사용하시는 스마트폰 운영체제를 선택해주세요") }),
    distributionChart("demo-os", "운영체제 분포", demographics.os),
    headingBlock({ id: "demo-q4", variant: "question", number: "Q4", text: questionText(stats, 4, "하루 평균 걷는 시간은 어느 정도인가요?") }),
    distributionChart("demo-walktime", "하루 평균 걷는 시간", demographics.avgWalkTime),
    headingBlock({ id: "demo-q5", variant: "question", number: "Q5", text: questionText(stats, 5, "일주일에 몇 일 정도 산책을 하시나요?") }),
    distributionChart("demo-walkfreq", "일주일 걷기 빈도", demographics.walkFrequencyPerWeek),
    tableBlock({
      id: "demo-cross",
      title: "성별 × 연령대 교차표",
      headers: ["성별", ...ageBracketNames],
      rows: demographics.genderByAgeBracket.map((row) => [row.label, ...row.segments.map((segment) => segment.count)]),
    }),
    tableBlock({
      id: "demo-prior-service",
      title: "유사 서비스 경험",
      headers: ["경험자 비율", "경험자 평균 만족도", "표준편차"],
      rows: [[`${demographics.priorServiceExperienceRate}%`, demographics.priorServiceSatisfaction.mean, demographics.priorServiceSatisfaction.sd]],
    }),
  ];
}
