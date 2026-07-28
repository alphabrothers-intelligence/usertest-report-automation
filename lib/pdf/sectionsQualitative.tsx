// Ⅲ, Ⅴ(정성 보강), Ⅷ, Ⅸ 섹션 — 3종세트(그래프+표+서술) 조립 (PRD 8장).
// insight는 체크포인트 B에서 승인된 버전(insight_final)만 쓴다 — 승인 전 카테고리는애초에
// getQuestionsWithApprovedCategories가 걸러서 넘겨주므로 여기서는 존재하는 것만 그리면 된다.
import path from "node:path";
import { View, Text, Image, Svg, Polygon } from "@react-pdf/renderer";
import { styles, colors } from "./theme";
import {
  VerticalBarChartWithAverage,
  PolarityStackedBar,
  CanvasQuadrantChart,
  TransposedRankTable,
  computeBarWithAverageRange,
} from "./charts";
import type { NpsResult } from "@/lib/quant/basic";
import type { QuantStats } from "@/lib/quant/compute";
import type { CategoryRow, QuestionWithApprovedCategories, RecommendationRow } from "@/lib/db/reports";
import { SectionHeader, SubsectionHeader } from "./sectionsQuant";

const NPS_SCALE_PATH = path.join(process.cwd(), "public", "images", "nps-scale.png");


export function polarityPct(categories: CategoryRow[]) {
  const total = categories.reduce((a, c) => a + c.clause_count, 0);
  const sum = (p: string) =>
    categories.filter((c) => c.polarity === p).reduce((a, c) => a + c.clause_count, 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    positivePct: total === 0 ? 0 : round1((sum("positive") / total) * 100),
    negativePct: total === 0 ? 0 : round1((sum("negative") / total) * 100),
    neutralPct: total === 0 ? 0 : round1((sum("neutral") / total) * 100),
  };
}

function CategoryBlock({ category }: { category: CategoryRow }) {
  return (
    <View style={styles.categoryBlock} wrap={false}>
      <Text style={styles.categoryLabel}>
        [{category.label}] ({category.clause_count}건)
      </Text>
      {category.quotes.slice(0, 3).map((q) => (
        <Text key={q} style={styles.quote}>
          &ldquo;{q}&rdquo;
        </Text>
      ))}
      <Text style={styles.insight}>→ {category.insight_final ?? category.insight_draft}</Text>
    </View>
  );
}

const POLARITY_BANNER_STYLE = {
  // navyLight가 선명한 파랑(#004FFF)이라 흰 글자를 쓴다(theme.ts 주석 참고).
  positive: { bg: colors.navyLight, text: colors.white },
  negative: { bg: "#fde4d0", text: "#c2410c" },
  neutral: { bg: colors.bgAlt, text: colors.subtext },
} as const;

/** 실제 발행 보고서의 "1. 긍정 의견 (28.7%)" 굵은 배너 헤더 형식(2026-07-20 반영) —
 * 기존엔 회색 소문자 라벨 하나뿐이라 긍/부/중 구획이 잘 안 보였다는 피드백. */
function PolarityBanner({
  index,
  polarity,
  label,
  pct,
}: {
  index: number;
  polarity: "positive" | "negative" | "neutral";
  label: string;
  pct: number;
}) {
  const s = POLARITY_BANNER_STYLE[polarity];
  return (
    <View style={{ backgroundColor: s.bg, paddingVertical: 4, paddingHorizontal: 6, marginBottom: 4 }}>
      <Text style={{ fontSize: 9, fontWeight: "bold", color: s.text }}>
        {index}. {label} 의견 ({pct}%)
      </Text>
    </View>
  );
}

