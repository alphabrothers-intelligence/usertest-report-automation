"use client";

/**
 * 정성 분석 job의 **진행 드라이버**. `QualitativeStep`이 갖고 있던 폴링 로직을 그대로 옮겼다.
 *
 * **왜 훅으로 뺐나 — 이 루프가 멈추면 분석도 멈춘다.** `run-next`는 서버가 알아서 도는 배치가
 * 아니라 클라이언트가 문항 하나씩 시켜야 진행되는 구조다. 그래서 화면을 떠나면(언마운트) 그
 * 순간 분석이 멈춘다. 새 흐름은 "분석을 기다리지 않고 카드 → 보고서로 넘어간다"이므로,
 * **넘어간 화면에서도 같은 루프가 계속 돌아야 한다** — 그래서 화면이 아니라 훅이다.
 *
 * 안에 든 것은 전부 실측으로 정해진 값이라 건드리지 말 것:
 * - 워커 3개(2026-08-27 확정, `orchestrate.ts` DEFAULT_CONCURRENCY=3과 일치. 4는 불안정했다)
 * - 워커는 `cancelled` 전까지 **절대 죽지 않는다** — fetch 예외를 잡아 쉬었다 재시도한다.
 *   예전엔 순간적인 네트워크 장애로 워커가 하나씩 죽고 나면 서버 job은 진행 가능한데도
 *   아무도 폴링하지 않아 "N/14에서 멈춘 채"로 남았다(2026-08-13 실측 재현).
 * - 워커 루프와 별개로 2초 상태 폴링 — `run-next`가 수십~100초+ 블로킹이라 그 사이 화면이
 *   멈춘 것처럼 보인다(2026-08-12 실측).
 */
import { useEffect, useState } from "react";

export interface JobProgress {
  completed: number;
  failed: number;
  total: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const SUCCESS_STATUSES = ["completed", "completed_with_failures"];
export const TERMINAL_STATUSES = [...SUCCESS_STATUSES, "failed", "cancelled"];

export function useQualitativeJob(jobId: string | null) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [networkNotice, setNetworkNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const baseUrl = `/api/qualitative-jobs/${jobId}`;
    let hadNetworkFailure = false;
    let recoveryNoticeTimeout: ReturnType<typeof setTimeout> | null = null;

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
        try {
          const response = await fetch(`${baseUrl}/run-next`, { method: "POST" });
          const data = await response.json();
          if (hadNetworkFailure) {
            hadNetworkFailure = false;
            setNetworkNotice("네트워크가 불안정하여 연결을 재시도했고, 분석을 재개했습니다.");
            if (recoveryNoticeTimeout) clearTimeout(recoveryNoticeTimeout);
            recoveryNoticeTimeout = setTimeout(() => setNetworkNotice(null), 5_000);
          }
          const status = await updateStatus();
          if (TERMINAL_STATUSES.includes(status)) return;
          if (!data.ok && !data.item) await new Promise((resolve) => setTimeout(resolve, 1_500));
        } catch (err) {
          hadNetworkFailure = true;
          setNetworkNotice("네트워크가 불안정하여 연결을 재시도하고 있습니다...");
          console.error("[qualitative-job] worker 요청 실패, 재시도", err);
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    };

    void Promise.all([worker(), worker(), worker()]).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    void updateStatus().catch((err) => {
      console.error("[qualitative-job] 초기 상태 조회 실패, 폴링에서 재시도됨", err);
    });
    const pollInterval = setInterval(() => {
      void updateStatus().catch(() => {});
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      if (recoveryNoticeTimeout) clearTimeout(recoveryNoticeTimeout);
    };
  }, [jobId]);

  const status = progress?.status ?? (jobId ? "queued" : "none");
  return {
    progress,
    networkNotice,
    error,
    status,
    done: (progress?.completed ?? 0) + (progress?.failed ?? 0),
    total: progress?.total ?? 0,
    isFinished: TERMINAL_STATUSES.includes(status),
    isSuccessful: SUCCESS_STATUSES.includes(status),
  };
}