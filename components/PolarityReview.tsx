"use client";

import { useState } from "react";

export interface PolarityReviewItem {
  id: string;
  question_label: string;
  respondent_id: number;
  clause: string;
  raw_clause?: string | null;
  polarity: "positive" | "negative" | "neutral";
  rationale: string;
  confidence: "high" | "medium" | "low";
}

const POLARITY_LABEL: Record<PolarityReviewItem["polarity"], string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

async function submitDecision(
  clauseId: string,
  decision: "approve" | "positive" | "negative" | "neutral",
) {
  const res = await fetch("/api/checkpoint/polarity", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clauseId, decision }),
  });
  if (!res.ok) throw new Error("검수 반영에 실패했습니다.");
}

function ReviewRow({ item, onDone }: { item: PolarityReviewItem; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(decision: "approve" | "positive" | "negative" | "neutral") {
    setBusy(true);
    setError(null);
    try {
      await submitDecision(item.id, decision);
      onDone(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 p-4 text-base dark:border-zinc-800">
      <p className="text-sm text-zinc-500">{item.question_label} · 응답자 #{item.respondent_id}</p>
      <p className="mt-1.5">&ldquo;{item.raw_clause ?? item.clause}&rdquo;</p>
      <p className="mt-1 text-sm text-zinc-500">
        현재 판정: <span className="font-medium">{POLARITY_LABEL[item.polarity]}</span> — {item.rationale}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => handle("approve")}
          className="rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-zinc-50 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          승인
        </button>
        {(["positive", "negative", "neutral"] as const)
          .filter((p) => p !== item.polarity)
          .map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy}
              onClick={() => handle(p)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              {POLARITY_LABEL[p]}로 변경
            </button>
          ))}
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function PolarityReview({ items }: { items: PolarityReviewItem[] }) {
  const [remaining, setRemaining] = useState(items);

  if (remaining.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        체크포인트 A: 검수할 항목이 없습니다.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        체크포인트 A — 극성 판정 검수 ({remaining.length}건)
      </p>
      <div className="mt-3 space-y-3">
        {remaining.map((item) => (
          <ReviewRow
            key={item.id}
            item={item}
            onDone={(id) => setRemaining((prev) => prev.filter((i) => i.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}
