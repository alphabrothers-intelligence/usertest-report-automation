"use client";

import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileUploadButton, type UploadedFile } from "@/components/FileUploadButton";
import { AttachHintBubble } from "@/components/AttachHintBubble";
import type { QuantStats } from "@/lib/quant/compute";
import { QuantStatsSummary } from "@/components/QuantStatsSummary";
import { ReportPlanCard, type ReportPlanOutput } from "@/components/ReportPlanCard";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import {
  ProductInfoExtractedCard,
  ProductInfoSavedCard,
  type ProductInfoExtractedOutput,
  type ProductInfoSavedOutput,
} from "@/components/ProductInfoCard";
import { ProductInfoPromptCard } from "@/components/ProductInfoPromptCard";
import { ChatMarkdown, CollapsibleChatMarkdown } from "@/components/ChatMarkdown";
import { PRODUCT_INFO_FIELD_LABELS, type ProductInfo } from "@/lib/productInfo/types";
import type { PipelineResult } from "@/lib/pipeline/orchestrate";
import { QualitativeResultsAccordion } from "@/components/QualitativeResults";
import { type HedgeViolation } from "@/components/RecommendationReview";
import { RecentReportsSidebar } from "@/components/RecentReportsSidebar";

interface ValidateInputOutput {
  fileName: string | null;
  valid: boolean;
  error?: string;
  expectedColumnCount?: number;
  actualColumnCount?: number;
  respondentCount?: number;
  featureNames?: string[];
  errors?: { index: number; expected: string; actual: string }[];
}

function ValidateInputCard({
  state,
  output,
}: {
  state: string;
  output?: ValidateInputOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        raw data 검증 중...
      </div>
    );
  }

  if (!output || output.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "검증 중 오류가 발생했습니다."}
      </div>
    );
  }

  if (!output.valid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">이 파일은 현재 자동 분석에 바로 사용할 수 있는 응답 양식과 다릅니다.</p>
        <p className="mt-1 text-sm">확인된 열 수: {output.actualColumnCount ?? "알 수 없음"}개 · 필요한 응답 구조: {output.expectedColumnCount ?? "알 수 없음"}개 항목</p>
        <p className="mt-1 text-sm">파일을 다시 확인하거나, 질문 열 이름을 알려주시면 맞추는 방법을 안내해드릴게요.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {output.errors?.map((e) => (
            <li key={e.index}>
              {e.index === -1
                ? e.expected
                : `${e.index}번 컬럼: "${e.expected}" 예상 → "${e.actual}" 발견`}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <p className="font-medium">
        {output.fileName ?? "raw data"} 파일을 읽고 보고서에 필요한 응답 구조를 확인했습니다.
      </p>
      <p className="mt-1">
        응답자 {output.respondentCount}명 · 그래프와 분석에 필요한 질문·응답 항목을 인식했습니다.
      </p>
      {output.featureNames && output.featureNames.length > 0 && (
        <p className="mt-1">기능: {output.featureNames.join(", ")}</p>
      )}
    </div>
  );
}

interface ComputeQuantStatsOutput {
  ok: boolean;
  error?: string;
  stats?: QuantStats;
}

// 목차 카드에 동의한 직후 "지금부터 뭘 계산하는지"를 로딩 문구 자체에 고정으로 박아둔다
// (2026-07-20 피드백: "정량 통계를 낼 거다, 확인하고 넘어가는 절차다"를 고지하고 싶다는
// 요청 — 모델이 매 턴 챗 텍스트로 이걸 서술해주길 기대하는 대신, 로딩 카드 자체에 코드로
// 고정하면 항상 확실하게 보인다). buildReportPlan의 numeral·title을 그대로 써서 목차 카드와
// 어긋나지 않게 한다.
const QUANT_STATS_SECTION_TITLES = buildReportPlan([])
  .filter((sec) => !["I", "IX"].includes(sec.numeral))
  .map((sec) => `${sec.numeral}.${sec.title}`)
  .join(" · ");

function QuantStatsCard({
  state,
  output,
}: {
  state: string;
  output?: ComputeQuantStatsOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">그래프용 응답 수치 계산 중...</p>
        <p className="mt-1 text-sm">
          방금 확인하신 목차 중 {QUANT_STATS_SECTION_TITLES}에 들어갈 그래프와 표를 위해 raw data의
          응답 수치와 비율을 계산하고 있어요.
        </p>
      </div>
    );
  }

  if (!output?.ok || !output.stats) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "그래프용 응답 수치 계산 중 오류가 발생했습니다."}
      </div>
    );
  }

  return <QuantStatsSummary s={output.stats} />;
}