function QuestionQualitativeBlock({ question }: { question: QuestionWithApprovedCategories }) {
  if (question.categories.length === 0) return null;
  const polarityOrder = ["positive", "negative", "neutral"] as const;
  const polarityLabel = { positive: "긍정", negative: "부정", neutral: "중립" };
  const pct = polarityPct(question.categories);
  const pctByPolarity = { positive: pct.positivePct, negative: pct.negativePct, neutral: pct.neutralPct };
  let bannerIndex = 0;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.subheading}>{question.label}</Text>
      {question.kind === "standard" && <PolarityStackedBar {...pct} />}
      {polarityOrder.map((p) => {
        const inPolarity = question.categories.filter((c) => c.polarity === p);
        if (inPolarity.length === 0) return null;
        bannerIndex += 1;
        return (
          <View key={p} style={{ marginTop: 6 }}>
            <PolarityBanner index={bannerIndex} polarity={p} label={polarityLabel[p]} pct={pctByPolarity[p]} />
            {question.polarity_summaries?.[p] && (
              <Text style={[styles.body, { marginBottom: 4 }]}>{question.polarity_summaries[p]}</Text>
            )}
            {inPolarity.map((c) => (
              <CategoryBlock key={c.id} category={c} />
            ))}
          </View>
        );
      })}
      {question.kind === "improvement" &&
        question.categories.map((c) => <CategoryBlock key={c.id} category={c} />)}
    </View>
  );
}

/** Ⅲ. 기능별 고객경험평가 — 정량(만족도 세로 막대그래프 + 순위표) + 정성(3종세트). 실제 발행
 * 보고서 형식(전체 평균선 오버레이 + 만족도 순위 종합표, 2026-07-21 실측 대조)에 맞춰
 * 기존 가로 BarChart를 VerticalBarChartWithAverage로 교체했다. */
export function SectionFeatureExperience({
  stats,
  featureQuestions,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
}) {
  const ranked = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean);
  const overallAverage =
    Math.round((ranked.reduce((sum, f) => sum + f.mean, 0) / ranked.length) * 100) / 100;
  const featureValues = ranked.map((f) => f.mean);
  const [chartMin, chartMax] = computeBarWithAverageRange(featureValues, overallAverage);
  return (
    /* Ⅱ장의 Q3~Q5는 이미 새 페이지에서 끝난다. 여기에서 다시 break를 걸면 react-pdf가
       빈 물리 페이지를 하나 만든 뒤 Ⅲ장을 시작하는 경우가 있어, 원본처럼 바로 다음
       페이지에서 Ⅲ장을 시작하도록 추가 강제 개행을 제거한다. */
    <View>
      <SectionHeader numeral="III" title="기능별 고객 경험 평가" />
      <Text style={styles.subheading}>기능별 만족도</Text>
      <VerticalBarChartWithAverage
        items={ranked.map((f) => ({ label: f.name, value: f.mean }))}
        min={chartMin}
        max={chartMax}
        unit="점"
        title="[ 기능별 만족도 조사 결과 ]"
        average={overallAverage}
        yAxisTitle="만족도 평균"
        legendBarLabel="기능별 만족도 평균"
        legendAverageLabel="전체 기능 만족도 평균"
      />
      <View style={{ marginTop: 6 }}>
        <TransposedRankTable
          title="기능별 만족도 순위 종합"
          rowLabel="기능"
          valueLabel="평균 만족도"
          items={ranked.map((f) => ({ name: f.name, value: f.mean }))}
        />
      </View>
      {featureQuestions.map((q) => (
        <QuestionQualitativeBlock key={q.id} question={q} />
      ))}
    </View>
  );
}

/** Ⅴ 정성 보강 — 4대가치 문항별 카테고리(quant 표는 sectionsQuant.tsx의 SectionFourValuesTable). */
export function SectionFourValuesQualitative({
  valueQuestions,
}: {
  valueQuestions: QuestionWithApprovedCategories[];
}) {
  if (valueQuestions.every((q) => q.categories.length === 0)) return null;
  return (
    <View>
      {valueQuestions.map((q) => (
        <QuestionQualitativeBlock key={q.id} question={q} />
      ))}
    </View>
  );
}

