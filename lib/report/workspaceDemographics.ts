import type { QuantStats } from "@/lib/quant/compute";
import { genericOf } from "@/lib/report/genericStats";
import { distributionChart } from "@/lib/report/workspaceCharts";
import { chartBlock, headingBlock, stackedBarBlock, tableBlock, type ReportBlock } from "@/lib/report/sections";

/** 성별 문항을 고르는 신호. 성별은 교차표의 축이라 다른 선택형 문항과 다르게 다룬다. */
const GENDER_QUESTION = /성별|gender/i;

function questionText(stats: QuantStats, questionNumber: number, fallback: string): string {
  return stats.surveyQuestions[questionNumber - 1]?.question || fallback;
}

/**
 * 섹션 Ⅱ: 인적 사항.
 *
 * 예전에는 Q1~Q5가 **걷기 앱 문항으로 박혀 있었다**("하루 평균 걷는 시간", "일주일 산책 빈도",
 * "스마트폰 운영체제"). 다른 raw data에는 그 문항이 없어서 빈 그래프 세 개가 나왔다.
 * 지금은 **그 데이터에 실제로 있는 인적·습관 문항을 순서대로** 낸다(`generic.choices`) —
 * 리바랩스는 같은 문항이 같은 순서로 나오므로 결과가 예전과 같다.
 */
export function buildDemographicsSection(stats: QuantStats): ReportBlock[] {
  const demographics = stats.demographics;
  const choices = genericOf(stats).choices;
  const gender = choices.find((choice) => GENDER_QUESTION.test(choice.question));
  // 성별은 바로 아래 교차표의 축으로 따로 그리므로 반복 목록에서 뺀다. 유사 서비스 경험 유무는 맨 끝
  // 묶음(경험 유무 표 → 만족도)에서 그린다 — 여기서도 그리면 같은 문항이 두 번, 서로 떨어져 나왔다.
  const prior = demographics.priorServiceDetail;
  const rest = choices.filter((choice) => choice !== gender && !(prior && choice.role === "prior_service") && choice.distribution.length > 0);

  const ageBracketNames = demographics.genderByAgeBracket[0]?.segments.map((segment) => segment.name) ?? [];
  const ageColors = ["#ffe392", "#aacef0", "#facaa8", "#c9c9c9", "#a8d6b5", "#cbb4e3"];

  // 문항 번호는 실제로 그린 순서대로 매긴다 — 없는 문항 자리를 비워두면 번호가 어긋난다.
  let no = 0;
  const nextNumber = () => `Q${(no += 1)}`;

  const ageBlocks: ReportBlock[] = demographics.ageDistribution.length > 0
    ? [
      headingBlock({ id: "demo-q-age", variant: "question", number: nextNumber(), text: questionText(stats, 1, "나이를 입력해주세요") }),
      distributionChart("demo-age", "나이 분포", demographics.ageDistribution),
    ]
    : [];

  const genderBlocks: ReportBlock[] = gender
    ? [
      headingBlock({ id: "demo-q-gender", variant: "question", number: nextNumber(), text: questionText(stats, 2, gender.question) }),
      distributionChart("demo-gender", "성별 분포", gender.distribution),
    ]
    : [];

  // 성별×연령대 교차표는 두 문항이 다 있을 때만 성립한다.
  const crossBlocks: ReportBlock[] = demographics.genderByAgeBracket.length > 0
    ? [
      stackedBarBlock({
        id: "demo-gender-by-age",
        title: "성별별 연령대 구성",
        unit: "명",
        axisMax: Math.max(10, ...demographics.genderByAgeBracket.map((row) => row.segments.reduce((sum, segment) => sum + segment.count, 0))),
        categories: ageBracketNames.map((name, index) => ({ name, color: ageColors[index % ageColors.length] })),
        rows: demographics.genderByAgeBracket.map((row) => ({ label: row.label, segments: row.segments.map((segment) => ({ name: segment.name, value: segment.count })) })),
      }),
      tableBlock({
        id: "demo-cross",
        title: "성별 × 연령대 교차표",
        headers: ["성별", ...ageBracketNames],
        rows: demographics.genderByAgeBracket.map((row) => [row.label, ...row.segments.map((segment) => segment.count)]),
      }),
    ]
    : [];

  const restBlocks: ReportBlock[] = rest.flatMap((choice, index) => [
    headingBlock({ id: `demo-q-${index}`, variant: "question", number: nextNumber(), text: choice.question }),
    distributionChart(`demo-choice-${index}`, choice.question, choice.distribution),
  ]);

  // **유사 서비스 경험 조사는 한 묶음으로 잇는다**(케어클 원본 7~8쪽): 경험 유무 표 → 경험자 만족도 분포.
  // 뒤이어 workspace.ts가 "이유" 주관식(감정 분석)을 붙인다. 예전엔 요약 표 한 줄만 장 끝에 똑 떨어져
  // 나왔다(2026-10-06 담당자 지적). 원본의 "사용해 본 서비스" 막대·브랜드별 장단점 표는 자유 서술을
  // 브랜드로 묶어야 해서 아직 없다.
  const satisfaction = demographics.priorServiceSatisfaction;
  const priorServiceBlocks: ReportBlock[] = prior
    ? [
      headingBlock({ id: "demo-q-prior-gate", variant: "question", number: nextNumber(), text: prior.gateQuestion }),
      tableBlock({
        id: "demo-prior-service-gate",
        title: "유사 서비스 경험 조사",
        headers: ["구분", "있음", "없음"],
        rows: [["응답자 수", prior.experienced, prior.notExperienced]],
        labelColumn: true,
      }),
      ...(prior.satisfactionQuestion && satisfaction.n > 0
        ? [
          headingBlock({ id: "demo-q-prior-score", variant: "question", number: nextNumber(), text: prior.satisfactionQuestion }),
          // id는 그대로 — 검토 표시(reviewFlags "경험자만 보여준다")가 이 블록을 가리킨다.
          chartBlock({
            id: "demo-prior-service",
            title: `경험자 만족도 분포 (평균 ${satisfaction.mean.toFixed(2)} / 표준편차 ${satisfaction.sd.toFixed(2)}, ${satisfaction.n}명)`,
            unit: "명",
            axisMax: Math.max(5, Math.ceil(Math.max(...prior.scoreDistribution) / 5) * 5),
            items: prior.scoreDistribution.map((count, score) => ({ id: `s${score}`, label: `${score}점`, value: count })),
            hideAverage: true,
          }),
        ]
        : []),
    ]
    // 이 값이 생기기 전에 계산된 저장본 — 예전 요약 표를 그대로 둔다(정량을 다시 계산하면 위 묶음이 된다).
    : satisfaction.n > 0
      ? [tableBlock({
        id: "demo-prior-service",
        title: "유사 서비스 경험",
        headers: ["경험자 비율", "경험자 평균 만족도", "표준편차"],
        rows: [[`${demographics.priorServiceExperienceRate}%`, satisfaction.mean, satisfaction.sd]],
      })]
      : [];

  return [...ageBlocks, ...genderBlocks, ...crossBlocks, ...restBlocks, ...priorServiceBlocks];
}