interface RunQualitativeAnalysisOutput extends Partial<PipelineResult> {
  ok: boolean;
  error?: string;
  queued?: boolean;
  jobId?: string;
  totalQuestions?: number;
}

/**
 * "1~2분 정도 걸릴 수 있어요"라고만 써놓고 그 시간이 지나도 그대로면, 사용자가 계속 기다려야
 * 할지 뭔가 잘못된 건지 판단할 방법이 없다는 실측 피드백(2026-07-20 — 실제로 정성 분석이
 * 15분 넘게 안 끝난 사례가 있었다, lib/pipeline/polaritySummary.ts의 타임아웃 누락 버그).
 * 경과 시간을 직접 보여주고, 예상 시간을 넘기면 안내 문구 자체를 바꿔서 "지금 상태가 정상
 * 범위인지"를 사용자가 스스로 판단할 수 있게 한다.
 */
function useElapsedSeconds(startedAt?: string | null): number {
  const fallbackStartRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (fallbackStartRef.current === null) fallbackStartRef.current = Date.now();
    const parsedStart = startedAt ? Date.parse(startedAt) : Number.NaN;
    const base = Number.isFinite(parsedStart) ? parsedStart : fallbackStartRef.current;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - (base ?? Date.now())) / 1000)));
    update();
    const id = window.setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

