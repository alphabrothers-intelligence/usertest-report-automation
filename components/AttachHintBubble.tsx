"use client";

export function AttachHintBubble({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute -top-16 left-0 z-10 w-52 rounded-2xl bg-zinc-900 px-3 py-2 text-xs leading-snug text-zinc-50 shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="닫기"
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] leading-none text-zinc-50 hover:bg-zinc-600 dark:bg-zinc-300 dark:text-zinc-900 dark:hover:bg-zinc-400"
      >
        ×
      </button>
      raw data를 첨부하면 더 정확한 보고서 결과를 얻을 수 있어요
      <span className="absolute -bottom-1.5 left-4 h-3 w-3 rotate-45 bg-zinc-900 dark:bg-zinc-100" />
    </div>
  );
}
