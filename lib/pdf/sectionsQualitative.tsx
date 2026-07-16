// Ⅲ, Ⅴ(정성 보강), Ⅷ, Ⅸ 섹션 — 3종세트(그래프+표+서술) 조립 (PRD 8장).
// insight는 체크포인트 B에서 승인된 버전(insight_final)만 쓴다 — 승인 전 카테고리는애초에
// getQuestionsWithApprovedCategories가 걸러서 넘겨주므로 여기서는 존재하는 것만 그리면 된다.
import { View, Text } from "@react-pdf/renderer";
import { styles, colors } from "./theme";
import { BarChart, PolarityStackedBar } from "./charts";
import type { QuantStats } from "@/lib/quant/compute";
import type { CategoryRow, QuestionWithApprovedCategories, RecommendationRow } from "@/lib/db/reports";
import { SectionHeader } from "./sectionsQuant";

/**
 * 6.9절 결과요약 프롬프트가 "개조식으로 요약"을 지시하면 모델이 자율적으로 마크다운
 * (#, ##, -)을 섞어 쓰는 경우가 있다(프롬프트 자체는 6장 원문 그대로 유지 — 4.4절). react-pdf의
 * Text는 마크다운을 해석하지 않으므로, 렌더링 단계에서 가볍게 파싱해 굵은 소제목/불릿으로
 * 바꿔준다 — 프롬프트 내용을 바꾸는 게 아니라 출력을 표시하는 방식만 보정하는 것이다.
 */
function stripInlineBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return (
    <View>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isBoldLine = /^\*\*.+\*\*:?$/.test(trimmed);
        if (trimmed.startsWith("## ") || trimmed.startsWith("# ") || isBoldLine) {
          const content = isBoldLine
            ? trimmed.replace(/^\*\*|\*\*:?$/g, "")
            : trimmed.replace(/^#+\s*/, "");
          return (
            <Text key={i} style={{ fontSize: 9, fontWeight: "bold", marginTop: 6, marginBottom: 2 }}>
              {content}
            </Text>
          );
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <Text key={i} style={[styles.body, { marginLeft: 8 }]}>
              • {stripInlineBold(trimmed.slice(2))}
            </Text>
          );
        }
        return (
          <Text key={i} style={styles.body}>
            {stripInlineBold(trimmed)}
          </Text>
        );
      })}
    </View>
  );
}

function polarityPct(categories: CategoryRow[]) {
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

function QuestionQualitativeBlock({ question }: { question: QuestionWithApprovedCategories }) {
  if (question.categories.length === 0) return null;
  const polarityOrder = ["positive", "negative", "neutral"] as const;
  const polarityLabel = { positive: "긍정", negative: "부정", neutral: "중립" };
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.subheading}>{question.label}</Text>
      {question.kind === "standard" && <PolarityStackedBar {...polarityPct(question.categories)} />}
      {polarityOrder.map((p) => {
        const inPolarity = question.categories.filter((c) => c.polarity === p);
        if (inPolarity.length === 0) return null;
        return (
          <View key={p} style={{ marginTop: 6 }}>
            <Text style={{ fontSize: 8, color: colors.subtext, marginBottom: 2 }}>
              {polarityLabel[p]}
            </Text>
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

/** Ⅲ. 기능별 고객경험평가 — 정량(만족도 막대그래프) + 정성(3종세트) */
export function SectionFeatureExperience({
  stats,
  featureQuestions,
}: {
  stats: QuantStats;
  featureQuestions: QuestionWithApprovedCategories[];
}) {
  return (
    <View break>
      <SectionHeader numeral="III" title="기능별 고객경험평가" />
      <Text style={styles.subheading}>기능별 만족도</Text>
      <BarChart
        items={stats.featureSatisfaction.map((f) => ({ label: f.name, value: f.mean }))}
        max={10}
        unit="점"
      />
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

/** Ⅷ. NPS 종합만족도 및 개선아이디어 */
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
      <SectionHeader numeral="VIII" title="NPS 종합만족도 및 개선아이디어" />
      <Text style={styles.subheading}>종합만족도</Text>
      <Text style={styles.body}>
        전반적 만족도 평균 {stats.overallSatisfaction.mean}점(SD {stats.overallSatisfaction.sd}) ·
        NPS {stats.nps.npsScore} (추천 {stats.nps.promoterPct}% · 중립 {stats.nps.passivePct}% ·
        비추천 {stats.nps.detractorPct}%)
      </Text>
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

/** Ⅸ. 종합결과 및 제언 */
export function SectionConclusion({
  resultSummary,
  devPriorityRecommendation,
  featureRecommendations,
  strategicInput,
}: {
  resultSummary: string;
  devPriorityRecommendation: string | null;
  featureRecommendations: RecommendationRow[];
  strategicInput: { customerRequest: string | null; priorityMetric: string | null; draft: string | null } | null;
}) {
  return (
    <View break>
      <SectionHeader numeral="IX" title="종합결과 및 제언" />
      <Text style={styles.subheading}>1. 사용성테스트 결과 요약</Text>
      <MarkdownLite text={resultSummary} />

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
