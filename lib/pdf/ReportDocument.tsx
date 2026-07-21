// PRD 8장: 섹션 순서는 표준스키마_SW앱형.pdf 목차(Ⅰ~Ⅸ)를 그대로 따른다.
import { Document, Page, Text, View, Link } from "@react-pdf/renderer";
import { styles, colors } from "./theme";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories, RecommendationRow, StrategicInputRow } from "@/lib/db/reports";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import {
  SectionOverview,
  SectionDemographics,
  SectionCorePurchaseFactor,
  SectionFourValuesTable,
  SectionUxQuality,
  SectionCrossAnalysis,
  type ProductInfo,
} from "./sectionsQuant";
import {
  SectionFeatureExperience,
  SectionFourValuesQualitative,
  SectionNpsAndImprovement,
  SectionConclusion,
} from "./sectionsQualitative";

export interface ReportDocumentProps {
  fileName: string | null;
  generatedAt: string;
  quantStats: QuantStats;
  questions: QuestionWithApprovedCategories[];
  recommendations: RecommendationRow[];
  strategicInput: StrategicInputRow | null;
  resultSummary: string;
  productInfo?: ProductInfo;
}

/**
 * 목차 페이지(2026-07-20 추가, 실제 발행 보고서 양식 대조 피드백). 채팅 목차 카드와 같은
 * lib/pipeline/reportPlan.ts의 buildReportPlan()을 그대로 써서 제목·소목차가 서로 어긋나지
 * 않게 한다(따로 두면 둘 중 하나만 고칠 때 어긋난다 — 실제 리바랩스 보고서의 설문 항목 표
 * 자체에 있던 문항번호 불일치를 발견하고 나서 특히 신경 쓴 부분).
 *
 * react-pdf는 페이지 레이아웃을 선언적으로 한 번에 그리기 때문에(사전 측정 없이), 목차에
 * "실제 몇 페이지"처럼 다른 위치의 결과물인 페이지 번호를 미리 계산해 넣을 방법이 없다
 * (bookmark는 PDF 뷰어의 사이드바 개요일 뿐, 본문에 찍을 텍스트가 아니다). 그래서 페이지
 * 번호 대신 각 항목을 해당 섹션으로 바로 이동하는 링크로 만들었다 — 화면에서 클릭 내비게이션은
 * 되지만, 인쇄물처럼 숫자로 확인하고 싶다면 이 부분은 알려진 단순화다.
 */
function TableOfContents({ featureNames }: { featureNames: string[] }) {
  const sections = buildReportPlan(featureNames);
  return (
    <View break>
      <Text style={{ fontSize: 14, fontWeight: "bold", marginBottom: 14 }}>목차</Text>
      {sections.map((entry) => (
        <View key={entry.numeral} style={{ marginBottom: 10 }} wrap={false}>
          <Link src={`#section-${entry.numeral}`} style={{ textDecoration: "none" }}>
            <Text style={{ fontSize: 10, fontWeight: "bold", color: colors.navy }}>
              {entry.numeral}. {entry.title}
            </Text>
          </Link>
          {entry.subitems.map((item) => (
            <Text key={item} style={{ fontSize: 8.5, color: colors.subtext, marginTop: 2, marginLeft: 12 }}>
              · {item}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function findQuestion(questions: QuestionWithApprovedCategories[], key: string) {
  return questions.find((q) => q.question_key === key);
}

function findRecommendation(recs: RecommendationRow[], section: string) {
  const r = recs.find((r) => r.section === section);
  return r ? (r.final ?? r.draft) : null;
}

export function ReportDocument({
  fileName,
  generatedAt,
  quantStats,
  questions,
  recommendations,
  strategicInput,
  resultSummary,
  productInfo,
}: ReportDocumentProps) {
  const featureQuestions = questions.filter((q) => q.question_key.startsWith("feature:"));
  const valueQuestions = questions.filter((q) => q.question_key.startsWith("values:"));
  const featureRecommendations = recommendations.filter((r) =>
    r.section.startsWith("feature_improvement:"),
  );

  return (
    <Document title={fileName ?? "사용성테스트 결과보고서"}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={{ fontSize: 16, fontWeight: "bold", marginBottom: 4 }}>
          사용성테스트 결과보고서
        </Text>
        <Text style={styles.small}>
          {fileName ?? "raw data"} · 생성일 {generatedAt}
        </Text>

        <TableOfContents featureNames={quantStats.featureSatisfaction.map((f) => f.name)} />

        <View break style={{ marginTop: 16 }}>
          <SectionOverview productInfo={productInfo} stats={quantStats} />
        </View>
        <SectionDemographics stats={quantStats} />
        <SectionFeatureExperience stats={quantStats} featureQuestions={featureQuestions} />
        <SectionCorePurchaseFactor
          stats={quantStats}
          recommendation={findRecommendation(recommendations, "core_purchase_factor")}
        />
        <View break>
          <SectionFourValuesTable stats={quantStats} />
          <SectionFourValuesQualitative valueQuestions={valueQuestions} />
        </View>
        <SectionUxQuality stats={quantStats} />
        <SectionCrossAnalysis stats={quantStats} />
        <SectionNpsAndImprovement
          stats={quantStats}
          overallQuestion={findQuestion(questions, "overallSatisfaction")}
          npsQuestion={findQuestion(questions, "nps")}
          improvementQuestion={findQuestion(questions, "improvementIdea")}
        />
        <SectionConclusion
          resultSummary={resultSummary}
          devPriorityRecommendation={findRecommendation(recommendations, "dev_priority")}
          featureRecommendations={featureRecommendations}
          strategicInput={
            strategicInput
              ? {
                  customerRequest: strategicInput.customer_request,
                  priorityMetric: strategicInput.priority_metric,
                  draft: strategicInput.draft,
                }
              : null
          }
        />

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
