"use client";

import { useState } from "react";
import { RecentReportsSidebar } from "@/components/RecentReportsSidebar";
import { ProductTypeStep } from "@/components/wizard/ProductTypeStep";
import { UploadStep } from "@/components/wizard/UploadStep";
import { ReportPlanStep } from "@/components/wizard/ReportPlanStep";
import { QuantReviewStep } from "@/components/wizard/QuantReviewStep";
import { QualitativeStep } from "@/components/wizard/QualitativeStep";
import type { ReportPlanOutput } from "@/components/ReportPlanCard";
import { INITIAL_WIZARD_STATE, type WizardState } from "@/components/wizard/types";

type Step = "product-type" | "upload" | "report-plan" | "quant-review" | "qualitative";

/**
 * 마법사 진입점 — 채팅(app/page.tsx)이 하던 "raw data→보고서 생성" 구간을 고정 순서 화면으로
 * 대체한다(계획 문서: 채팅→마법사 구조 개편, 2026-08-03). LLM은 다음 단계를 결정하지 않고,
 * 이 컴포넌트가 버튼 클릭에 따라 고정된 순서로 다음 단계를 연다. 정량 리뷰·정성 분석 단계는
 * 뒤이어 구현한다 — 지금은 목차 확인까지만 연결돼 있다.
 */
export default function WizardPage() {
  const [step, setStep] = useState<Step>("product-type");
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);

  return (
    <div className="flex min-h-screen bg-[#faf9f6] dark:bg-zinc-950">
      <RecentReportsSidebar />
      <main className="flex flex-1 items-start justify-center px-6 py-12">
        {step === "product-type" && (
          <ProductTypeStep
            value={state.productType}
            onSelect={(productType) => setState((s) => ({ ...s, productType }))}
            onNext={() => setStep("upload")}
          />
        )}

        {step === "upload" && state.productType && (
          <UploadStep
            productType={state.productType}
            validation={state.validation}
            productInfoDone={state.productInfoDone}
            onValidated={(file, result) =>
              setState((s) => ({ ...s, rawDataFile: file, validation: result }))
            }
            onProductInfoDone={() => setState((s) => ({ ...s, productInfoDone: true }))}
            onNext={() => setStep("report-plan")}
          />
        )}

        {step === "report-plan" && state.productType && state.validation?.valid && (
          <ReportPlanStep
            featureNames={state.validation.featureNames ?? []}
            productType={state.productType}
            onApprove={(plan: ReportPlanOutput) => {
              setState((s) => ({
                ...s,
                reportPlanSections: plan.sections,
                qualitativeQuestionCount: plan.qualitativeQuestionCount,
              }));
              setStep("quant-review");
            }}
          />
        )}

        {step === "quant-review" && state.rawDataFile && (
          <QuantReviewStep
            fileUrl={state.rawDataFile.url}
            fileName={state.rawDataFile.name}
            onNext={(quantStats) => {
              setState((s) => ({ ...s, quantStats }));
              setStep("qualitative");
            }}
          />
        )}

        {step === "qualitative" && state.rawDataFile && (
          <QualitativeStep fileUrl={state.rawDataFile.url} />
        )}
      </main>
    </div>
  );
}