function QualitativeAnalysisCard({
  state,
  output,
  onGenerateReport,
}: {
  state: string;
  output?: RunQualitativeAnalysisOutput;
  onGenerateReport: () => void;
}) {
  const [jobProgress, setJobProgress] = useState<{
    completed: number;
    failed: number;
    total: number;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(jobProgress?.startedAt);

  useEffect(() => {
    if (!output?.queued || !output.jobId) return;
    let cancelled = false;
    const baseUrl = `/api/qualitative-jobs/${output.jobId}`;
    const updateStatus = async () => {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("정성 분석 진행 상태를 불러오지 못했습니다.");
      const data = await response.json();
      if (!cancelled) {
        setJobProgress({
          completed: data.job.completed_items,
          failed: data.job.failed_items,
          total: data.job.total_items,
          status: data.job.status,
          startedAt: data.job.started_at ?? null,
          completedAt: data.job.completed_at ?? null,
        });
      }
      return data.job.status as string;
    };
    const worker = async () => {
      while (!cancelled) {
        const response = await fetch(`${baseUrl}/run-next`, { method: "POST" });
        const data = await response.json();
        const status = await updateStatus();
        if (["completed", "completed_with_failures", "failed", "cancelled"].includes(status)) return;
        // 다른 작업자가 모두 Stage1을 실행 중인 순간에는 잠시 뒤 다시 가져온다.
        if (!data.ok && !data.item) await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    };
    // 현재 실측에서는 문항 하나가 212초까지 걸렸다. 3개는 공급자 제한을 과도하게 밀지
    // 않으면서도 전체 시간을 약 1/3로 줄이는 시작값이며, 서버는 행 잠금으로 중복을 막는다.
    // **2026-07-27 버그 수정**: 위 주석은 "3개"라고 적혀 있는데 실제 코드는 worker()를 4번
    // 호출하고 있었다 — lib/pipeline/orchestrate.ts의 DEFAULT_CONCURRENCY=3(같은 교훈: "동시성
    // 4는 불안정해 3으로 조정"이 이미 이 프로젝트에서 실측으로 확인됨)과 이 클라이언트 폴링
    // 루프가 서로 다른 값을 쓰고 있었던 것 — 실제 14문항 전체 실행에서 4건이 90초 하드
    // 타임아웃으로 실패한 사고와 부합해 3으로 맞췄다.
    void Promise.all([worker(), worker(), worker()]).catch((error) => {
      if (!cancelled) setJobError(error instanceof Error ? error.message : String(error));
    });
    void updateStatus().catch((error) => {
      if (!cancelled) setJobError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [output?.jobId, output?.queued]);

  if (state !== "output-available") {
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const elapsedLabel = `경과 ${minutes}분 ${seconds}초`;
    const isTakingTooLong = elapsed >= 180;
    const isSlowerThanExpected = elapsed >= 90;
    return (
      <div
        className={`rounded-lg border px-5 py-4 text-base ${
          isTakingTooLong
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
        }`}
      >
        {isTakingTooLong ? (
          <>
            <p className="font-medium">예상보다 많이 오래 걸리고 있어요 ({elapsedLabel})</p>
            <p className="mt-1 text-sm">
              서버에서 계속 처리 중일 수 있지만, 보통 7~10분이면 끝나는 작업입니다. 조금 더 기다려보시거나, 계속 안 끝나면 페이지를
              새로고침한 뒤 다시 시도해주세요 — raw data와 정량 통계는 이미 저장되어 있어서
              다시 시작해도 처음부터 다시 하지 않아도 됩니다.
            </p>
          </>
        ) : isSlowerThanExpected ? (
          <p>응답 내용 분석을 준비하고 있어요. 진행 상태를 확인 중입니다. ({elapsedLabel})</p>
        ) : (
          <p>응답 내용 분석을 시작하고 있어요. 보통 약 7~10분 걸립니다. ({elapsedLabel})</p>
        )}
      </div>
    );
  }

  if (output?.ok && output.queued && output.jobId) {
    const progress = jobProgress ?? {
      completed: 0,
      failed: 0,
      total: output.totalQuestions ?? 14,
      status: "queued",
      startedAt: null,
      completedAt: null,
    };
    const done = progress.completed + progress.failed;
    const isFinished = ["completed", "completed_with_failures"].includes(progress.status);
    const isTerminalFailure = ["failed", "cancelled"].includes(progress.status);
    const startedAt = progress.startedAt ? new Date(progress.startedAt).getTime() : null;
    const finishedAt = progress.completedAt ? new Date(progress.completedAt).getTime() : null;
    const jobElapsedSeconds = startedAt && finishedAt
      ? Math.max(0, Math.floor((finishedAt - startedAt) / 1000))
      : elapsed;
    const elapsedLabel = `${Math.floor(jobElapsedSeconds / 60)}분 ${jobElapsedSeconds % 60}초`;
    const statusLabel: Record<string, string> = {
      queued: "분석 시작 준비 중",
      running: "응답 내용 분석 중",
      completed: "분석 완료",
      completed_with_failures: "분석 완료 · 일부 문항 제외",
      failed: "분석을 완료하지 못했습니다",
      cancelled: "분석이 중단되었습니다",
    };
    if (isFinished) {
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <p className="font-semibold">응답 내용 분석이 완료되었습니다 · {done}/{progress.total} 문항</p>
          <p className="mt-1 text-sm">실제 소요 시간 {elapsedLabel} · 긍정·부정·중립 반응과 고객 경험 분석 초안을 저장했습니다.</p>
          {progress.failed > 0 && <p className="mt-2 text-sm text-amber-800">일부 문항({progress.failed}개)은 분석에 실패했습니다. 나머지 결과로 보고서를 만들 수 있습니다.</p>}
          <button type="button" onClick={onGenerateReport} className="mt-4 rounded-full bg-[#315c9c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#294c81]">
            분석 결과를 바탕으로 보고서 만들기
          </button>
        </div>
      );
    }
    if (isTerminalFailure) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
          <p className="font-semibold">{statusLabel[progress.status]} · {done}/{progress.total} 문항 처리</p>
          <p className="mt-1 text-sm">경과 {elapsedLabel}. 원본 데이터와 그래프용 수치는 유지되어 있습니다. 다시 시도하면 완료된 문항부터 이어서 처리합니다.</p>
          {jobError && <p className="mt-2 text-sm">{jobError}</p>}
        </div>
      );
    }
    // 대기열 상태에서는 아직 어떤 문항도 처리되지 않았으므로 0%를 그대로 보여준다.
    // 임의의 최소 폭을 주면 0/14인데도 진행된 것처럼 보여 사용자에게 혼란을 준다.
    const progressPercent = progress.status === "queued"
      ? 0
      : Math.round((done / Math.max(progress.total, 1)) * 100);
    return (
      <div aria-live="polite" className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-4 text-base text-sky-950 shadow-sm dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{statusLabel[progress.status] ?? "응답 내용 분석 중"} · {done}/{progress.total} 문항 완료</p>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-sky-800 shadow-sm dark:bg-sky-950 dark:text-sky-100">경과 {elapsedLabel}</span>
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-sm font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">예상 약 7~10분</span>
          </div>
        </div>
        <p className="mt-1 text-sm">서술형 답변을 바탕으로 반응과 고객 경험을 정리하고 있습니다. 완료된 문항부터 바로 저장합니다.</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900">
          <div className={`h-full transition-all ${progress.status === "queued" ? "bg-amber-500" : "bg-sky-600"}`} style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="mt-2 text-xs text-sky-700 dark:text-sky-300">진행률 {progressPercent}% · 상태: {statusLabel[progress.status] ?? "확인 중"}{progress.failed > 0 ? ` · 제외 ${progress.failed}문항` : ""}</p>
        {jobError && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{jobError}</p>}
      </div>
    );
  }

  if (!output?.ok || !output.questions) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "정성 응답 분석 중 오류가 발생했습니다."}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 text-base text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="text-base font-semibold">
        정성 응답 분석 완료 (14개 문항, {((output.elapsedMs ?? 0) / 1000).toFixed(1)}초)
      </p>
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        아래 인사이트는 AI 초안입니다 — 담당자 검수 전이며, 최종 보고서에는 검수 후에만 반영됩니다.
      </p>
      <QualitativeResultsAccordion questions={output.questions} />
    </div>
  );
}

