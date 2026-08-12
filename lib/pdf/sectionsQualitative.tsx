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
  PdfPolarityDonut,
  PdfSatisfactionHistogram,
} from "./charts";
import type { NpsResult } from "@/lib/quant/basic";
import type { QuantStats, FeatureStat } from "@/lib/quant/compute";
import type { CategoryRow, QuestionWithApprovedCategories, RecommendationRow } from "@/lib/db/reports";
import { decodeImprovementLabel } from "@/lib/pipeline/stage2";
import { parseFourValueItemTexts } from "@/lib/pipeline/sectionAnalysis";
import { SectionHeader, SubsectionHeader } from "./sectionsQuant";
import { RichText, InlineRichText } from "./richText";

const NPS_SCALE_PATH = path.join(process.cwd(), "public", "images", "nps-scale.png");

/** resultSummary(summary.ts가 만든 "## 제목" 구획 텍스트)에서 항목 하나만 뽑아낸다.
 * lib/report/workspace.ts의 resultSummaryPart와 같은 파싱 규칙(HTML 대신 순수 텍스트로 반환). */
function extractSummarySection(resultSummary: string | null | undefined, aliases: string[]): string | null {
  if (!resultSummary?.trim()) return null;
  const headings = [...resultSummary.matchAll(/^##\s+(.+?)\s*$/gm)];
  const normalized = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const index = headings.findIndex((heading) => aliases.some((alias) => normalized(heading[1]).includes(normalized(alias))));
  if (index < 0) return null;
  const start = (headings[index].index ?? 0) + headings[index][0].length;
  const end = headings[index + 1]?.index ?? resultSummary.length;
  const part = resultSummary.slice(start, end).trim();
  return part || null;
}

/** dev_priority 제언 텍스트(recommendation.ts) 맨 앞의 "[전반적 방향성]" 블록만 분리한다 —
 * 원본 53쪽은 이 블록을 별도 행("전반적 방향성")으로, 나머지(핵심/차우선 기능 블록)는
 * "개발 우선순위 제언" 행으로 나눠 보여준다(lib/report/workspace.ts의 conclusionStrategyTableHtml과
 * 같은 원본 구조 — PDF는 여태 이 둘을 나누지 않고 한 덩어리로만 보여주고 있었다). */
export function splitOverallDirection(text: string | null): { overall: string | null; rest: string | null } {
  if (!text) return { overall: null, rest: null };
  const match = text.match(/\[전반적 방향성\]([\s\S]*?)(?=\n\s*\[|$)/);
  if (!match) return { overall: null, rest: text };
  const overall = match[1].trim();
  // 프롬프트는 "[전반적 방향성]"이 출력의 첫 줄이어야 한다고 지시하지만(prompts.ts), LLM이 그
  // 앞에 "# Ⅸ장 종합 결과 및 제언" 같은 장 제목을 덧붙이는 경우가 실측 확인됐다(2026-08-03) —
  // 이걸 그대로 rest에 붙이면 "개발 우선순위 제언" 칸 맨 위에 엉뚱한 헤더가 끼어들어 문서가
  // 깨진다. 계약상 [전반적 방향성] 앞에는 아무 내용도 없어야 하므로, 있어도 항상 잡음으로
  // 보고 버린다(보존할 정당한 내용이 이 위치에 올 수 없다).
  const rest = text.slice((match.index ?? 0) + match[0].length).trim();
  return { overall: overall || null, rest: rest || null };
}

/** Ⅸ.3 "기능별 고객 제언 종합" — customerRecommendations.ts가 만든 JSON(section=
 * "feature_customer_recommendations")을 파싱한다. lib/report/workspace.ts의
 * featureCustomerRecommendationsHtml과 같은 데이터 계약. */
export function parseCustomerRecommendations(row: RecommendationRow | null | undefined): { featureName: string; actions: string[] }[] | null {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.final ?? row.draft) as { features: { featureName: string; actions: string[] }[] };
    return parsed.features;
  } catch {
    return null;
  }
}


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
  // 2026-08-03 실제 hwpx 원본 대조: 카테고리 라벨 옆에 "(N건)" 건수를 붙인 적이 원본엔
  // 한 번도 없다("[운동 동기 부여 및 건강 증진]"처럼 라벨만) — 제거.
  return (
    <View style={styles.categoryBlock} wrap={false}>
      <Text style={styles.categoryLabel}>[{category.label}]</Text>
      {category.quotes.slice(0, 3).map((q, i) => (
        <Text key={q} style={styles.quote}>
          &ldquo;<InlineRichText value={category.quotes_display?.[i] ?? q} />&rdquo;
        </Text>
      ))}
      {/* "→"는 이 서브셋 폰트에서 "'"로 mojibake난다(richText.tsx의 arrow 블록과 같은 버그,
          2026-08-04 실측) — 같은 이유로 "›"를 쓴다. */}
      <Text style={styles.insight}>› {category.insight_final ?? category.insight_draft}</Text>
    </View>
  );
}

/** 개선아이디어 문항(kind="improvement") 전용 렌더러 — 원본 45~49쪽은 인사이트 없이
 * [대분류] + <소분류> + 원문 인용만 나열하는 2단 계층이다. Stage2가 label을
 * "대분류"+IMPROVEMENT_LABEL_SEP+"소분류"로 인코딩해 저장하므로(stage2.ts), 일반
 * CategoryBlock(단일 대괄호 라벨 + insight)을 그대로 쓰면 인코딩된 원문 그대로("대분류␟소분류")가
 * 노출되고 insight 자리엔 존재하지 않는 값이 찍힌다 — lib/report/workspace.ts의
 * improvementCategoryHtml과 같은 방식으로 대분류별로 묶어 디코딩해서 그린다. */
