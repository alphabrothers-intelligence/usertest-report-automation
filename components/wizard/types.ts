// 마법사(app/new/page.tsx) 공용 타입. 채팅의 AI SDK tool 출력 타입과 형태가 같은 것들이
// 많다 — REST 라우트가 그 tool execute 본문을 그대로 옮겨왔기 때문이다(계획 문서 참고).
import type { ProductInfo } from "@/lib/productInfo/types";
import type { QuantStats } from "@/lib/quant/compute";
import type { ReportPlanSection } from "@/lib/pipeline/reportPlan";

export interface ValidateResult {
  fileName: string | null;
  valid: boolean;
  error?: string;
  expectedColumnCount?: number;
  actualColumnCount?: number;
  respondentCount?: number;
  featureNames?: string[];
  errors?: { index: number; expected: string; actual: string }[];
}

export interface WizardState {
  rawDataFile: { url: string; name: string } | null;
  companyFile: { url: string; name: string } | null;
  validation: ValidateResult | null;
  extractedProductInfo: ProductInfo | null;
  productInfoDone: boolean;
  reportPlanSections: ReportPlanSection[] | null;
  qualitativeQuestionCount: number;
  quantStats: QuantStats | null;
  qualitativeJobId: string | null;
}

export const INITIAL_WIZARD_STATE: WizardState = {
  rawDataFile: null,
  companyFile: null,
  validation: null,
  extractedProductInfo: null,
  productInfoDone: false,
  reportPlanSections: null,
  qualitativeQuestionCount: 14,
  quantStats: null,
  qualitativeJobId: null,
};
