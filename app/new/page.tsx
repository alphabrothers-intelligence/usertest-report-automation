"use client";

import { useState } from "react";
import { RecentReportsSidebar } from "@/components/RecentReportsSidebar";
import { UploadStep } from "@/components/wizard/UploadStep";
import { ReportPlanStep } from "@/components/wizard/ReportPlanStep";
import { QuantReviewStep } from "@/components/wizard/QuantReviewStep";
import { QualitativeStep } from "@/components/wizard/QualitativeStep";
import type { ReportPlanOutput } from "@/components/ReportPlanCard";
import { INITIAL_WIZARD_STATE, type WizardState } from "@/components/wizard/types";

type Step = "upload" | "report-plan" | "quant-review" | "qualitative";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "데이터 등록" },
  { id: "report-plan", label: "목차 확인" },
  { id: "quant-review", label: "정량 검토" },
  { id: "qualitative", label: "응답 분석" },
];

/**
 * 마법사 진입점 — 채팅(app/page.tsx)이 하던 "raw data→보고서 생성" 구간을 고정 순서 화면으로
 * 대체한다(계획 문서: 채팅→마법사 구조 개편, 2026-08-03). LLM은 다음 단계를 결정하지 않고,
 * 이 컴포넌트가 버튼 클릭에 따라 고정된 순서로 다음 단계를 연다. 정량 리뷰·정성 분석 단계는
 * 뒤이어 구현한다 — 지금은 목차 확인까지만 연결돼 있다.
 */
export default function WizardPage() {
  const [step, setStep] = useState<Step>("upload");
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);

  return (
    <div className="flex min-h-screen bg-[#f4f7fb]">
      <RecentReportsSidebar />
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-9">
        <div className="mx-auto max-w-[1180px]">
          <header className="mb-5">
            <p className="text-xs font-semibold text-[#356df3]">REPORT WORKFLOW</p>
            <h1 className="mt-1 text-[25px] font-bold tracking-[-0.035em] text-[#202c40]">사용성 테스트 보고서 생성</h1>
            <p className="mt-1 text-sm text-[#7c899c]">데이터를 확인하고 단계별로 보고서를 완성합니다.</p>
          </header>
          <nav aria-label="보고서 생성 단계" className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-[#e0e6ef] bg-white p-1 shadow-[0_2px_8px_rgba(31,48,78,0.04)]">
            {STEPS.map((item, index) => {
              const activeIndex = STEPS.findIndex((candidate) => candidate.id === step);
              const active = item.id === step;
              const completed = index < activeIndex;
              return <span key={item.id} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${active ? "bg-[#edf2ff] text-[#356df3]" : completed ? "text-[#52627a]" : "text-[#a1abba]"}`}>{completed ? "✓ " : ""}{item.label}</span>;
            })}
          </nav>
          <section className="rounded-xl border border-[#dde5ef] bg-white p-6 shadow-[0_4px_18px_rgba(31,48,78,0.05)] lg:p-8">
        {step === "upload" && (
          <UploadStep
            validation={state.validation}
            productInfoDone={state.productInfoDone}
            onValidated={(file, result) =>
              setState((s) => ({ ...s, rawDataFile: file, validation: result }))
            }
            onProductInfoDone={() => setState((s) => ({ ...s, productInfoDone: true }))}
            onNext={() => setStep("report-plan")}
          />
        )}

        {step === "report-plan" && state.validation?.valid && (
          <ReportPlanStep
            featureNames={state.validation.featureNames ?? []}
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
          </section>
        </div>
      </main>
    </div>
  );
}