function ImprovementCategoryBlocks({ categories }: { categories: CategoryRow[] }) {
  const byMajor = new Map<string, CategoryRow[]>();
  for (const cat of categories) {
    const { major } = decodeImprovementLabel(cat.label);
    const key = major || "기타";
    (byMajor.get(key) ?? byMajor.set(key, []).get(key)!).push(cat);
  }
  return (
    <>
      {[...byMajor.entries()].map(([major, subs]) => (
        <View key={major} style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 8.5, fontWeight: "bold", marginTop: 6, marginBottom: 2 }}>[{major}]</Text>
          {subs.map((sub) => {
            const { sub: subLabel } = decodeImprovementLabel(sub.label);
            return (
              <View key={sub.id} style={{ marginBottom: 4 }} wrap={false}>
                <Text style={{ fontSize: 8.5, fontWeight: "bold", marginBottom: 2 }}>&lt;{subLabel}&gt;</Text>
                {sub.quotes.map((q, i) => (
                  <Text key={q} style={styles.quote}>
                    &ldquo;<InlineRichText value={sub.quotes_display?.[i] ?? q} />&rdquo;
                  </Text>
                ))}
              </View>
            );
          })}
        </View>
      ))}
    </>
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
      {/* 2026-08-03 실제 hwpx 원본 대조로 확정: 이 배너+퍼센트 형식(긍정/부정/중립 막대)은
          Ⅲ장(기능)·Ⅷ장(NPS/종합만족도)엔 그대로 있지만, Ⅴ장(4대가치)엔 전혀 없다 — Ⅴ장은
          이 컴포넌트를 아예 쓰지 않고 별도의 2열(긍정/부정) 레이아웃(FourValueSection)을 쓴다. */}
      {question.kind === "standard" && <PolarityStackedBar {...pct} />}
      {polarityOrder.map((p) => {
        const inPolarity = question.categories.filter((c) => c.polarity === p);
        if (inPolarity.length === 0) return null;
        bannerIndex += 1;
        return (
          <View key={p} style={{ marginTop: 6 }}>
            <PolarityBanner index={bannerIndex} polarity={p} label={polarityLabel[p]} pct={pctByPolarity[p]} />
            {question.polarity_summaries?.[p] && (
              <RichText value={question.polarity_summaries[p]} style={{ marginBottom: 4 }} />
            )}
            {inPolarity.map((c) => (
              <CategoryBlock key={c.id} category={c} />
            ))}
          </View>
        );
      })}
      {question.kind === "improvement" && <ImprovementCategoryBlocks categories={question.categories} />}
    </View>
  );
}

/** raw data 설문 항목("기능별 고객 경험 평가" 단계)에서 featureIndex번째(0-based) 기능의
 * Q번호를 찾는다. Ⅴ장 findSurveyQuestion과 같은 원리(featureSatisfaction/surveyQuestions 둘
 * 다 raw data 컬럼 순서를 그대로 유지한다는 전제) — 못 찾으면 0(헤딩에서 "Q" 접두어 생략). */
function featureQuestionNumber(stats: QuantStats, featureIndex: number): number {
  let qno = 0;
  let seen = 0;
  for (const row of stats.surveyQuestions) {
    qno += 1;
    if (row.stage === "기능별 고객 경험 평가") {
      if (seen === featureIndex) return qno;
      seen += 1;
    }
  }
  return 0;
}

/** Ⅲ장 기능별 문항 전용 블록 — 2026-08-04 실제 hwpx 원본(9~29쪽) 대조로 신규 작성.
 * `QuestionQualitativeBlock`(Ⅷ장이 계속 쓰는 단순 막대+카테고리 형식)과 별개다. 원본은 문항마다
 * "Q번호+질문" → "만족도 평균/표준편차 배너" → "만족도 분포도"(히스토그램) → "주관식 응답
 * 감정 분석"(도넛)+"응답 요약"(2열) → "1.긍정/2.부정/3.중립" 상세 카테고리 순으로 구성된다 —
 * 웹 뷰어(lib/report/workspace.ts의 featureQualitativeBlocks)는 이미 이 구조였는데 PDF만
 * 빠져 있었다("주요 키워드 도출" 워드클라우드는 2026-07-28 사용자 요청으로 웹도 제외했으므로
 * 여기서도 만들지 않는다). */
