"use client";

import { useState } from "react";

export interface HedgeViolation {
  type: "forbidden_phrase" | "no_hedge_ending";
  detail: string;
}

export interface RecommendationReviewItem {
  id: string;
  section: string;
  draft: string;
  hedgeViolations?: HedgeViolation[];
}

async function submitRecommendation(recommendationId: string, finalText: string) {
  const res = await fetch("/api/checkpoint/recommendation", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recommendationId, finalText }),
  });
  if (!res.ok) throw new Error("검수 반영에 실패했습니다.");
}

function RecommendationRow({
  item,
  onDone,
}: {
  item: RecommendationReviewItem;
  onDone: (id: string) => void;
}) {
  const [text, setText] = useState(item.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await submitRecommendation(item.id, text);
      onDone(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      setBusy(false);
    }
  }

  const violations = item.hedgeViolations ?? [];

  return (
    <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{item.section}</p>
      {violations.length > 0 && (
        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {violations.map((v) => (
            <p key={v.detail}>⚠ {v.detail}</p>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        rows={3}
        className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || text.trim() === ""}
          onClick={handleApprove}
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-50 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          승인
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export function RecommendationReview({ items }: { items: RecommendationReviewItem[] }) {
  const [remaining, setRemaining] = useState(items);

  if (remaining.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        체크포인트 B(제언): 검수할 항목이 없습니다.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        체크포인트 B — 제언 검수 ({remaining.length}건)
      </p>
      <div className="mt-2 space-y-2">
        {remaining.map((item) => (
          <RecommendationRow
            key={item.id}
            item={item}
            onDone={(id) => setRemaining((prev) => prev.filter((i) => i.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}
