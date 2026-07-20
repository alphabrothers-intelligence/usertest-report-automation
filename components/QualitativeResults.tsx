// PRD 3.2절(v1.4 신규)·7.2절 — 문항이 많은 정성 분석 결과를 통짜로 나열하지 않고, 문항 단위로
// 접기/펼치기 가능한 카드로 제공해 무엇을 검수해야 하는지 한눈에 스캔할 수 있게 한다.
import type { QuestionResult } from "@/lib/pipeline/orchestrate";

const polarityOrder = ["positive", "negative", "neutral"] as const;
const polarityLabel = { positive: "긍정", negative: "부정", neutral: "중립" };

function CategoryList({ categories }: { categories: { label: string; clause_count: number; insight: string }[] }) {
  return (
    <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
      {categories.map((c) => (
        <li key={c.label}>
          [{c.label}] ({c.clause_count}건) → {c.insight}
        </li>
      ))}
    </ul>
  );
}

function QuestionAccordionItem({ q }: { q: QuestionResult }) {
  if (q.kind === "improvement") {
    const totalCount = q.stage2.categories.reduce((sum, c) => sum + c.clause_count, 0);
    return (
      <details className="group border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{q.label}</span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            카테고리 {q.stage2.categories.length}개 · {totalCount}건
          </span>
        </summary>
        <CategoryList categories={q.stage2.categories} />
      </details>
    );
  }

  const lowConfidenceCount = q.clauses.filter((c) => c.confidence === "low").length;
  const countsByPolarity = polarityOrder.map((polarity) => ({
    polarity,
    count: q.stage2ByPolarity[polarity]?.categories.length ?? 0,
  }));

  return (
    <details className="group border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{q.label}</span>
        <span className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          {countsByPolarity
            .filter((p) => p.count > 0)
            .map((p) => (
              <span key={p.polarity}>
                {polarityLabel[p.polarity]} {p.count}
              </span>
            ))}
          {lowConfidenceCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              검수 필요 {lowConfidenceCount}
            </span>
          )}
        </span>
      </summary>
      {polarityOrder.map((polarity) => {
        const stage2 = q.stage2ByPolarity[polarity];
        if (!stage2) return null;
        return (
          <div key={polarity} className="mt-2">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{polarityLabel[polarity]}</p>
            <CategoryList categories={stage2.categories} />
          </div>
        );
      })}
    </details>
  );
}

export function QualitativeResultsAccordion({ questions }: { questions: QuestionResult[] }) {
  return (
    <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
      {questions.map((q) => (
        <QuestionAccordionItem key={q.id} q={q} />
      ))}
    </div>
  );
}