interface ResultSummaryOutput {
  ok: boolean;
  error?: string;
  summary?: string;
}

function ResultSummaryCard({ state, output }: { state: string; output?: ResultSummaryOutput }) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        결과요약 생성 중...
      </div>
    );
  }
  if (!output?.ok || !output.summary) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "결과요약 생성 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="w-full whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">사용성테스트 결과 요약</p>
      <p className="mt-2">{output.summary}</p>
    </div>
  );
}

interface RecommendationDraftOutput {
  ok: boolean;
  error?: string;
  section?: string;
  draft?: string;
  hedgeViolations?: HedgeViolation[];
}

function RecommendationDraftCard({
  state,
  output,
}: {
  state: string;
  output?: RecommendationDraftOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        제언 생성 중...
      </div>
    );
  }
  if (!output?.ok || !output.draft) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "제언 생성 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">제언 초안 ({output.section}) — 검수 대기 중</p>
      {output.hedgeViolations && output.hedgeViolations.length > 0 && (
        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {output.hedgeViolations.map((v) => (
            <p key={v.detail}>⚠ {v.detail}</p>
          ))}
        </div>
      )}
      <p className="mt-2 whitespace-pre-wrap">{output.draft}</p>
    </div>
  );
}

interface SaveStrategicInputOutput {
  ok: boolean;
  error?: string;
}

function SaveStrategicInputCard({
  state,
  output,
}: {
  state: string;
  output?: SaveStrategicInputOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        저장 중...
      </div>
    );
  }
  if (!output?.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "저장 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      종합 전략 제언 내용을 저장했습니다.
    </div>
  );
}

interface AssembleReportOutput {
  ok: boolean;
  error?: string;
  pendingInsightCount?: number;
  pendingRecommendationCount?: number;
  pdfUrl?: string;
  docxUrl?: string;
  hwpxUrl?: string;
  sourceFileUrl?: string;
}

