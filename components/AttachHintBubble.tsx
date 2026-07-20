"use client";

export function AttachHintBubble({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute left-0 top-full z-10 mt-2 w-48 rounded-xl bg-zinc-900 px-2.5 py-1.5 text-xs leading-snug text-zinc-50 shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      <span className="absolute -top-1 left-3 h-2.5 w-2.5 rotate-45 bg-zinc-900 dark:bg-zinc-100" />
      <button
        type="button"
        onClick={onDismiss}
        aria-label="닫기"
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-[9px] leading-none text-zinc-50 hover:bg-zinc-600 dark:bg-zinc-300 dark:text-zinc-900 dark:hover:bg-zinc-400"
      >
        ×
      </button>
      raw data를 첨부하면 더 정확한 보고서 결과를 얻을 수 있어요
    </div>
  );
}