/**
 * NPS 판단 문구 — 실제 발행 보고서(data/…리바랩스…pdf 43페이지, 2026-07-21 직접 대조)는
 * "알파브라더스 기존 데이터 대비" 같은 특정 회사 비교 문구를 쓰지만, 그건 그 회사 내부
 * 기준값이라 다른 프로젝트 raw data에 그대로 쓰면 틀린 비교가 된다(surveyQuestions.ts가
 * 실제 보고서의 설문 항목 표를 그대로 베끼지 않은 것과 같은 이유). 대신 그 문구의 판단
 * 로직(NPS 부호로 시장성 판단, 중립 고객 비율로 구매전환 요소 진단)만 재사용해 우리가 계산한
 * 값으로 채운다.
 *
 * 각 줄을 일반 문자열이 아니라 세그먼트 배열로 반환한다 — 원본 43페이지를 직접 픽셀로
 * 대조해보니 판단 문구 안에서 핵심 어구만 선택적으로 볼드·밑줄 처리돼 있었다(예: "'낮은
 * 시장성'"은 밑줄만, "사용자들의 구매 전환을 일으키는 요소가 적은 것"은 볼드+밑줄) —
 * 문장 전체를 한 스타일로 칠하면 이 강조가 사라진다.
 */
export interface JudgmentSegment {
  text: string;
  bold?: boolean;
  underline?: boolean;
}

export function npsJudgmentLines(nps: NpsResult): JudgmentSegment[][] {
  const marketability = nps.npsScore >= 0 ? "양호한 시장성" : "낮은 시장성";
  const urgency =
    nps.npsScore >= 0
      ? "우호적인 흐름을 유지해나갈 필요가 있음"
      : "개선 전략의 수립이 시급하다고 사료됨";
  const lines: JudgmentSegment[][] = [
    [
      { text: `구매의향, 추천의향을 NPS 지수로 환산했을 때, ${nps.npsScore}점으로 ` },
      { text: `'${marketability}'`, underline: true },
      { text: ` 수준으로 판단되어 ${urgency}` },
    ],
  ];
  if (nps.passivePct >= 25) {
    lines.push([
      { text: `구매 고객 대비 중립 고객(${nps.passivePct}%) 비율이 높은 편으로, 이는 ` },
      { text: "사용자들의 구매 전환을 일으키는 요소가 적은 것으로 판단됨", bold: true, underline: true },
    ]);
  }
  lines.push([
    {
      text: "전체 기능에 대한 고도화 및 사용자에게 도출된 불편 사항, 개선 사항을 반영하여 사용자의 만족도를 높이는 방안이 필요함",
    },
  ]);
  return lines;
}

/** 실제 발행 보고서 형식(2026-07-21 재대조): 헤더 셀은 연한 파란 배경, "NPS 지수"와
 * "구매 고객" 사이에는 앞의 두 칸(입력값)과 뒤의 세 칸(비율 breakdown)을 구분하는 굵은
 * 세로선이 있다. */
