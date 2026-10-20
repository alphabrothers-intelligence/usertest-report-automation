"use client";

/** 목록 일괄 삭제 막대 — 전체 선택(한 번 더 누르면 해제) + 고른 항목 삭제. 보고서·설문 목록이 같이 쓴다. */
export function SelectionBar({ total, count, deleting, onAll, onDelete }: {
  total: number; count: number; deleting: boolean; onAll: () => void; onDelete: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-2 text-[13px]">
      <button type="button" onClick={onAll} className="rounded-lg border border-[#dfe4ec] bg-white px-3 py-1.5 font-semibold text-[#4a566b] hover:bg-[#f6f8fb]">
        {count === total ? "선택 해제" : "전체 선택"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={count === 0 || deleting}
        className="rounded-lg bg-[#d83b3b] px-3 py-1.5 font-semibold text-white hover:bg-[#bf2f2f] disabled:cursor-not-allowed disabled:bg-[#f0c9c9]"
      >
        {deleting ? "삭제 중…" : `선택 삭제${count ? ` (${count})` : ""}`}
      </button>
    </div>
  );
}
