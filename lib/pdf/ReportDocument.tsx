// PRD 8장: 섹션 순서는 표준스키마_SW앱형.pdf 목차(Ⅰ~Ⅸ)를 그대로 따른다.
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./theme";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories, RecommendationRow, StrategicInputRow } from "@/lib/db/reports";
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
        <View style={{ marginTop: 16 }}>
          <SectionOverview productInfo={productInfo} />
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