function NpsSummaryTable({ nps }: { nps: NpsResult }) {
  const cells = [
    { label: "평균 구매 의향", value: String(nps.rawMean) },
    { label: "NPS 지수", value: String(nps.npsScore) },
    { label: "구매 고객\n(PROMOTERS)", value: `${nps.promoterPct} %` },
    { label: "중립 고객\n(PASSIVES)", value: `${nps.passivePct} %` },
    { label: "비구매 고객\n(DETRACTORS)", value: `${nps.detractorPct} %` },
  ];
  // **헤더 행 + 값 행 2행 구조**(2026-07-22 재수정): 예전엔 각 열을 독립 View로 만들어
  // 헤더 텍스트가 1줄(평균 구매 의향·NPS 지수)이냐 2줄(구매 고객(PROMOTERS) 등)이냐에 따라
  // 헤더 높이가 달라 값 셀 위치가 어긋났다("평균 구매 의향·NPS 지수 칸 크기를 오른쪽 컬럼과
  // 맞춰달라"). 헤더를 한 flex row, 값을 다른 flex row로 두면 같은 행의 셀들이 표준 flexbox
  // 규칙으로 가장 높은 셀(2줄 헤더) 기준으로 키가 맞춰져 전부 정렬된다. 1줄 헤더는
  // justifyContent:center로 그 높이 안에서 세로 중앙에 온다.
  const rightBorder = (i: number) => ({
    borderRightWidth: i === 1 ? 2.5 : i < cells.length - 1 ? 1 : 0,
    borderRightColor: i === 1 ? colors.navy : colors.border,
  });
  return (
    <View style={[styles.table, { marginTop: 8 }]}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {cells.map((cell, i) => (
          <View
            key={cell.label}
            style={{ flex: 1, backgroundColor: "#dbeafe", justifyContent: "center", padding: 5, ...rightBorder(i) }}
          >
            <Text style={{ fontSize: 7, fontWeight: "bold", textAlign: "center" }}>{cell.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        {cells.map((cell, i) => (
          <View key={cell.label} style={{ flex: 1, justifyContent: "center", padding: 6, ...rightBorder(i) }}>
            <Text style={{ fontSize: 9, fontWeight: "bold", textAlign: "center" }}>{cell.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** "▶" 유니코드 삼각형은 이 프로젝트의 서브셋 폰트에 글자가 없어 mojibake가 난다(2026-07-21
 * 실측 확인, CLAUDE.md 참고) — 텍스트 대신 작은 SVG 삼각형(Polygon)으로 같은 모양을 낸다. */
function TriangleBullet() {
  return (
    <Svg width={6} height={7} style={{ marginRight: 4, marginTop: 2 }}>
      <Polygon points="0,0 6,3.5 0,7" fill={colors.text} />
    </Svg>
  );
}

/** Ⅷ. NPS 종합만족도 및 개선아이디어 — 실제 발행 보고서의 Bain & Company NPS 척도 설명
 * 그래픽·정의·공식·판단문 형식을 그대로 따른다(2026-07-21 실측 대조). Bain 설명·Promoter/
 * Passive/Detractor 정의·NPS 공식은 일반 지식이라 고정 템플릿 문구로 넣고, 특정 회사 비교
 * 문구가 섞인 판단 부분만 npsJudgmentLines()로 우리 계산값 기반으로 재구성했다. */
export function SectionNpsAndImprovement({
  stats,
  overallQuestion,
  npsQuestion,
  improvementQuestion,
}: {
  stats: QuantStats;
  overallQuestion?: QuestionWithApprovedCategories;
  npsQuestion?: QuestionWithApprovedCategories;
  improvementQuestion?: QuestionWithApprovedCategories;
}) {
  return (
    <View break>
      <SectionHeader numeral="VIII" title="종합 만족도 및 NPS 지수" />

      <Text style={styles.subheading}>종합 만족도 및 NPS 지수</Text>
      <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4, marginBottom: 8 }}>
        <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center", color: colors.navy }}>
          NPS 지수 (Net Promoter Score : 순수 고객추천/구매 지수)
        </Text>
      </View>
      {/* 사용자가 직접 제공한 원본 이미지를 그대로 쓴다(코드로 새로 그리지 않는다) —
          data/NPS 지수 산출_이미지.png를 public/images/nps-scale.png로 복사해서 쓴다
          (data/는 gitignore돼 배포에서 빠지므로, fonts.ts·로고와 같은 이유). 기존 320pt는
          페이지 폭(약 515pt)에 비해 작아 보인다는 지적(2026-07-21) — 원본 43페이지를 직접
          픽셀로 재보니 이 게이지 이미지가 본문 폭의 90% 가까이 차지해서, 460pt로 키웠다. */}
      <View style={{ alignItems: "center" }}>
        <Image src={NPS_SCALE_PATH} style={{ width: 460 }} />
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={styles.body}>
          • 글로벌 자문업체인 Bain &amp; Company가 실제 고객 충성도를 측정하기 위해 제시한 순수
          고객추천/구매 지수 조사
        </Text>
        <Text style={styles.body}>
          • 제품별 구매/추천 의향 조사를 통하여 고객 유지율 및 신뢰도 분석을 진행하며, 사용성
          테스트를 통해 NPS의 유형별 비율 산정
        </Text>
        <Text style={styles.body}>
          • 창업 초기기업의 경우, 통상적으로 NPS 지수가 0보다 크면 충성 고객을 확보해 시장성이
          있는 제품으로 판단
        </Text>
      </View>
      <View style={{ marginTop: 6 }}>
        <Text style={[styles.body, { fontWeight: "bold" }]}>- 구매/추천고객 (PROMOTER, 9~10점)</Text>
        <Text style={styles.body}>자발적으로 구매/추천할 만큼 만족도가 높은 잠재 고객</Text>
        <Text style={[styles.body, { fontWeight: "bold", marginTop: 4 }]}>- 중립 고객 (PASSIVE, 7~8점)</Text>
        <Text style={styles.body}>제품에 대한 보증까지는 응하지 않을 가능성이 큰 고객</Text>
        <Text style={[styles.body, { fontWeight: "bold", marginTop: 4 }]}>
          - 비구매/비추천 고객 (DETRACTOR, 0~6점)
        </Text>
        <Text style={styles.body}>실제 비구매 및 다른 이에게도 쓰지 않도록 적극적으로 의견을 표출할 수 있는 고객</Text>
      </View>

      <NpsSummaryTable nps={stats.nps} />

      {/* 판단 문구는 표 위가 아니라 표 아래에 온다(원본 43페이지 순서 그대로,
          2026-07-21 재대조로 순서를 바로잡았다 — 기존엔 표 앞에 있었다). */}
      <View style={{ marginTop: 8 }}>
        {npsJudgmentLines(stats.nps).map((segments, i) => (
          <View key={i} style={{ flexDirection: "row", marginTop: 3 }} wrap={false}>
            <TriangleBullet />
            <Text style={[styles.body, { flex: 1 }]}>
              {segments.map((seg, si) => (
                <Text
                  key={si}
                  style={{
                    fontWeight: seg.bold ? "bold" : undefined,
                    textDecoration: seg.underline ? "underline" : undefined,
                  }}
                >
                  {seg.text}
                </Text>
              ))}
            </Text>
          </View>
        ))}
      </View>

      {overallQuestion && <QuestionQualitativeBlock question={overallQuestion} />}
      {npsQuestion && <QuestionQualitativeBlock question={npsQuestion} />}
      <Text style={styles.subheading}>개선 아이디어</Text>
      {improvementQuestion ? (
        <QuestionQualitativeBlock question={improvementQuestion} />
      ) : (
        <Text style={styles.placeholder}>정성 분석 결과가 아직 없습니다.</Text>
      )}
    </View>
  );
}

/**
 * "기능별 고객 경험 평가" 요약표(사분면 그래프 + 6열 표) — 실제 발행 보고서의 Ⅸ장
 * "1. 사용성테스트 결과 요약" 형식(2026-07-21 실측 대조). 긍정/중립/부정 비율은 **새 LLM
 * 호출 없이** 이미 저장된 Stage2 카테고리(clause_count×polarity)를 문항당 합산해서 구한다 —
 * Ⅲ장의 `QuestionQualitativeBlock`이 쓰는 `polarityPct()`를 그대로 재사용한다(질문:
 * "정성 분석 결과가 성공했다면 바로 할 수 있는 것 아니냐"에 대한 답 — 맞다, 이 표는 그런
 * 경우다). 정성 분석이 아직 없는 문항은 0%로 표시된다.
 */
function FeatureExperienceSummaryTable({
  stats,
  featureQuestions,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
}) {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const satisfactionByName = new Map(stats.featureSatisfaction.map((f) => [f.name, f.mean]));
  const questionByName = new Map(featureQuestions.map((q) => [q.question_key.replace(/^feature:/, ""), q]));

  const rows = ranked.map((r) => {
    const q = questionByName.get(r.name);
    const pct = q ? polarityPct(q.categories) : { positivePct: 0, negativePct: 0, neutralPct: 0 };
    return {
      name: r.name,
      satisfaction: satisfactionByName.get(r.name) ?? 0,
      importance: r.score,
      ...pct,
    };
  });
  if (rows.length === 0) return null;

  const maxOf = (key: keyof (typeof rows)[number]) => Math.max(...rows.map((r) => r[key] as number));
  const minOf = (key: keyof (typeof rows)[number]) => Math.min(...rows.map((r) => r[key] as number));
  const maxSatisfaction = maxOf("satisfaction");
  const maxImportance = maxOf("importance");
  const minImportance = minOf("importance");
  // 정성 분석이 아직 없으면 긍정/중립/부정이 전 문항 0%로 동률이라, "최댓값 강조"가 모든
  // 행을 다 칠해버리는 무의미한 결과가 된다(실측 확인, 2026-07-21) — 값이 실제로 0보다 큰
  // 경우에만(=정성 분석 결과가 있을 때만) 강조한다.
  const maxPositive = maxOf("positivePct");
  const maxNeutral = maxOf("neutralPct");
  const maxNegative = maxOf("negativePct");
  const highlightPositive = maxPositive > 0;
  const highlightNeutral = maxNeutral > 0;
  const highlightNegative = maxNegative > 0;

  const headers = ["기능명", "평균 만족도\n(점)", "상대 중요도", "긍정 비율\n(%)", "중립 비율\n(%)", "부정 의견\n(%)"];
  const cellStyle = (highlight?: string) => [
    styles.tableCell,
    { textAlign: "center" as const },
    highlight ? { backgroundColor: highlight } : {},
  ];

  return (
    // Ⅳ장에 이미 우선순위 범례·미니 다이어그램·판정 문구가 다 있어서, 여기(Ⅸ장 "주요 의견"
    // 칸 안)에는 그래프와 표만 넣는다(2026-07-22, "저 사용성테스트 결과 요약 표에서 주요
    // 의견 안에 들어갈 수 있도록" 요청 — 참고 자료까지 다 넣으면 좁은 칸 안에서 너무
    // 빽빽해진다).
    <View>
      <View style={{ alignItems: "center" }} wrap={false}>
        {/* 2026-07-23: Ⅳ장과 동일하게 캔버스 기반(CanvasQuadrantChart)으로 전환 — SVG 기반
            ImportanceSatisfactionChart는 estimateTextWidth()로 라벨 폭을 추측해서 긴 기능명이
            셀 밖으로 빠지는 문제가 반복됐다. ctx.measureText()로 실제 폭을 재는 캔버스 버전은
            어떤 raw data의 기능명이 오든 구조적으로 셀을 벗어나지 않는다(lib/charts/canvasCharts.ts
            참고). */}
        {/* 원본 50페이지 사분면도 셀이 정사각형이라 플롯 영역을 정사각형으로 맞춘다(w=h+4).
            **이 사분면은 Ⅸ장 "항목|주요 의견" 표의 오른쪽 칸 안에 들어간다** — 칸 폭이
            페이지 폭(515)에서 항목 열(92)+칸 여백을 뺀 약 405pt라, 430으로 두면 칸을 넘쳤다
            (2026-07-23 지적). 칸 안에 확실히 들어가도록 390×386(플롯 336×336 정사각형)으로
            줄였다. */}
        <CanvasQuadrantChart
          items={ranked.map((r) => ({
            name: r.name,
            importance: r.score,
            satisfaction: satisfactionByName.get(r.name) ?? 0,
          }))}
          width={390}
          height={386}
        />
      </View>
      <View style={[styles.table, { marginTop: 6 }]}>
        <View style={styles.tableRow}>
          {headers.map((h) => (
            <Text key={h} style={[styles.tableHeaderCell, { textAlign: "center" }]}>
              {h}
            </Text>
          ))}
        </View>
        {rows.map((r, i) => (
          <View key={r.name} style={i === rows.length - 1 ? styles.tableRowLast : styles.tableRow}>
            <Text style={styles.tableCell}>{r.name}</Text>
            <Text style={cellStyle(r.satisfaction === maxSatisfaction ? "#dbeafe" : undefined)}>{r.satisfaction}</Text>
            <Text
              style={cellStyle(
                r.importance === maxImportance ? "#dbeafe" : r.importance === minImportance ? "#fde4d0" : undefined,
              )}
            >
              {r.importance}
            </Text>
            <Text style={cellStyle(highlightPositive && r.positivePct === maxPositive ? "#dbeafe" : undefined)}>
              {r.positivePct}
            </Text>
            <Text style={cellStyle(highlightNeutral && r.neutralPct === maxNeutral ? "#d4d4d8" : undefined)}>
              {r.neutralPct}
            </Text>
            <Text style={cellStyle(highlightNegative && r.negativePct === maxNegative ? "#fde4d0" : undefined)}>
              {r.negativePct}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 원본 50~52페이지의 "1. 사용성테스트 결과 요약" 표 — 항목(왼쪽 좁은 열, 연한 파랑) |
 * 주요 의견(오른쪽 넓은 열) 2열 구조. "기능별 고객 경험 평가" 항목만 자동으로 사분면 그래프+
 * 6열 표를 채우고, 나머지 항목(핵심구매요소·4대 가치 만족도·사용자 경험 품질 평가·교차 분석·
 * 종합 만족도 및 NPS 지수)은 담당자가 나중에 요약을 직접 채워 넣도록 빈 칸으로 둔다(2026-07-23
 * "원본 표 양식을 가져오고 싶다, 나중에 채울 것들" 요청). */
const RESULT_SUMMARY_ITEMS = [
  "핵심구매요소",
  "4대 가치 만족도",
  "사용자 경험 품질 평가",
  "교차 분석",
  "종합 만족도 및 NPS 지수",
];

function ResultItemLabel({ label }: { label: string }) {
  return (
    <View
      style={{
        width: 92,
        backgroundColor: "#dfe6f7",
        justifyContent: "center",
        alignItems: "center",
        padding: 5,
        borderRightWidth: 1,
        borderRightColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 8.5, fontWeight: "bold", textAlign: "center", lineHeight: 1.3 }}>{label}</Text>
    </View>
  );
}

function ResultSummaryTable({
  stats,
  featureQuestions,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
}) {
  return (
    <View style={styles.table}>
      {/* 헤더 행 */}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ width: 92, backgroundColor: colors.chartBannerBg, fontSize: 8.5, fontWeight: "bold", textAlign: "center", padding: 5, borderRightWidth: 1, borderRightColor: colors.border, color: colors.navy }}>
          항목
        </Text>
        <Text style={{ flex: 1, backgroundColor: colors.chartBannerBg, fontSize: 8.5, fontWeight: "bold", textAlign: "center", padding: 5, color: colors.navy }}>
          주요 의견
        </Text>
      </View>
      {/* 기능별 고객 경험 평가 — 사분면 그래프 + 6열 표 자동 채움 */}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }} wrap={false}>
        <ResultItemLabel label="기능별 고객 경험 평가" />
        <View style={{ flex: 1, padding: 6 }}>
          <FeatureExperienceSummaryTable stats={stats} featureQuestions={featureQuestions} />
        </View>
      </View>
      {/* 나머지 항목 — 담당자가 나중에 채울 빈 칸. **wrap={false}를 걸지 않는다**: 사분면이
          든 "기능별 고객 경험 평가" 행이 커서 그 다음 이 빈 행들이 페이지 하단 남은 공간에
          통째로는 안 들어가면, wrap={false}일 때 통째로 다음 페이지로 밀려 앞 페이지 하단에
          테두리만 있는 빈칸이 남았다(2026-07-23 지적). 이 칸들은 나중에 채울 빈 공간이라
          페이지 경계에서 쪼개져도 무해하므로, 흐르게 둬서 페이지를 꽉 채운다(CLAUDE.md
          페이지 넘김 원칙). */}
      {RESULT_SUMMARY_ITEMS.map((item, i) => (
        <View
          key={item}
          style={
            i < RESULT_SUMMARY_ITEMS.length - 1
              ? { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }
              : { flexDirection: "row" }
          }
        >
          <ResultItemLabel label={item} />
          <View style={{ flex: 1, minHeight: 80, padding: 6 }}>
            <Text style={{ fontSize: 8.5, color: colors.subtext }}>입력 필요</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Ⅸ. 종합결과 및 제언 */
export function SectionConclusion({
  stats,
  featureQuestions,
  devPriorityRecommendation,
  featureRecommendations,
  strategicInput,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
  // resultSummary는 더 이상 Ⅸ장 결과 요약을 텍스트로 렌더하지 않는다(원본처럼 항목|주요 의견
  // 표 양식으로 바뀌고, 요약 칸은 담당자가 나중에 채운다, 2026-07-23). ReportDocument가
  // 여전히 넘겨주므로 타입에는 남겨 둔다.
  resultSummary?: string;
  devPriorityRecommendation: string | null;
  featureRecommendations: RecommendationRow[];
  strategicInput: { customerRequest: string | null; priorityMetric: string | null; draft: string | null } | null;
}) {
  return (
    <View break>
      <SectionHeader numeral="IX" title="종합 결과 및 제언" />
      <SubsectionHeader number={1} title="사용성테스트 결과 요약" />
      <ResultSummaryTable stats={stats} featureQuestions={featureQuestions} />

      <Text style={styles.subheading}>2. 개발 우선순위 제언</Text>
      <Text style={styles.body}>
        {devPriorityRecommendation ?? "제언이 아직 생성·승인되지 않았습니다."}
      </Text>

      <Text style={styles.subheading}>3. 기능별 고객 제언 종합</Text>
      {featureRecommendations.length === 0 ? (
        <Text style={styles.placeholder}>승인된 기능개선제안이 아직 없습니다.</Text>
      ) : (
        featureRecommendations.map((r) => (
          <View key={r.id} style={{ marginBottom: 6 }} wrap={false}>
            <Text style={{ fontSize: 8.5, fontWeight: "bold", marginBottom: 2 }}>
              {r.section.replace("feature_improvement:", "")}
            </Text>
            <Text style={styles.body}>{r.final ?? r.draft}</Text>
          </View>
        ))
      )}

      <Text style={styles.subheading}>4. 종합 전략 제언</Text>
      {strategicInput?.draft ? (
        <Text style={styles.body}>{strategicInput.draft}</Text>
      ) : (
        <View>
          <Text style={styles.placeholder}>담당자 입력 대기 중 (7.3절 — AI가 임의로 작성하지 않음)</Text>
          {strategicInput?.customerRequest && (
            <Text style={styles.small}>고객사 요청사항: {strategicInput.customerRequest}</Text>
          )}
          {strategicInput?.priorityMetric && (
            <Text style={styles.small}>우선 고려 지표: {strategicInput.priorityMetric}</Text>
          )}
        </View>
      )}
    </View>
  );
}
