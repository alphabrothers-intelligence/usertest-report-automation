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
  failed,
  networkNotice,
  applying,
  applied,
  onApply,
}: {
  status: string;
  done: number;
  total: number;
  isFinished: boolean;
  isSuccessful: boolean;
  failed: number;
  networkNotice: string | null;
  applying: boolean;
  applied: boolean;
  onApply: () => void;
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
      {failed > 0 && <span className="text-amber-800">일부 문항({failed}개)은 분석하지 못했습니다.</span>}
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