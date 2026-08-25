"use client";

import { useEffect, useState } from "react";
import { ReportPlanCard, type ReportPlanOutput } from "@/components/ReportPlanCard";

/**
 * 마법사 3단계 — 목차 계획을 보여주고 동의받는다. app/api/chat/route.ts의 presentReportPlan을
 * REST(/api/wizard/report-plan)로 옮긴 것을 마운트 시 한 번만 호출한다(규칙 기반, LLM 없음).
 */
export function ReportPlanStep({
  featureNames,
  onApprove,
}: {
  featureNames: string[];
  onApprove: (plan: ReportPlanOutput) => void;
}) {
  const [plan, setPlan] = useState<ReportPlanOutput | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wizard/report-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureNames }),
    })
      .then((res) => res.json())
      .then((data: ReportPlanOutput) => {
        if (!cancelled) setPlan(data);
      });
    return () => { cancelled = true; };
    // featureNames는 이 단계 진입 시 확정된 값이라 매 렌더 재요청할 필요가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-2xl">
      <ReportPlanCard
        state={plan ? "output-available" : "loading"}
        output={plan ?? undefined}
        onApprove={() => plan && onApprove(plan)}
      />
    </div>
  );
}
