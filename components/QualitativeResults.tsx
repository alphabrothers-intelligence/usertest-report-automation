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
    // 2단 구조(대분류→소분류→인용): 개선 아이디어는 원본처럼 인사이트 없이 인용만 담는다.
    const subCount = q.stage2.major_categories.reduce((sum, m) => sum + m.subcategories.length, 0);
    const totalCount = q.stage2.major_categories.reduce(
      (sum, m) => sum + m.subcategories.reduce((s, sub) => s + sub.clause_count, 0),
      0,
    );
    return (
      <details className="group border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{q.label}</span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            대분류 {q.stage2.major_categories.length}개 · 소분류 {subCount}개 · {totalCount}건
          </span>
        </summary>
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed">
          {q.stage2.major_categories.map((major) => (
            <div key={major.label}>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">[{major.label}]</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {major.subcategories.map((sub) => (
                  <li key={sub.label}>
                    &lt;{sub.label}&gt; ({sub.clause_count}건)
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