function FeatureQuestionBlock({
  question,
  feature,
  qno,
}: {
  question: QuestionWithApprovedCategories;
  feature: FeatureStat;
  qno: number;
}) {
  if (question.categories.length === 0) return null;
  const polarityOrder = ["positive", "negative", "neutral"] as const;
  const polarityLabel = { positive: "긍정", negative: "부정", neutral: "중립" };
  const pct = polarityPct(question.categories);
  const pctByPolarity = { positive: pct.positivePct, negative: pct.negativePct, neutral: pct.neutralPct };
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const c of question.categories) if (c.polarity) counts[c.polarity] += c.clause_count;
  const panelHeadStyle = {
    fontSize: 8.5,
    fontWeight: "bold" as const,
    backgroundColor: colors.chartBannerBg,
    color: colors.navy,
    padding: 4,
    textAlign: "center" as const,
  };
  const summaries = polarityOrder.filter((p) => question.polarity_summaries?.[p]);
  let bannerIndex = 0;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.qHeading}>
        {qno > 0 ? `Q${qno}. ` : ""}&apos;{feature.name}&apos; 기능의 만족도는 몇 점입니까?
      </Text>
      <View style={{ flexDirection: "row", marginBottom: 6 }}>
        <View style={{ flex: 2, backgroundColor: colors.chartBannerBg, padding: 6, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
          <Text style={{ fontSize: 9, fontWeight: "bold" }}>만족도 점수 평균 : {feature.mean.toFixed(2)} / 10</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.chartBannerBg, padding: 6, borderWidth: 1, borderLeftWidth: 0, borderColor: colors.border, alignItems: "center" }}>
          <Text style={{ fontSize: 9, fontWeight: "bold" }}>표준편차 : {feature.sd.toFixed(2)}</Text>
        </View>
      </View>
      {feature.scoreDistribution && (
        <View style={{ marginBottom: 6 }} wrap={false}>
          <Text style={panelHeadStyle}>만족도 분포도</Text>
          <View style={{ alignItems: "center", borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, padding: 6 }}>
            <PdfSatisfactionHistogram distribution={feature.scoreDistribution} width={320} />
          </View>
        </View>
      )}
      <View style={{ flexDirection: "row", marginBottom: 6 }} wrap={false}>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, marginRight: 4 }}>
          <Text style={panelHeadStyle}>주관식 응답 감정 분석</Text>
          <View style={{ padding: 6, alignItems: "center", justifyContent: "center" }}>
            <PdfPolarityDonut positive={counts.positive} negative={counts.negative} neutral={counts.neutral} width={150} />
          </View>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border }}>
          <Text style={panelHeadStyle}>응답 요약</Text>
          <View style={{ padding: 6 }}>
            {summaries.length === 0 ? (
              <Text style={styles.placeholder}>정성 요약이 아직 없습니다.</Text>
            ) : (
              summaries.map((p) => (
                <View key={p} style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 8.5, fontWeight: "bold" }}>[{polarityLabel[p]} 의견 요약]</Text>
                  <RichText value={question.polarity_summaries![p]!} />
                </View>
              ))
            )}
          </View>
        </View>
      </View>
      {polarityOrder.map((p) => {
        const inPolarity = question.categories.filter((c) => c.polarity === p);
        if (inPolarity.length === 0) return null;
        bannerIndex += 1;
        return (
          <View key={p} style={{ marginTop: 6 }}>
            <PolarityBanner index={bannerIndex} polarity={p} label={polarityLabel[p]} pct={pctByPolarity[p]} />
            {inPolarity.map((c) => (
              <CategoryBlock key={c.id} category={c} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** Ⅲ.2 "기능별 중요 순위 및 만족도 종합 해석" — FEATURE_SYSTEM(prompts.ts)이 만드는
 * "[종합 해석]"+"▶ 우선 개선 기능"/"▶ 차우선 개발 기능"/"▶ 비우선 개발 기능" 3단 구조를
 * 원본 29쪽처럼 렌더링한다(2026-08-04 실측 — 예전엔 이 구조화된 텍스트를 RichText 하나로만
 * 통째로 흘려서, "▶"가 화살표 불릿(→)으로 오인식되고 번호 항목 아래 "→" 서브라인이 들여쓰기
 * 없이 나열돼 원본의 계층 구조가 안 보였다). 프롬프트 출력은 이미 정확한 구조([종합 해석]/
 * ▶.../"N. ..."/"→ ...")로 생성돼 있었으므로 이번에도 순수 렌더링 버그였다. */
function parseFeatureAnalysisTiers(text: string): { overall: string; tiers: { title: string; items: { lead: string; arrows: string[] }[] }[] } {
  const [overall, ...tierBlocks] = text.split(/\n\s*▶\s*/);
  const tiers = tierBlocks.map((block) => {
    const lines = block.split(/\r?\n/).map((l) => l.trim());
    const title = lines[0] ?? "";
    const items: { lead: string; arrows: string[] }[] = [];
    let current: { lead: string; arrows: string[] } | null = null;
    for (const line of lines.slice(1)) {
      if (!line) continue;
      if (/^\d+\.\s*/.test(line)) {
        if (current) items.push(current);
        current = { lead: line, arrows: [] };
      } else if (/^(→|▶)\s*/.test(line) && current) {
        current.arrows.push(line.replace(/^(→|▶)\s*/, ""));
      }
    }
    if (current) items.push(current);
    return { title, items };
  });
  return { overall: overall.trim(), tiers };
}

function FeatureAnalysisBlock({ text }: { text: string }) {
  const { overall, tiers } = parseFeatureAnalysisTiers(text);
  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ backgroundColor: colors.chartBannerBg, padding: 5, marginBottom: 6 }}>
        <Text style={{ fontSize: 9.5, fontWeight: "bold", textAlign: "center", color: colors.navy }}>
          기능별 중요 순위 및 만족도 종합 해석
        </Text>
      </View>
      <RichText value={overall} />
      {tiers.map((tier, ti) => (
        <View key={ti} style={{ marginTop: 8 }} wrap={false}>
          {/* 리터럴 "▶" 텍스트는 이 서브셋 폰트에서 mojibake가 난다(위 TriangleBullet 주석
              참고) — SVG 삼각형으로 대체. */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
            <TriangleBullet />
            <Text style={{ fontSize: 9, fontWeight: "bold" }}>{tier.title}</Text>
          </View>
          {tier.items.map((item, ii) => (
            <View key={ii} style={{ marginBottom: 4 }}>
              <RichText value={item.lead} />
              {item.arrows.map((arrow, ai) => (
                <RichText key={ai} value={`→ ${arrow}`} style={{ marginLeft: 10 }} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Ⅲ. 기능별 고객경험평가 — 정량(만족도 세로 막대그래프 + 순위표) + 정성(3종세트). 실제 발행
 * 보고서 형식(전체 평균선 오버레이 + 만족도 순위 종합표, 2026-07-21 실측 대조)에 맞춰
 * 기존 가로 BarChart를 VerticalBarChartWithAverage로 교체했다. */
export function SectionFeatureExperience({
  stats,
  featureQuestions,
  featureExperienceAnalysis,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
  /** sectionAnalyses.featureExperience — Ⅲ.2 "기능별 고객 경험 분석"(원본 29~30쪽). 2026-08-03
   * 신규 연결: 이미 runSectionAnalysesForReport가 생성해 저장하고 있었는데 PDF는 이 데이터를
   * 아예 읽지 않아 렌더링에서 통째로 빠져 있었다(웹뷰어는 이미 표시하고 있었음). */
  featureExperienceAnalysis?: string | null;
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
      {featureQuestions.map((q) => {
        const featureName = q.question_key.replace(/^feature:/, "");
        const featureIndex = stats.featureSatisfaction.findIndex((f) => f.name === featureName);
        const feature = featureIndex >= 0 ? stats.featureSatisfaction[featureIndex] : null;
        if (!feature) return <QuestionQualitativeBlock key={q.id} question={q} />;
        return (
          <FeatureQuestionBlock
            key={q.id}
            question={q}
            feature={feature}
            qno={featureQuestionNumber(stats, featureIndex)}
          />
        );
      })}
      {featureExperienceAnalysis && (
        <View break>
          <SubsectionHeader number={2} title="기능별 고객 경험 분석" />
          <FeatureAnalysisBlock text={featureExperienceAnalysis} />
        </View>
      )}
    </View>
  );
}

/** Ⅴ 정성 보강 — 4대가치 문항별 카테고리(quant 표는 sectionsQuant.tsx의 SectionFourValuesTable). */
const FOUR_VALUE_LABEL_BY_KEY: Record<string, "기능적 가치" | "심미적 가치" | "경제적 가치" | "사회·공공적 가치"> = {
  "values:functional": "기능적 가치",
  "values:aesthetic": "심미적 가치",
  "values:economic": "경제적 가치",
  "values:social": "사회·공공적 가치",
};

/** Ⅴ장(4대가치) 정성 — 2026-08-03 실제 hwpx 원본(33~37쪽) 대조로 전면 재작성.
 * Ⅲ장·Ⅷ장이 쓰는 QuestionQualitativeBlock(번호 배너+퍼센트+긍정/부정/중립 3열)과 완전히
 * 다른 원본 구조를 그대로 따른다: 배너·퍼센트·중립 전혀 없이 "긍정 주요 의견 | 부정 주요 의견"
 * 두 열을 나란히 배치하고, 그 아래 "[○○ 가치 조사 결과]" 한 문단 소결론을 붙인다. */
// 4대 가치 문항의 raw data 컬럼 순서(설문 항목 표·QuantStats.fourValues 둘 다 이 순서를
// 전제한다) — Ⅲ장 featureQuestionNumber와 같은 원리로 Q번호를 찾는 데 쓴다.
const FOUR_VALUE_KEY_ORDER = ["values:functional", "values:aesthetic", "values:economic", "values:social"] as const;
const FOUR_VALUE_STAT_KEY: Record<string, "functional" | "aesthetic" | "economic" | "social"> = {
  "values:functional": "functional",
  "values:aesthetic": "aesthetic",
  "values:economic": "economic",
  "values:social": "social",
};

/** 4대 가치 문항의 Q번호+raw data 원문(요약 라벨이 아니라 헤더에 실제로 있는 전체 문장)을
 * 찾는다 — 웹 뷰어(lib/report/workspace.ts의 findSurveyQuestion)와 동일한 원칙: raw data가
 * ground truth이므로 하드코딩된 문구 대신 survey.question을 그대로 쓴다. */
function findValueSurveyQuestion(stats: QuantStats, questionKey: string): { qno: number; question: string } | null {
  const valueIndex = FOUR_VALUE_KEY_ORDER.indexOf(questionKey as (typeof FOUR_VALUE_KEY_ORDER)[number]);
  if (valueIndex < 0) return null;
  let qno = 0;
  let seen = 0;
  for (const row of stats.surveyQuestions) {
    qno += 1;
    if (row.stage === "4대 가치 만족도 평가") {
      if (seen === valueIndex) return { qno, question: row.question };
      seen += 1;
    }
  }
  return null;
}

export function SectionFourValuesQualitative({
  stats,
  valueQuestions,
  fourValueItemsText,
  fourValuesAnalysis,
}: {
  stats: QuantStats;
  valueQuestions: QuestionWithApprovedCategories[];
  fourValueItemsText?: string | null;
  /** sectionAnalyses.fourValues — Ⅴ.2 "4대 가치 조사 결과 분석"(원본 37쪽, 4개 가치를 합친
   * 3단락 종합해석). 2026-08-03 신규 연결(Ⅲ.2와 같은 이유로 빠져 있었다). */
  fourValuesAnalysis?: string | null;
}) {
  // 예전엔 정성 카테고리가 하나도 없으면 함수 전체가 null을 반환했다 — 이 함수가 순수 정량인
  // "1 4대 가치 조사 결과" 배너+막대그래프+표까지 떠맡게 된 뒤로는(아래 주석 참고) 그러면 정량
  // 전용 미리보기에서 Ⅴ장 전체가 통째로 사라진다. 정성 블록만 조건부로 숨기고, 차트+표는
  // 항상 그린다(다른 장의 quant 섹션과 같은 원칙).
  const hasQualitative = valueQuestions.some((q) => q.categories.length > 0);
  const itemTexts = parseFourValueItemTexts(fourValueItemsText ?? "");
  const panelHeadStyle = {
    fontSize: 8.5,
    fontWeight: "bold" as const,
    backgroundColor: colors.chartBannerBg,
    color: colors.navy,
    padding: 4,
    textAlign: "center" as const,
  };
  return (
    <View break>
      <SectionHeader numeral="V" title="4대 가치 만족도" />
      <SubsectionHeader number={1} title="4대 가치 조사 결과" />
      {!hasQualitative && <Text style={styles.placeholder}>정성 분석 결과가 아직 없습니다.</Text>}
      {valueQuestions.map((q) => {
        if (q.categories.length === 0) return null;
        const positives = q.categories.filter((c) => c.polarity === "positive");
        const negatives = q.categories.filter((c) => c.polarity === "negative");
        const valueLabel = FOUR_VALUE_LABEL_BY_KEY[q.question_key];
        const itemText = valueLabel ? itemTexts[valueLabel] : "";
        const statKey = FOUR_VALUE_STAT_KEY[q.question_key];
        const stat = statKey ? stats.fourValues[statKey] : null;
        const survey = findValueSurveyQuestion(stats, q.question_key);
        // 긍정/부정을 통짜 2열(각 열 전체를 하나의 flex 컨테이너)로 쌓으면, 두 열의 총
        // 높이가 페이지 하나를 넘어갈 때 react-pdf가 페이지 넘김에서 두 열을 서로 다른
        // 지점에서 잘못 이어붙여 내용이 겹쳐버린다(실측 확인, 2026-08-03 — 카테고리
        // 4~5개만 있어도 재현됨. Ⅲ/Ⅷ장은 좌우 2열 없이 세로로만 나열해서 이 버그가 없다).
        // 대신 긍정[i]/부정[i]를 한 쌍씩 짧은 행으로 묶어 렌더링한다 — 각 행은 카테고리
        // 1개씩만 담아 페이지 하나보다 항상 훨씬 짧으므로, 행과 행 사이에서만 페이지가
        // 안전하게 끊긴다(TransposedRankTable의 "행 단위로 쪼개면 겹침이 불가능해진다"
        // 패턴과 동일).
        const pairCount = Math.max(positives.length, negatives.length);
        return (
          <View key={q.id} style={{ marginBottom: 12 }}>
            <Text style={styles.qHeading}>
              {survey ? `Q${survey.qno}. ${survey.question}` : q.label}
            </Text>
            {stat && (
              <View style={{ flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border }}>
                  <Text style={panelHeadStyle}>평균</Text>
                  <Text style={{ fontSize: 9, textAlign: "center", padding: 5 }}>전체 {stat.mean.toFixed(2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={panelHeadStyle}>표준편차</Text>
                  <Text style={{ fontSize: 9, textAlign: "center", padding: 5 }}>{stat.sd.toFixed(2)}</Text>
                </View>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 4 }}>
              <Text style={[panelHeadStyle, { flex: 1 }]}>긍정 의견</Text>
              <Text style={[panelHeadStyle, { flex: 1, backgroundColor: "#fde4d0", color: "#c2410c" }]}>부정 의견</Text>
            </View>
            {Array.from({ length: pairCount }, (_, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 4 }} wrap={false}>
                <View style={{ flex: 1 }}>{positives[i] && <CategoryBlock category={positives[i]} />}</View>
                <View style={{ flex: 1 }}>{negatives[i] && <CategoryBlock category={negatives[i]} />}</View>
              </View>
            ))}
            <View style={{ marginTop: 4, borderWidth: 1, borderColor: colors.border }}>
              <Text style={panelHeadStyle}>[ {valueLabel ?? q.label} 조사 결과 ]</Text>
              <View style={{ padding: 6 }}>
                {itemText ? <RichText value={itemText} /> : <Text style={styles.placeholder}>정성 요약이 아직 없습니다.</Text>}
              </View>
            </View>
          </View>
        );
      })}
      {/* 원본 37쪽 "2 4대 가치 만족도 조사 결과 분석"은 배너 "4대 가치 만족도 종합 결과"
          (막대그래프+표) 바로 아래 배너 "4대 가치 만족도 종합 해석"(텍스트)이 같은 소절 안에
          이어진다 — 예전엔 차트+표(SectionFourValuesTable)를 Ⅴ장 맨 앞(이 "1" 문항별 블록보다
          먼저)에 별도 최상위 컴포넌트로 떼어놨었는데, 이는 chart+표가 통째로 사라진 것처럼
          보이는 원인이 됐다("2" 배너 아래엔 해석 텍스트만 있고 차트가 없었음, 2026-08-04
          사용자 지적). ReportDocument.tsx가 SectionFourValuesTable을 독립 컴포넌트로 뺐던
          이유(2026-08-03, 중첩 break로 인한 표 라벨 겹침 버그)는 "이 컴포넌트 트리 최상위에서
          두 번 break가 겹치는 것"이 원인이었지 "차트와 정성 콘텐츠를 한 함수에 못 둔다"는
          뜻이 아니었다 — Ⅲ장(SectionFeatureExperience)이 이미 같은 패턴(차트+표+정성 블록+
          요약을 한 함수 안에)으로 문제없이 동작한다. 여기서도 그 패턴을 따라 순수 JSX만
          이 함수 안으로 옮기고(별도 최상위 break-컴포넌트로 안 뺌), ReportDocument.tsx의
          독립 SectionFourValuesTable 호출은 제거했다. */}
      <View break>
        <SubsectionHeader number={2} title="4대 가치 조사 결과 분석" />
        <FourValuesSummaryChart stats={stats} />
        <View style={{ backgroundColor: colors.chartBannerBg, padding: 5, marginVertical: 6 }} wrap={false}>
          <Text style={{ fontSize: 9.5, fontWeight: "bold", textAlign: "center", color: colors.navy }}>
            4대 가치 만족도 종합 해석
          </Text>
        </View>
        <RichText value={fourValuesAnalysis ?? "해석이 아직 생성되지 않았습니다."} />
      </View>
    </View>
  );
}

/** Ⅴ.2 상단 "4대 가치 만족도 종합 결과" 배너+막대그래프+표 — 예전엔 별도 최상위 컴포넌트
 * (SectionFourValuesTable, sectionsQuant.tsx)로 Ⅴ장 맨 앞에 있었으나, 원본은 이 내용이 "2"
 * 소절(종합 해석 바로 위)에 속한다(위 SectionFourValuesQualitative 주석 참고). 4개 가치 순서는
 * 원본 그대로 기능적→심미적→사회·공공적→경제적(2026-08-04 hwpx 재대조 — 기존 코드는
 * 경제적/사회공공적이 뒤바뀌어 있었다). */
function FourValuesSummaryChart({ stats }: { stats: QuantStats }) {
  const rows = [
    { label: "기능적 가치", ...stats.fourValues.functional },
    { label: "심미적 가치", ...stats.fourValues.aesthetic },
    { label: "사회·공공적 가치", ...stats.fourValues.social },
    { label: "경제적 가치", ...stats.fourValues.economic },
  ];
  const average = Math.round((rows.reduce((a, r) => a + r.mean, 0) / rows.length) * 100) / 100;
  const valueMeans = rows.map((r) => r.mean);
  const [chartMin, chartMax] = computeBarWithAverageRange(valueMeans, average);
  return (
    <View wrap={false}>
      <VerticalBarChartWithAverage
        items={rows.map((r) => ({ label: r.label, value: r.mean }))}
        min={chartMin}
        max={chartMax}
        unit="점"
        title="[ 4대 가치 만족도 종합 결과 ]"
        average={average}
        yAxisTitle="만족도 평균"
        legendBarLabel="가치별 만족도 평균"
        legendAverageLabel="전체 가치 만족도 평균"
      />
      <View style={[styles.table, { marginTop: 6 }]}>
        <View style={styles.tableRow}>
          <Text style={styles.tableHeaderCell}>가치</Text>
          <Text style={styles.tableHeaderCell}>평균</Text>
          <Text style={styles.tableHeaderCell}>표준편차</Text>
        </View>
        {rows.map((r, i) => (
          <View key={r.label} style={i === rows.length - 1 ? styles.tableRowLast : styles.tableRow}>
            <Text style={styles.tableCell}>{r.label}</Text>
            <Text style={styles.tableCell}>{r.mean.toFixed(2)}</Text>
            <Text style={styles.tableCell}>{r.sd.toFixed(2)}</Text>
          </View>
        ))}
      </View>
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

export function npsJudgmentLines(
  nps: NpsResult,
  generated?: { lines: string[] } | null,
): JudgmentSegment[][] {
  // NPS 문항의 기존 Stage2 호출에서 생성·저장한 판단문이 있으면 이를 우선한다.
  // 세 줄 형식이 불완전한 기존 데이터/실패 데이터는 아래의 정량 기반 문구로 안전하게 폴백한다.
  const generatedLines = generated?.lines?.map((line) => line.trim()).filter(Boolean);
  if (generatedLines?.length === 3) {
    return generatedLines.map((text) => [{ text }]);
  }

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
/** Ⅷ.1 "전반적인 만족도"(Q26) — 2026-08-04 실제 hwpx 원본 대조로 확정: 이 문항은 Ⅲ장
 * 기능별 문항과 달리 "긍정/부정/중립" 폴라리티 막대·1.긍정/2.부정/3.중립 상세가 전혀 없다
 * (원본 전체에 "1. 긍정 의견"이 정확히 6번만 나오는데 전부 Ⅲ장 기능 문항 — Ⅷ.1/NPS는
 * 없음). 대신 평균/표준편차 표 + "[만족도 구간별 비율]"(0~6/7~8/9~10점, NPS와 같은
 * 3구간 나눔) + "[주요 시사점]" 정형화된 해설로 구성된다. 셋 다 결정론적으로 계산 가능해
 * LLM 호출이 필요 없다(NPS의 Promoter/Passive/Detractor 정의 문구와 같은 패턴). */
function OverallSatisfactionBreakdown({ stats }: { stats: QuantStats }) {
  const dist = stats.overallSatisfactionDistribution;
  const total = dist?.reduce((a, b) => a + b, 0) ?? 0;
  const pct = (from: number, to: number) => {
    if (!dist || total === 0) return 0;
    const sum = dist.slice(from, to + 1).reduce((a, b) => a + b, 0);
    return Math.round((sum / total) * 1000) / 10;
  };
  const negative = pct(0, 6);
  const neutral = pct(7, 8);
  const positive = pct(9, 10);
  const panelHeadStyle = {
    fontSize: 8.5,
    fontWeight: "bold" as const,
    backgroundColor: colors.chartBannerBg,
    color: colors.navy,
    padding: 4,
    textAlign: "center" as const,
  };
  return (
    <View>
      <View style={{ flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border }}>
          <Text style={panelHeadStyle}>평균 만족도</Text>
          <Text style={{ fontSize: 9, textAlign: "center", padding: 5 }}>{stats.overallSatisfaction.mean.toFixed(2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={panelHeadStyle}>표준편차</Text>
          <Text style={{ fontSize: 9, textAlign: "center", padding: 5 }}>{stats.overallSatisfaction.sd.toFixed(2)}</Text>
        </View>
      </View>
      <Text style={[styles.body, { fontWeight: "bold", marginTop: 4, marginBottom: 2 }]}>[만족도 구간별 비율]</Text>
      <Text style={styles.body}>0~6점 (부정적 구간): {negative}%</Text>
      <Text style={styles.body}>7~8점 (중립 구간): {neutral}%</Text>
      <Text style={styles.body}>9~10점 (긍정 구간): {positive}%</Text>
      <Text style={[styles.body, { fontWeight: "bold", marginTop: 6, marginBottom: 2 }]}>[주요 시사점]</Text>
      <Text style={[styles.body, { marginBottom: 2 }]}>
        <Text style={{ fontWeight: "bold" }}>긍정 고객 (9~10점, {positive}%)</Text> 높은 만족도를 보이는 고객군으로, 현재 서비스에 대해 긍정적인 평가를 하고 있음.
      </Text>
      <Text style={[styles.body, { marginBottom: 2 }]}>
        <Text style={{ fontWeight: "bold" }}>중립 고객 (7~8점, {neutral}%)</Text> 만족도가 높지도 낮지도 않은 상태로, 제품 개선을 통해 긍정 고객으로 전환할 수 있는 핵심 타깃층임.
      </Text>
      <Text style={styles.body}>
        <Text style={{ fontWeight: "bold" }}>부정 고객 (0~6점, {negative}%)</Text> 전반적인 평균 점수({stats.overallSatisfaction.mean.toFixed(2)})가 낮은 이유에 기여하고 있음. 단기간에는 중립 고객을 긍정 고객으로 전환하는 것이 전체 만족도 향상에 더 효과적일 수 있음.
      </Text>
    </View>
  );
}

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
        {npsJudgmentLines(stats.nps, npsQuestion?.polarity_summaries?.nps_judgment).map((segments, i) => (
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

      {/* 2026-08-04: overallQuestion(전반적인 만족도)·npsQuestion 둘 다 원본엔 폴라리티
          막대·1.긍정/2.부정/3.중립 상세가 없다(위 OverallSatisfactionBreakdown 주석 참고).
          NPS의 정성 결과는 이미 npsJudgmentLines(위)가 판단 문구로 소비하므로 여기서 또
          보여주지 않는다 — QuestionQualitativeBlock 호출을 완전히 뺐다. */}
      <View style={{ marginTop: 8 }}>
        <Text style={styles.qHeading}>
          {(() => {
            let qno = 0;
            for (const row of stats.surveyQuestions) {
              qno += 1;
              if (row.stage === "종합 만족도") return `Q${qno}. ${row.question}`;
            }
            return "전반적인 만족도";
          })()}
        </Text>
        <OverallSatisfactionBreakdown stats={stats} />
      </View>

      <View break>
        <SubsectionHeader number={2} title="개선 아이디어" />
        {improvementQuestion && improvementQuestion.categories.length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text
              style={{
                fontSize: 8.5,
                fontWeight: "bold",
                backgroundColor: colors.chartBannerBg,
                color: colors.navy,
                padding: 4,
                textAlign: "center",
              }}
            >
              주요 의견 종합
            </Text>
            <View style={{ padding: 6 }}>
              <ImprovementCategoryBlocks categories={improvementQuestion.categories} />
            </View>
          </View>
        ) : (
          <Text style={styles.placeholder}>정성 분석 결과가 아직 없습니다.</Text>
        )}
      </View>
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
const RESULT_SUMMARY_ITEMS: { label: string; aliases: string[] }[] = [
  { label: "핵심구매요소", aliases: ["핵심구매요소"] },
  { label: "4대 가치 만족도", aliases: ["4대 가치", "4대가치"] },
  { label: "사용자 경험 품질 평가", aliases: ["사용자 경험 품질", "UX"] },
  { label: "교차 분석", aliases: ["교차 분석"] },
  { label: "종합 만족도 및 NPS 지수", aliases: ["종합 만족도", "NPS"] },
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
  resultSummary,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
  resultSummary?: string | null;
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
      {/* 기능별 고객 경험 평가 — 사분면 그래프 + 6열 표 자동 채움. 2026-07-23엔 여기 `break`를
          걸었었는데, Ⅸ장 자체가 이미 자기 루트에 `<View break>`를 갖고 있어(SectionConclusion)
          이 행에도 break를 걸면 "IX 배너+1 사용성테스트 결과 요약 소제목+표 헤더"만 있는
          페이지 하나가 통째로 남고 표 본문은 그 다음 페이지로 밀려, 앞 페이지 대부분이
          텅 비는 문제가 실측 확인됐다(2026-08-04). 이 행은 Ⅸ장의 첫 콘텐츠라 이미 페이지
          맨 위 근처에서 시작하므로(위 섹션 break 덕분) 별도 break 없이도 페이지 경계에 걸릴
          일이 드물다 — `wrap={false}`만으로 충분한지는 실제 렌더로 재검증했다. */}
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
      {RESULT_SUMMARY_ITEMS.map((item, i) => {
        const part = extractSummarySection(resultSummary, item.aliases);
        return (
          <View
            key={item.label}
            style={
              i < RESULT_SUMMARY_ITEMS.length - 1
                ? { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }
                : { flexDirection: "row" }
            }
          >
            <ResultItemLabel label={item.label} />
            <View style={{ flex: 1, minHeight: 80, padding: 6 }}>
              {part ? (
                <RichText value={part} style={{ fontSize: 8.5, lineHeight: 1.5, marginBottom: 0 }} />
              ) : (
                <Text style={{ fontSize: 8.5, color: colors.subtext, lineHeight: 1.5 }}>입력 필요</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Ⅸ.3 "기능별 고객 제언 종합" — [기능 N] 기능명 제목 아래, "고객 제언 N" 라벨(왼쪽 좁은 열) +
 * 행동형 문구(오른쪽 열)를 행마다 테두리로 구분하는 표. 원본 55쪽과 동일한 형식(2026-08-04
 * 원본 대조 — 예전엔 배너 헤더 + 표 없는 텍스트 나열이었다). */
function CustomerActionTable({ actions }: { actions: string[] }) {
  return (
    <View style={styles.table}>
      {actions.map((action, j) => (
        <View key={j} style={j < actions.length - 1 ? styles.tableRow : styles.tableRowLast}>
          <View
            style={{
              width: 68,
              backgroundColor: "#dfe6f7",
              justifyContent: "center",
              alignItems: "center",
              padding: 5,
              borderRightWidth: 1,
              borderRightColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center" }}>고객 제언 {j + 1}</Text>
          </View>
          <View style={{ flex: 1, padding: 6 }}>
            <Text style={{ fontSize: 8.5, lineHeight: 1.4 }}>{action}</Text>
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
  resultSummary,
  devPriorityRecommendation,
  featureRecommendations,
  customerRecommendations,
  strategicInput,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
  resultSummary?: string | null;
  devPriorityRecommendation: string | null;
  featureRecommendations: RecommendationRow[];
  /** Ⅸ.3용 section="feature_customer_recommendations" 행(customerRecommendations.ts 생성). */
  customerRecommendations: RecommendationRow | null;
  strategicInput: { customerRequest: string | null; priorityMetric: string | null; draft: string | null } | null;
}) {
  // 원본 53쪽 "2. 개선 전략 제언"은 전반적 방향성 / 개발 우선순위 제언 / 기능 개선 제안 3블록이다
  // (reportPlan.ts의 목차와 동일한 제목을 써야 함 — lib/report/workspace.ts의
  // conclusionStrategyTableHtml과 같은 구조로 맞췄다, 예전엔 이 헤딩 자체가 "개발 우선순위 제언"
  // 하나뿐이라 ToC의 "개선 전략 제언"과도 어긋나 있었다).
  const { overall, rest: devPriorityRest } = splitOverallDirection(devPriorityRecommendation);
  const customerFeatures = parseCustomerRecommendations(customerRecommendations);
  return (
    <View break>
      <SectionHeader numeral="IX" title="종합 결과 및 제언" />
      <SubsectionHeader number={1} title="사용성테스트 결과 요약" />
      <ResultSummaryTable stats={stats} featureQuestions={featureQuestions} resultSummary={resultSummary} />

      <SubsectionHeader number={2} title="개선 전략 제언" />
      <View style={styles.table}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <ResultItemLabel label="전반적 방향성" />
          <View style={{ flex: 1, padding: 6 }}>
            <RichText value={overall ?? "핵심구매요소, 만족도·상대 중요도, NPS 지수를 함께 참조하여 우선 개선 항목을 검토할 필요가 있습니다."} />
          </View>
        </View>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <ResultItemLabel label="개발 우선순위 제언" />
          <View style={{ flex: 1, padding: 6 }}>
            <RichText value={devPriorityRest ?? "제언이 아직 생성·승인되지 않았습니다."} />
          </View>
        </View>
        {/* **문항 단위 행 흐름 구조**(SurveyQuestionTable과 같은 패턴, 2026-08-04) — 예전엔
            "기능 개선 제안" 6개 항목 전체를 라벨 1칸짜리 행 하나로 묶었는데, 이 행이 페이지에
            다 못 들어가면 라벨 칸의 배경색만 앞 페이지에 빈 박스로 남고 실제 항목은 전부
            테두리·라벨 없이 다음 페이지로 밀려버렸다(2026-08-04 실측 — "표가 깨진다"는 사용자
            지적). 항목(기능) 하나를 최소 단위 행으로 잡아 각각 wrap={false}로 흐르게 하고,
            "기능 개선 제안" 라벨은 첫 항목 행에만 넣은 뒤 나머지 행은 배경색만 이어서 병합된
            열처럼 보이게 한다 — 페이지가 넘어가도 이어지는 항목은 계속 테두리·배경 안에 있다. */}
        {featureRecommendations.length === 0 ? (
          <View style={{ flexDirection: "row" }}>
            <ResultItemLabel label="기능 개선 제안" />
            <View style={{ flex: 1, padding: 6 }}>
              <Text style={styles.placeholder}>승인된 기능개선제안이 아직 없습니다.</Text>
            </View>
          </View>
        ) : (
          // FEATURE_IMPROVEMENT_SYSTEM(prompts.ts)의 출력 첫 줄은 그 기능을 규정하는 짧은
          // 제목(예: "산책 보상 체계 고도화")이다 — 원본 54쪽은 이 제목에 "N. " 번호만 붙이고
          // 굵게 표시하며, 기능명(raw feature name)은 노출하지 않는다. 이하 줄("• As-is:"/
          // "• To-be:"/"→ ...")은 RichText가 그대로 불릿·화살표로 렌더링한다.
          featureRecommendations.map((r, i) => {
            const text = r.final ?? r.draft;
            const [title, ...restLines] = text.split(/\r?\n/);
            const isLast = i === featureRecommendations.length - 1;
            return (
              <View key={r.id} wrap={false} style={{ flexDirection: "row" }}>
                <View
                  style={{
                    width: 92,
                    backgroundColor: "#dfe6f7",
                    alignItems: "center",
                    paddingHorizontal: 4,
                    paddingTop: i === 0 ? 6 : 0,
                    borderRightWidth: 1,
                    borderRightColor: colors.border,
                  }}
                >
                  {i === 0 ? (
                    <Text style={{ fontSize: 8.5, fontWeight: "bold", textAlign: "center" }}>기능 개선 제안</Text>
                  ) : null}
                </View>
                <View
                  style={{
                    flex: 1,
                    padding: 6,
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 8.5, fontWeight: "bold", marginBottom: 2 }}>
                    {i + 1}. {title.trim()}
                  </Text>
                  <RichText value={restLines.join("\n")} />
                </View>
              </View>
            );
          })
        )}
      </View>

      <SubsectionHeader number={3} title="기능별 고객 제언 종합" />
      {!customerFeatures || customerFeatures.length === 0 ? (
        <Text style={styles.placeholder}>기능별 고객 제언은 정성 분석 승인 후 표시됩니다.</Text>
      ) : (
        customerFeatures.map((f, i) => (
          <View key={f.featureName} style={{ marginBottom: 8 }} wrap={false}>
            <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 3 }}>
              [기능 {i + 1}] {f.featureName}
            </Text>
            <CustomerActionTable actions={f.actions} />
          </View>
        ))
      )}

      {/* 원본 Ⅸ장 목차는 "1 사용성테스트 결과 요약/2 개선 전략 제언/3 기능별 고객 제언 종합"
          3개뿐이다(hwpx 재대조 확인, 2026-08-04) — "종합 전략 제언"은 PRD 7.3절이 요구하는
          이 도구 고유 기능(담당자가 채팅으로 전달한 요청사항을 AI 해석 없이 그대로 보여줌)이라
          원본엔 없다. 담당자가 실제로 뭔가 입력했을 때만 섹션 자체를 노출하고, 입력이 전혀
          없으면(이 raw data처럼) "입력 대기 중" placeholder로 섹션을 억지로 채우지 않고
          통째로 숨긴다 — 원본에 없는 섹션이 빈 채로 나오는 것보다 아예 없는 편이 원본과
          더 가깝다(2026-08-04 사용자 확인). */}
      {(strategicInput?.draft || strategicInput?.customerRequest || strategicInput?.priorityMetric) && (
        <>
          <SubsectionHeader number={4} title="종합 전략 제언" />
          {strategicInput.draft ? (
            <RichText value={strategicInput.draft} />
          ) : (
            <View>
              {strategicInput.customerRequest && (
                <Text style={styles.small}>고객사 요청사항: {strategicInput.customerRequest}</Text>
              )}
              {strategicInput.priorityMetric && (
                <Text style={styles.small}>우선 고려 지표: {strategicInput.priorityMetric}</Text>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}
