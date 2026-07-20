"use client";

import { useState } from "react";

export interface InsightReviewItem {
  id: string;
  question_label: string;
  polarity: "positive" | "negative" | "neutral" | null;
  label: string;
  clause_count: number;
  quotes: string[];
  insight_draft: string;
}

async function submitInsight(categoryId: string, finalText: string) {
  const res = await fetch("/api/checkpoint/insight", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryId, finalText }),
  });
  if (!res.ok) throw new Error("검수 반영에 실패했습니다.");
}

function InsightRow({ item, onDone }: { item: InsightReviewItem; onDone: (id: string) => void }) {
  const [text, setText] = useState(item.insight_draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await submitInsight(item.id, text);
      onDone(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 p-4 text-base dark:border-zinc-800">
      <p className="text-sm text-zinc-500">
        {item.question_label} · [{item.label}] ({item.clause_count}건)
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-zinc-500">
        {item.quotes.slice(0, 2).map((q) => (
          <li key={q}>&ldquo;{q}&rdquo;</li>
        ))}
      </ul>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        rows={2}
        className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-base outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || text.trim() === ""}
          onClick={handleApprove}
          className="rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-zinc-50 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          승인
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export function InsightEditor({ items }: { items: InsightReviewItem[] }) {
  const [remaining, setRemaining] = useState(items);

  if (remaining.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        체크포인트 B: 검수할 항목이 없습니다.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        체크포인트 B — 인사이트 검수 ({remaining.length}건)
      </p>
      <div className="mt-3 space-y-3">
        {remaining.map((item) => (
          <InsightRow
            key={item.id}
            item={item}
            onDone={(id) => setRemaining((prev) => prev.filter((i) => i.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}