function AssembleReportCard({ state, output }: { state: string; output?: AssembleReportOutput }) {
  const router = useRouter();
  const elapsed = useElapsedSeconds();
  const viewerHref = output?.pdfUrl
    ? `/viewer?pdf=${encodeURIComponent(output.pdfUrl)}${output.sourceFileUrl ? `&source=${encodeURIComponent(output.sourceFileUrl)}` : ""}`
    : "/viewer";

  useEffect(() => {
    if (state !== "output-available" || !output?.ok || !output.pdfUrl) return;
    const timer = window.setTimeout(() => router.push(viewerHref), 900);
    return () => window.clearTimeout(timer);
  }, [output?.ok, output?.pdfUrl, router, state, viewerHref]);

  if (state !== "output-available") {
    const stage = elapsed < 10
      ? "보고서 구조를 정리하고 있습니다"
      : elapsed < 30
        ? "그래프와 표를 배치하고 있습니다"
        : "PDF·DOCX·HWPX 파일을 만들고 있습니다";
    const progress = elapsed < 10 ? 25 : elapsed < 30 ? 60 : 85;
    return (
      <div aria-live="polite" className="rounded-xl border border-[#b9d8f1] bg-[#f2f9ff] px-5 py-4 text-base text-[#173f5e] shadow-sm dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">최종 보고서를 만들고 있습니다</p>
          <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-[#24577f] shadow-sm dark:bg-sky-950 dark:text-sky-100">경과 {Math.floor(elapsed / 60)}분 {elapsed % 60}초</span>
        </div>
        <p className="mt-1 text-sm">{stage}. 보통 수십 초에서 2분 정도 걸립니다.</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#dceefa] dark:bg-sky-900">
          <div className="h-full bg-[#3b82b8] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-[#457196] dark:text-sky-300">현재 단계 안내 · 생성이 끝나면 편집 화면으로 바로 이동합니다.</p>
      </div>
    );
  }
  if (!output?.ok || !output.pdfUrl) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "PDF 조립 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <p className="font-medium">최종 보고서 PDF가 완성됐습니다.</p>
      <p className="mt-1 text-sm">편집 뷰어로 이동합니다. 뷰어에서 내용을 수정하고 저장할 수 있습니다.</p>
      <Link
        href={viewerHref}
        className="mt-3 inline-block rounded-full bg-[#315c9c] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#254879]"
      >
        보고서 뷰어 열기
      </Link>
      <a
        href={output.pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
      >
        PDF 다운로드
      </a>
      {output.docxUrl && (
        <a
          href={output.docxUrl}
          className="mt-2 ml-2 inline-block rounded-full border border-emerald-700 px-4 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
        >
          DOCX 다운로드
        </a>
      )}
      {output.hwpxUrl && (
        <a
          href={output.hwpxUrl}
          className="mt-2 ml-2 inline-block rounded-full border border-[#315c9c] px-4 py-1.5 text-sm font-medium text-[#315c9c] hover:bg-[#e8effa]"
        >
          HWPX 다운로드
        </a>
      )}
    </div>
  );
}

/**
 * 첨부 파일은 곧바로 전송하지 않고 입력창에 "붙어있는" 상태로만 두고, 실제 전송은 사용자가
 * 메시지를 입력해서 보낼 때 이루어진다(ChatGPT/Claude와 동일한 UX) — 사용자가 어떤 말을
 * 하든 자유롭게 대화할 수 있어야 한다는 피드백 반영. 사용자가 아무 텍스트도 안 쓰고 파일만
 * 첨부한 채 전송하면, 기존 동작과 동일하게 "검증해줘" 기본 문구를 붙여 보낸다.
 *
 * raw data 파일 하나 + 기업소개 파일 하나처럼 여러 개를 한 메시지에 같이 첨부할 수 있다
 * (2026-07-20 피드백) — 모델이 fileUrl을 알아야 하므로 각 파일을 블록으로 이어붙인다.
 */
function buildMessageText(files: UploadedFile[], userText: string): string {
  const trimmed = userText.trim();
  if (files.length === 0) return trimmed;
  const fileBlocks = files
    .map((f) => `[업로드된 파일]\n파일명: ${f.name}\nURL: ${f.url}`)
    .join("\n\n");
  return trimmed ? `${fileBlocks}\n\n${trimmed}` : `${fileBlocks}\n\n이 파일을 확인해줘.`;
}

const FILE_BLOCK_RE = /\[업로드된 파일\]\n파일명: (.+)\nURL: (\S+)\n*/g;

/**
 * buildMessageText가 채팅 텍스트에 심어 보낸 파일 블록(모델이 fileUrl을 읽는 데 필요)을
 * 화면에는 원문 URL까지 그대로 다시 보여줄 필요가 없어서(2026-07-20 피드백 — Claude처럼
 * 첨부는 작은 칩으로만, 사용자가 쓴 텍스트는 텍스트대로), 렌더링 직전에만 분리해낸다.
 * 모델에게 보내는 실제 메시지 텍스트는 그대로 두고 표시만 바꾸는 것이라 안전하다.
 */
function extractFileBlocks(text: string): { files: UploadedFile[]; remainder: string } {
  const files: UploadedFile[] = [];
  const remainder = text
    .replace(FILE_BLOCK_RE, (_match, name: string, url: string) => {
      files.push({ name, url });
      return "";
    })
    .trimStart();
  return { files, remainder };
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [showAttachHint, setShowAttachHint] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const { messages: rawMessages, sendMessage, status } = useChat();
  // useChat이 드물게 같은 id의 메시지를 두 번 내보내는 게 실측으로 확인됐다(React "Encountered
  // two children with the same key" 경고, 2026-07-20 라이브 테스트 — 목차 동의로 넘어가는
  // 턴에서 재현됨). 원인이 라이브러리 내부라 여기서 직접 고칠 수 없으니, 렌더링 직전에 같은
  // id를 가진 메시지는 마지막 것만 남기고 걸러낸다 — 카드가 두 번 뜨는 걸 막는 가장 확실한 지점.
  const messages = rawMessages
    .filter((m, i) => rawMessages.findLastIndex((m2) => m2.id === m.id) === i)
    // 카드 버튼이 서버에 전달하는 내부 명령은 대화 흐름을 진행하기 위한 신호일 뿐, 사용자가
    // 직접 작성한 메시지가 아니다. 따라서 주황색 사용자 말풍선으로 반복 표시하지 않는다.
    .filter((m) => {
      if (m.role !== "user") return true;
      const text = m.parts
        .filter((part): part is Extract<(typeof m.parts)[number], { type: "text" }> => part.type === "text")
        .map((part) => part.text.trim())
        .join("\n");
      return !/^(다음 기업\/제품 정보를 저장해주세요\.|확인했어요, 이 기업 정보로 저장해주세요\.|이 목차\/섹션 구성에 동의합니다\.)/.test(text);
    });

  // 단계 버튼을 눌러 새 카드나 응답이 추가되면, 사용자가 새 내용을 놓치지 않도록
  // 가장 최근 대화의 시작 위치로 자연스럽게 이동한다. 텍스트 스트리밍의 매 글자마다
  // 화면이 흔들리지 않도록 텍스트 본문 대신 메시지/도구 상태 변화만 감지한다.
  const latestMessage = messages.at(-1);
  const latestMessageStateSignature = latestMessage
    ? latestMessage.parts
        .map((part) => {
          const toolPart = part as { type: string; state?: string };
          return `${toolPart.type}:${toolPart.state ?? ""}`;
        })
        .join("|")
    : "";
  const latestMessageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!latestMessage?.id) return;

    const timer = window.setTimeout(() => {
      latestMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [latestMessage?.id, latestMessageStateSignature]);

  function handleUploaded(file: UploadedFile) {
    setShowAttachHint(false);
    setAttachedFiles((prev) => [...prev, file]);
  }

  function removeAttachedFile(url: string) {
    setAttachedFiles((prev) => prev.filter((f) => f.url !== url));
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submitComposer() {
    // 파일이 아직 업로드 중일 때 전송하면 그 파일이 통째로 누락된 채 메시지가 나가는
    // 문제가 실측으로 확인됐다(여러 파일을 동시 첨부하면 업로드 완료 시점이 서로 달라서
    // 벌어짐, 2026-07-20) — 업로드 중에는 전송 자체를 막는다.
    if (isUploadingFiles) return;
    if (!input.trim() && attachedFiles.length === 0) return;
    sendMessage({ text: buildMessageText(attachedFiles, input) });
    setInput("");
    setAttachedFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  const composerForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer();
      }}
      className="w-full max-w-4xl px-4"
    >
      <div className="rounded-3xl border border-[#dfdbd2] bg-[#fffdf9] shadow-[0_8px_28px_rgba(69,58,45,0.08)]">
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachedFiles.map((file) => (
              <div
                key={file.url}
                className="flex items-center gap-2 rounded-full border border-[#dfdbd2] bg-[#f5f1e9] px-3 py-1 text-sm text-[#544c44]"
              >
                <span aria-hidden>📎</span>
                <span>{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachedFile(file.url)}
                  aria-label="첨부 제거"
                  className="text-[#a39a8d] hover:text-[#5e554c]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Claude/ChatGPT처럼 입력 길이에 맞춰 늘어나되 일정 높이 이상은 스크롤되게 한다.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            // Enter로 전송, Shift+Enter로 줄바꿈 — 여러 줄 요구사항을 붙여넣어도 그대로
            // 살아있어야 "더보기" 접기가 의미가 있다(단일 줄 input은 줄바꿈을 브라우저가
            // 자동으로 지워버려서 여러 줄 메시지 자체가 불가능했다 — 2026-07-20 실측 확인).
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComposer();
            }
          }}
          placeholder="오늘 어떤 보고서를 만들어드릴까요?"
          disabled={status !== "ready"}
          rows={1}
          className="max-h-[200px] w-full resize-none bg-transparent px-5 pb-2 pt-4 text-base text-[#2f2a26] outline-none placeholder:text-[#9f978d] disabled:opacity-50"
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="relative">
            {showAttachHint && <AttachHintBubble onDismiss={() => setShowAttachHint(false)} />}
            <FileUploadButton
              onUploaded={handleUploaded}
              onUploadingChange={setIsUploadingFiles}
              disabled={status !== "ready"}
            />
          </div>
          {isUploadingFiles && (
            <span className="text-sm text-[#9f978d]">파일 업로드 중...</span>
          )}
          <button
            type="submit"
            disabled={
              status !== "ready" ||
              isUploadingFiles ||
              (!input.trim() && attachedFiles.length === 0)
            }
            aria-label="전송"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d97757] text-white shadow-sm transition hover:bg-[#c96648] disabled:opacity-30"
          >
            <span aria-hidden>↑</span>
          </button>
        </div>
      </div>
    </form>
  );

  if (messages.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f6f2] px-4">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[#2f2a26]">사용성테스트 결과보고서</h1>
            <p className="mt-2 text-sm text-[#81786e]">raw data를 올리면 보고서에 필요한 수치와 응답 내용을 차례로 정리합니다.</p>
          </div>
          {composerForm}
          <p className="text-sm text-[#81786e]">xlsx·csv 파일을 첨부하거나, 만들고 싶은 보고서를 말씀해주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f7f6f2]">
      <RecentReportsSidebar />
      <div className="flex min-w-0 flex-1 flex-col items-center">
      <div className="flex w-full min-w-0 max-w-5xl flex-1 flex-col px-4 py-7">
        <div className="mb-8 flex items-center justify-between border-b border-[#e5e0d7] pb-4">
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-[#2f2a26]">사용성테스트 결과보고서</h1>
          <span className="rounded-full bg-[#ece8df] px-3 py-1 text-xs font-medium text-[#746b60]">보고서 작성 도우미</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 pb-32">
          {messages.map((message, messageIndex) => (
            <div
              key={message.id}
              ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined}
              className={`min-w-0 whitespace-pre-wrap break-words text-base ${
                message.role === "user"
                  ? "self-end max-w-[82%] rounded-2xl rounded-br-md bg-[#e4a17e] px-4 py-3 text-white shadow-sm"
                  : "self-start w-full max-w-4xl text-[#302b27]"
              }`}
            >
              {(() => {
                // 분석 등록 직후에는 모델이 일반 텍스트로 "완료"라고 잘못 설명해도 카드의 실제
                // DB 상태와 충돌하면 안 된다. 이 턴은 상태 카드만 보여주고, 다음 행동은 카드가
                // 완료 상태일 때만 노출한다.
                const hasQualitativeJobCard = message.parts.some(
                  (part) =>
                    part.type === "tool-runQualitativeAnalysis" &&
                    "output" in part &&
                    Boolean((part.output as RunQualitativeAnalysisOutput | undefined)?.queued),
                );

                return message.parts.map((part, i) => {
                if (part.type === "text") {
                  if (message.role !== "user") {
                    if (hasQualitativeJobCard) return null;
                    return (
                      <div key={i} className="max-w-3xl py-2 text-[15px] leading-7 text-[#3a342f]">
                        <ChatMarkdown text={part.text} />
                      </div>
                    );
                  }
                  // 사용자 메시지는 buildMessageText가 심어 보낸 [업로드된 파일] 블록(모델용)을
                  // 그대로 다시 보여주지 않고 작은 칩으로만 표시하고, 긴 텍스트는 접어둔다
                  // (2026-07-20 피드백 — Claude.ai 벤치마킹).
                  const { files, remainder } = extractFileBlocks(part.text);
                  return (
                    <div key={i}>
                      {files.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {files.map((f) => (
                            <span
                              key={f.url}
                              className="flex items-center gap-1 rounded-full border border-current/20 bg-current/5 px-2.5 py-0.5 text-sm"
                            >
                              <span aria-hidden>📎</span>
                              {f.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {remainder && <CollapsibleChatMarkdown text={remainder} />}
                    </div>
                  );
                }
                if (part.type === "tool-presentProductInfoPrompt") {
                  if (part.state !== "output-available") {
                    return (
                      <div key={i} className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                        기업/제품 정보 입력 카드 준비 중...
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ProductInfoPromptCard
                        onSkip={() =>
                          sendMessage({
                            text: "제품 정보 입력은 건너뛸게요. 다음 단계로 진행해주세요.",
                          })
                        }
                        onSubmit={(fields: ProductInfo) => {
                          const lines = (Object.keys(PRODUCT_INFO_FIELD_LABELS) as (keyof ProductInfo)[])
                            .filter((key) => (fields[key] ?? "").trim() !== "")
                            .map((key) => `${PRODUCT_INFO_FIELD_LABELS[key]}: ${fields[key]}`)
                            .join("\n");
                          sendMessage({
                            text: `다음 기업/제품 정보를 저장해주세요.\n${lines}`,
                          });
                        }}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-extractProductInfoFromFile") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ProductInfoExtractedCard
                        state={part.state}
                        output={part.output as ProductInfoExtractedOutput | undefined}
                        onApprove={() =>
                          sendMessage({
                            text: "확인했어요, 이 기업 정보로 저장해주세요.",
                          })
                        }
                      />
                    </div>
                  );
                }
                if (part.type === "tool-saveProductInfoTool") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ProductInfoSavedCard
                        state={part.state}
                        output={part.output as ProductInfoSavedOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-validateInput") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ValidateInputCard
                        state={part.state}
                        output={part.output as ValidateInputOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-computeQuantStats") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <QuantStatsCard
                        state={part.state}
                        output={part.output as ComputeQuantStatsOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-presentReportPlan") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ReportPlanCard
                        state={part.state}
                        output={part.output as ReportPlanOutput | undefined}
                        onApprove={() =>
                          sendMessage({
                            text: "이 목차/섹션 구성에 동의합니다. 그래프에 필요한 응답 수치와 비율 계산을 진행해주세요.",
                          })
                        }
                      />
                    </div>
                  );
                }
                if (part.type === "tool-runQualitativeAnalysis") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <QualitativeAnalysisCard
                        state={part.state}
                        output={part.output as RunQualitativeAnalysisOutput | undefined}
                        onGenerateReport={() =>
                          sendMessage({ text: "분석 결과를 바탕으로 보고서를 만들어주세요." })
                        }
                      />
                    </div>
                  );
                }
                if (part.type === "tool-generateResultSummary") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <ResultSummaryCard
                        state={part.state}
                        output={part.output as ResultSummaryOutput | undefined}
                      />
                    </div>
                  );
                }
                if (
                  part.type === "tool-generateRecommendation" ||
                  part.type === "tool-generateFeatureRecommendation"
                ) {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <RecommendationDraftCard
                        state={part.state}
                        output={part.output as RecommendationDraftOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-saveStrategicInputTool") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <SaveStrategicInputCard
                        state={part.state}
                        output={part.output as SaveStrategicInputOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-assembleReportTool") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <AssembleReportCard
                        state={part.state}
                        output={part.output as AssembleReportOutput | undefined}
                      />
                    </div>
                  );
                }
                return null;
                });
              })()}
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 flex w-full justify-center bg-gradient-to-t from-zinc-50 from-60% to-transparent pb-6 pt-10 dark:from-black lg:left-64 lg:w-[calc(100%-16rem)]">
        {composerForm}
      </div>
      </div>
    </div>
  );
}
