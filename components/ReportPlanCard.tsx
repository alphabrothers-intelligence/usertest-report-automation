"use client";

import type { ReportPlanSection } from "@/lib/pipeline/reportPlan";

export interface ReportPlanOutput {
  sections: ReportPlanSection[];
  qualitativeQuestionCount: number;
}

export function ReportPlanCard({
  state,
  output,
  onApprove,
}: {
  state: string;
  output?: ReportPlanOutput;
  onApprove: () => void;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        보고서 구성 계획 준비 중...
      </div>
    );
  }

  if (!output) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        보고서 구성 계획을 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-base text-zinc-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-zinc-100">
      <p className="text-base font-semibold">이런 목차·섹션으로 보고서를 구성할 예정입니다</p>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        동의하시면 정성 분석(문항 {output.qualitativeQuestionCount}개, 시간·비용이 드는 작업)을
        진행합니다. 다른 방향을 원하시면 버튼 대신 채팅으로 말씀해주세요.
      </p>
      <ul className="mt-3 space-y-2">
        {output.sections.map((sec) => (
          <li key={sec.numeral} className="text-sm leading-relaxed">
            <span className="font-medium">
              {sec.numeral}. {sec.title}
            </span>
            <span className="text-zinc-600 dark:text-zinc-400"> — {sec.source}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onApprove}
        className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
      >
        동의하고 진행
      </button>
    </div>
  );
}
