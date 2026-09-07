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
 * - 워커 수는 기본 3(2026-08-27 확정). "4는 불안정했다"는 당시 기록이 있으나 **그 실험은
 *   크레딧 소진 시기와 겹쳐 결론이 오염됐다**(memory: anthropic-credit-constraint). 그래서
 *   `NEXT_PUBLIC_QUALITATIVE_WORKERS`로 빼서 다시 잴 수 있게 했다 — 올려서 재보고 판단할 것.
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

/**
 * **`completed_with_failures`를 성공으로 치지 않는다**(2026-09-01).
 *
 * 예전에는 여기에 들어 있어서, 문항 2개가 실패해도 초록 배너로 "끝났습니다"가 뜨고 불완전한
 * 보고서가 완성본 얼굴로 나갔다. 미완료 문항이 하나라도 있으면 끝난 게 아니다 — 화면은
 * 그 사실을 드러내고 이어서 분석할 길을 줘야 한다.
 */
export const SUCCESS_STATUSES = ["completed"];
/** 더 이상 워커가 집을 게 없는 상태. 성공과는 다르다. */
export const TERMINAL_STATUSES = [...SUCCESS_STATUSES, "completed_with_failures", "failed", "cancelled"];
/** 끝났지만 빠진 문항이 있는 상태 — 보고서를 내보내면 안 된다. */
export const INCOMPLETE_STATUSES = ["completed_with_failures", "failed"];

/** 워커 수. 실측용으로 환경변수로 뺐다 — 3이 기본이고 올리면 벽시계가 준다(레이트리밋 한도 내에서).
 *  문항 클레임은 `for update skip locked` 트랜잭션이라 몇 개를 띄워도 중복 처리되지 않는다. */
const WORKER_COUNT = Math.max(1, Number(process.env.NEXT_PUBLIC_QUALITATIVE_WORKERS ?? 3));

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

    void Promise.all(Array.from({ length: WORKER_COUNT }, () => worker())).catch((err) => {
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
    /** 끝났는데 빠진 문항이 있다. 보고서를 내보내면 안 되고, 이어서 분석해야 한다. */
    isIncomplete: INCOMPLETE_STATUSES.includes(status),
    failed: progress?.failed ?? 0,
  };
}