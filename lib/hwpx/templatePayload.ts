import type { CategoryRow, RecommendationRow, ReportRow, SectionAnalyses } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";
import type { ProductInfo } from "@/lib/productInfo/types";
import type { ReportSectionContent } from "@/lib/report/sections";
import {
  assertFeatureCapacity,
  selectHwpxTemplate,
  type HwpxTemplateDefinition,
} from "./templateDefinition";

/**
 * 템플릿 컴파일러의 유일한 입력.
 *
 * 이 타입은 DB에 이미 저장된 분석 결과를 복사해 전달할 뿐, 분석 프롬프트·Claude 호출·파이프라인
 * 상태를 변경하지 않는다. 앞으로 HWPX·PDF·웹 최종 미리보기는 이 같은 입력에서 파생한다.
 */
export type StoredTemplateReportPayload = {
  template: HwpxTemplateDefinition;
  report: {
    id: string;
    name: string | null;
    fileName: string | null;
    productInfo: ProductInfo | null;
    quantStats: QuantStats;
    resultSummary: string | null;
    sectionAnalyses: SectionAnalyses | null;
    workspaceDraft: ReportSectionContent[] | null;
  };
  qualitative: Array<{
    questionKey: string;
    questionLabel: string;
    categories: CategoryRow[];
  }>;
  recommendations: RecommendationRow[];
};

type QualitativeQuestion = {
  question_key: string;
  label: string;
  categories: CategoryRow[];
};

export function buildStoredTemplateReportPayload(input: {
  report: ReportRow;
  qualitative: QualitativeQuestion[];
  recommendations: RecommendationRow[];
}): StoredTemplateReportPayload {
  if (!input.report.quant_stats) {
    throw new Error("정량 분석 결과가 없는 보고서는 템플릿으로 내보낼 수 없습니다.");
  }

  const template = selectHwpxTemplate(input.report.product_type);
  assertFeatureCapacity(template, input.report.quant_stats.featureSatisfaction.length);

  return {
    template,
    report: {
      id: input.report.id,
      name: input.report.report_name,
      fileName: input.report.file_name,
      productInfo: input.report.product_info,
      quantStats: input.report.quant_stats,
      resultSummary: input.report.result_summary,
      sectionAnalyses: input.report.section_analyses,
      workspaceDraft: input.report.workspace_draft,
    },
    qualitative: input.qualitative.map((question) => ({
      questionKey: question.question_key,
      questionLabel: question.label,
      categories: question.categories,
    })),
    recommendations: input.recommendations,
  };
}
