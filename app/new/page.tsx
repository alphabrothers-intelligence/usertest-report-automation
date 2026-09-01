"use client";

import { useState } from "react";
import { RecentReportsSidebar } from "@/components/RecentReportsSidebar";
import { UploadStep } from "@/components/wizard/UploadStep";
import { PreviewStep } from "@/components/wizard/PreviewStep";
import { INITIAL_WIZARD_STATE, type WizardState } from "@/components/wizard/types";

type Step = "upload" | "preparing" | "preview";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "데이터 등록" },
  { id: "preview", label: "구성 확인" },
];

/**
 * 마법사 진입점.
 *
 * **화면이 둘뿐이다**(2026-08-31 담당자 확정). 예전에는 `데이터 등록 → 목차 확인 → 정량 검토 →
 * 응답 분석` 네 단계였는데, 뒤 세 개는 전부 "확인했으니 다음"을 누르는 게이트였다. 셋 다 없앴다.
 *
 * - **목차 확인**: 미리보기 카드가 목차와 도표를 같이 보여주므로 따로 둘 이유가 없다.
 * - **정량 검토**: 요주의 지표는 보고서 웹뷰의 해당 도표 옆으로 옮겼다 — 고칠 수 있는 곳에
 *   이유가 있어야 한다(`ReviewFlagNotice`). 검토는 승인 게이트가 아니라 표시다.
 * - **응답 분석 대기**: 기다리지 않는다. 업로드 직후 정량·정성을 **같이** 시작해, 정량이
 *   끝나는 즉시(수 초) 카드를 띄우고 정성은 뒤에서 계속 돈다. 보고서로 넘어가도 그 화면이
 *   job 을 이어 돌린다(`useQualitativeJob`) — 진행 바 앞에 사람을 세워두지 않기 위해서다.
 */
export default function WizardPage() {
  const [step, setStep] = useState<Step>("upload");
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [qualitativeError, setQualitativeError] = useState<string | null>(null);

  /**
   * 업로드 직후 한 번에 시작한다. 정량은 **기다리고**(카드가 그 결과로 그려진다) 정성은
   * **기다리지 않는다**(job 만 만들고 진행은 다음 화면의 훅이 이어받는다).
   * 정성 job 은 report 행이 있어야 만들 수 있으므로 정량 다음에 부른다.
   */
  async function prepare(file: { url: string; name: string }) {
    setStep("preparing");
    setPrepareError(null);
    try {
      const response = await fetch("/api/wizard/quant-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: file.url, fileName: file.name }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? "정량 통계 계산에 실패했습니다.");
      setState((s) => ({ ...s, quantStats: payload.stats }));
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "정량 통계 계산에 실패했습니다.");
      setStep("upload");
      return;
    }

    // 정성은 실패해도 보고서를 못 만드는 게 아니다 — 사유만 남기고 카드로 넘어간다.
    try {
      const response = await fetch("/api/wizard/qualitative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: file.url }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? "의견 분석을 시작하지 못했습니다.");
      setState((s) => ({ ...s, qualitativeJobId: payload.jobId }));
    } catch (error) {
      setQualitativeError(error instanceof Error ? error.message : "의견 분석을 시작하지 못했습니다.");
    }

    setStep("preview");
  }

  return (
    <div className="flex min-h-screen bg-[#f4f7fb]">
      <RecentReportsSidebar />
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-9">
        <div className="mx-auto max-w-[1180px]">
          <header className="mb-5">
            <p className="text-xs font-semibold text-[#356df3]">REPORT WORKFLOW</p>
            <h1 className="mt-1 text-[25px] font-bold tracking-[-0.035em] text-[#202c40]">사용성 테스트 보고서 생성</h1>
            <p className="mt-1 text-sm text-[#7c899c]">데이터를 넣으면 분석하고, 어떤 보고서가 나올지 먼저 보여드립니다.</p>
          </header>
          <nav aria-label="보고서 생성 단계" className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-[#e0e6ef] bg-white p-1 shadow-[0_2px_8px_rgba(31,48,78,0.04)]">
            {STEPS.map((item, index) => {
              const activeIndex = STEPS.findIndex((candidate) => candidate.id === (step === "preparing" ? "upload" : step));
              const active = item.id === step;
              const completed = index < activeIndex;
              return <span key={item.id} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${active ? "bg-[#edf2ff] text-[#356df3]" : completed ? "text-[#52627a]" : "text-[#a1abba]"}`}>{completed ? "✓ " : ""}{item.label}</span>;
            })}
          </nav>
          <section className="rounded-xl border border-[#dde5ef] bg-white p-6 shadow-[0_4px_18px_rgba(31,48,78,0.05)] lg:p-8">
            {step === "upload" && (
              <>
                {prepareError && (
                  <p className="mb-4 rounded-lg border border-[#f1caca] bg-[#fff7f7] px-4 py-3 text-sm text-[#b54141]">{prepareError}</p>
                )}
                <UploadStep
                  validation={state.validation}
                  productInfoDone={state.productInfoDone}
                  onValidated={(file, result) => setState((s) => ({ ...s, rawDataFile: file, validation: result }))}
                  onProductInfoDone={() => setState((s) => ({ ...s, productInfoDone: true }))}
                  onNext={() => {
                    if (state.rawDataFile) void prepare(state.rawDataFile);
                  }}
                />
              </>
            )}

            {step === "preparing" && (
              <div className="flex items-center gap-3 px-1 py-6 text-sm text-[#52627a]">
                <span className="size-2 animate-pulse rounded-full bg-[#356df3]" />
                응답 수치를 계산하고 의견 분석을 시작하는 중입니다…
              </div>
            )}

            {step === "preview" && state.rawDataFile && (
              <PreviewStep
                fileUrl={state.rawDataFile.url}
                qualitativeJobId={state.qualitativeJobId}
                qualitativeError={qualitativeError}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}