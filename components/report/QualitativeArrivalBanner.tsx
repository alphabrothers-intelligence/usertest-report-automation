"use client";

/**
 * 보고서를 열어놓은 채로 뒤에서 돌고 있는 **의견(정성) 분석**의 상태 줄.
 *
 * 새 흐름은 정성 분석을 기다리지 않고 보고서를 연다(2026-08-31 담당자 확정). 그래서 이 화면이
 * 도는 동안 분석이 끝나는데, **끝났다고 자동으로 갈아끼우지 않는다** — 그 사이 담당자가 고친
 * 내용을 말없이 덮어쓸 수 있기 때문이다. 도착 사실만 알리고 언제 합칠지는 사람이 정한다.
 */
export function QualitativeArrivalBanner({
  status,
  done,
  total,
  isFinished,
  isSuccessful,
  isIncomplete,
  failed,
  networkNotice,
  applying,
  applied,
  retrying,
  onApply,
  onRetryFailed,
}: {
  status: string;
  done: number;
  total: number;
  isFinished: boolean;
  isSuccessful: boolean;
  /** 끝났는데 빠진 문항이 있다 — 완료가 아니다. */
  isIncomplete: boolean;
  failed: number;
  networkNotice: string | null;
  applying: boolean;
  applied: boolean;
  retrying: boolean;
  onApply: () => void;
  onRetryFailed: () => void;
}) {
  if (applied) return null;

  if (!isFinished) {
    return (
      <div
        aria-live="polite"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950"
      >
        <span className="size-2 animate-pulse rounded-full bg-sky-600" />
        <span className="font-semibold">
          의견 분석이 뒤에서 진행 중입니다{total > 0 ? ` · ${done}/${total} 문항` : ""}
        </span>
        <span className="text-sky-900/70">
          지금 보이는 정량 결과는 그대로 편집하셔도 됩니다. 끝나면 여기에 알려드립니다.
        </span>
        {/* 이 화면을 닫으면 분석이 멈춘다(run-next 는 클라이언트가 시켜야 진행된다) —
            사용자가 모르면 "왜 안 끝나지"가 되므로 사실대로 적는다. */}
        <span className="w-full text-xs text-sky-900/60">
          이 탭을 닫으면 분석이 멈춥니다. 다른 일을 하셔도 되지만 탭은 열어두세요.
        </span>
        {networkNotice && <span className="w-full text-xs text-amber-800">{networkNotice}</span>}
      </div>
    );
  }

  // **빠진 문항이 있으면 절대 "끝났다"고 하지 않는다.**
  // 예전에는 이 경우도 초록 배너로 "의견 분석이 끝났습니다"가 떠서, 문항 2개가 통째로 빠진
  // 보고서가 완성본 얼굴로 나갔다(2026-09-01 실사용 사고). 지금은 빠졌다는 사실과 이어서
  // 할 방법을 같이 보여준다 — 이대로 내보내는 선택지는 주지 않는다.
  if (isIncomplete) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <span className="font-bold">의견 분석이 아직 끝나지 않았습니다.</span>
        <span>
          {total > 0 ? `${total}개 문항 중 ` : ""}
          <strong>{failed}개</strong>가 분석되지 못했습니다. 이 상태로는 보고서에 그 문항의 의견이 비어 있습니다.
        </span>
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={retrying}
          className="ml-auto rounded-md bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:bg-amber-700/50"
        >
          {retrying ? "다시 시작하는 중…" : `빠진 ${failed}개 문항 이어서 분석`}
        </button>
      </div>
    );
  }

  if (!isSuccessful) {
    return (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
        의견 분석을 완료하지 못했습니다({status}). 정량 결과만으로 보고서를 계속 편집할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-950">
      <span className="font-semibold">의견 분석이 끝났습니다.</span>
      <span className="text-emerald-900/75">
        아직 비어 있는 의견 부분만 채웁니다. 지금까지 고치신 내용은 그대로 둡니다.
      </span>
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        className="ml-auto rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-emerald-700/50"
      >
        {applying ? "반영하는 중…" : "보고서에 반영하기"}
      </button>
    </div>
  );
}