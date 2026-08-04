"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface JobProgress {
  completed: number;
  failed: number;
  total: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

const SUCCESS_STATUSES = ["completed", "completed_with_failures"];
const TERMINAL_STATUSES = [...SUCCESS_STATUSES, "failed", "cancelled"];

/**
 * 마법사 5단계 — "정성 분석 시작" 버튼 → job 등록(/api/wizard/qualitative) → 3개 워커로
 * run-next 폴링(app/page.tsx의 QualitativeAnalysisCard와 동일한 동시성/폴링 로직을 그대로
 * 옮김) → 끝나면 PDF 조립 없이 바로 /viewer?source=...로 이동한다(웹뷰어는 DB 데이터만으로
 * 렌더링되므로 PDF가 필요 없다, 계획 문서의 탐색 결과 참고).
 */
export function QualitativeStep({ fileUrl }: { fileUrl: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const baseUrl = `/api/qualitative-jobs/${jobId}`;

    const updateStatus = async (): Promise<string> => {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("정성 분석 진행 상태를 불러오지 못했습니다.");
      const data = await response.json();
      if (!cancelled) {
        setProgress({
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
        if (TERMINAL_STATUSES.includes(status)) return;
        if (!data.ok && !data.item) await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    };

    // app/page.tsx의 QualitativeAnalysisCard와 동일하게 3개 동시성(2026-07-27 실측 확정값,
    // lib/pipeline/orchestrate.ts DEFAULT_CONCURRENCY=3과 일치시킴 — 4는 불안정했다).
    void Promise.all([worker(), worker(), worker()]).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    void updateStatus().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [jobId]);

  const openReport = () => router.push(`/viewer?source=${encodeURIComponent(fileUrl)}`);

  async function handleStart() {
    setStarting(true);
    setError(null);
    const res = await fetch("/api/wizard/qualitative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl }),
    });
    const data = await res.json();
    setStarting(false);
    if (!data.ok) {
      setError(data.error ?? "정성 분석을 시작하지 못했습니다.");
      return;
    }
    setJobId(data.jobId);
  }

  if (!jobId) {
    return (
      <div className="w-full max-w-xl">
        <h2 className="text-xl font-bold text-[#202c40]">응답 내용 분석을 시작할까요?</h2>
        <p className="mt-1.5 text-sm text-[#748196]">
          서술형 응답 14개 문항을 분석해 반응·고객 경험·개선 의견을 정리합니다. 보통 7~10분
          걸립니다.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={starting}
          className="mt-4 rounded-md bg-[#356df3] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#2d60da] disabled:bg-[#c8d1de]"
        >
          {starting ? "시작하는 중..." : "응답 내용 분석 시작"}
        </button>
      </div>
    );
  }

  const done = (progress?.completed ?? 0) + (progress?.failed ?? 0);
  const total = progress?.total ?? 14;
  const status = progress?.status ?? "queued";
  const isFinished = TERMINAL_STATUSES.includes(status);
  const isSuccessful = SUCCESS_STATUSES.includes(status);
  const percent = status === "queued" ? 0 : Math.round((done / Math.max(total, 1)) * 100);
  const statusLabel: Record<string, string> = {
    queued: "분석 시작 준비 중",
    running: "응답 내용 분석 중",
    completed: "분석 완료",
    completed_with_failures: "분석 완료(일부 문항 제외)",
    failed: "분석을 완료하지 못했습니다",
    cancelled: "분석이 중단되었습니다",
  };

  return (
    <div className="w-full max-w-xl">
      <div
        aria-live="polite"
        className={`rounded-xl border px-5 py-4 text-base shadow-sm ${
          isFinished
            ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
            : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
        }`}
      >
        <p className="font-semibold">
          {statusLabel[status] ?? "응답 내용 분석 중"} · {done}/{total} 문항 완료
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/60">
          <div
            className={`h-full transition-all ${status === "queued" ? "bg-amber-500" : "bg-sky-600"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {progress && progress.failed > 0 && (
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            일부 문항({progress.failed}개)은 분석에 실패했습니다. 나머지 결과로 계속 진행합니다.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
      {isSuccessful && (
        <button
          type="button"
          onClick={openReport}
          className="mt-4 rounded-md bg-[#356df3] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#2d60da]"
        >
          분석 결과로 보고서 열기
        </button>
      )}
    </div>
  );
}
