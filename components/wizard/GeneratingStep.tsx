"use client";

/**
 * 마법사 3단계 — **보고서를 만드는 중.**
 *
 * ## 왜 기다리게 하는가 (앞선 설계를 되돌린 것)
 *
 * 2026-08-31에는 "기다리게 하지 말고 먼저 보여주자"고 정해서, 의견 분석이 끝나기 전에도
 * 보고서 웹뷰로 넘어가게 했다. **실사용에서 실패했다**(2026-09-01 담당자 피드백) — 넘어간
 * 화면이 완성된 보고서 모양이라 **다 됐다고 믿고 열었는데 의견이 통째로 비어 있어** 당황하게
 * 만들었다. 배너 한 줄로는 "이건 아직 반쪽"이라는 신호가 되지 않는다.
 *
 * 그래서 **한 번에 만들어 완성본만 보여준다.** 대신 정성 분석 자체는 업로드 직후에 이미
 * 시작해뒀으므로(`app/new/page.tsx`), 카드를 훑는 동안 몇 문항은 이미 끝나 있다 — 여기서
 * 기다리는 시간은 그만큼 짧다.
 *
 * ## 이 화면이 job 의 진행 드라이버다
 *
 * `run-next`는 서버가 알아서 도는 배치가 아니라 클라이언트가 문항 하나씩 시켜야 진행된다.
 * 그래서 이 화면을 벗어나면 분석이 멈춘다 — 화면에 그 사실을 적어둔다. (근본 해결은 서버
 * 실행으로 옮기는 것이고 별도 작업이다.)
 */
import { useEffect, useState } from "react";
import { useQualitativeJob } from "@/components/wizard/useQualitativeJob";

/** 앵커 출력 적용 후 실측(2026-09-02, 14문항·워커 3): 문항당 약 102초, 전체 약 630초. */
const SECONDS_PER_ITEM = 102 / 3;

function label(seconds: number) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
}

export function GeneratingStep({
  qualitativeJobId,
  qualitativeError,
  onDone,
  onRetryFailed,
  retrying,
}: {
  qualitativeJobId: string | null;
  qualitativeError: string | null;
  onDone: () => void;
  onRetryFailed: () => void;
  retrying: boolean;
}) {
  const job = useQualitativeJob(qualitativeJobId);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // 정성 분석이 끝나면(또는 애초에 시작조차 못 했으면) 완성본으로 넘긴다.
  const ready = !qualitativeJobId || job.isSuccessful;
  useEffect(() => {
    if (ready) onDone();
  }, [ready, onDone]);

  const total = job.total || 14;
  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const remaining = Math.max(0, total - job.done);
  const estimate = Math.round(remaining * SECONDS_PER_ITEM);

  // 빠진 문항이 있으면 **완성본으로 넘기지 않는다** — 반쪽 보고서를 완성본 얼굴로 내보내지
  // 않겠다는 것이 이 화면을 되돌린 이유 자체다.
  if (job.isIncomplete) {
    return (
      <div className="w-full max-w-xl">
        <h2 className="text-xl font-bold text-[#202c40]">의견 분석이 끝나지 않았습니다</h2>
        <p className="mt-2 text-sm text-[#748196]">
          {total}개 문항 중 <strong className="text-[#b45309]">{job.failed}개</strong>가 분석되지 못했습니다.
          이대로 보고서를 만들면 그 문항의 의견이 비어 있습니다.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onRetryFailed}
            disabled={retrying}
            className="rounded-md bg-[#b45309] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#92400e] disabled:opacity-60"
          >
            {retrying ? "다시 시작하는 중…" : `빠진 ${job.failed}개 문항 이어서 분석`}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-[#dce3ec] px-5 py-2.5 text-sm font-semibold text-[#667085] hover:bg-[#f8fafc]"
          >
            비어 있는 채로 열기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <h2 className="flex items-center gap-2 text-xl font-bold text-[#202c40]">
        <span className="size-2.5 animate-pulse rounded-full bg-[#356df3]" />
        보고서를 만들고 있습니다
      </h2>
      <p className="mt-2 text-sm text-[#748196]">
        정량 결과는 이미 준비됐고, 지금은 <strong className="text-[#52627a]">서술형 응답을 분석</strong>하는 중입니다.
        끝나면 두 결과가 모두 담긴 보고서가 열립니다.
      </p>

      <div className="mt-5 rounded-xl border border-[#dde5ef] bg-white p-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-bold text-[#202c40]">{job.done} / {total} 문항</span>
          <span className="text-[#8a97a9]">경과 {label(elapsed)}</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#eef2f7]">
          <div className="h-full bg-[#356df3] transition-all duration-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-3 text-[13px] text-[#748196]">
          {remaining > 0
            ? `남은 ${remaining}개 문항 · 약 ${label(estimate)} 더 걸립니다`
            : "마무리하는 중입니다"}
        </p>
        {job.networkNotice && <p className="mt-2 text-[13px] text-amber-700">{job.networkNotice}</p>}
        {qualitativeError && (
          <p className="mt-2 text-[13px] text-[#b54141]">
            의견 분석을 시작하지 못했습니다({qualitativeError}). 정량 결과만으로 보고서를 엽니다.
          </p>
        )}
      </div>

      {/* 이 화면을 벗어나면 분석이 멈춘다 — 숨기지 않고 적는다. */}
      <p className="mt-3 text-[13px] text-[#a1abba]">
        이 화면을 열어둔 채로 기다려 주세요. 창을 닫거나 다른 페이지로 이동하면 분석이 멈춥니다.
      </p>
    </div>
  );
}
