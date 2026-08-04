"use client";

import { useEffect, useState } from "react";
import { BlockView } from "@/components/ReportWebDocument";
import type { ReportSectionContent } from "@/lib/report/sections";
import type { QuantStats } from "@/lib/quant/compute";
import { flagQuantStatsForReview, type ReviewFlag } from "@/lib/quant/reviewFlags";

/**
 * 마법사 4단계 — 정량 통계를 계산하고, 실제 보고서와 똑같은 차트(Editable*Chart, 웹뷰어와
 * 같은 컴포넌트)로 미리 보여준다. 아직 정성 분석 전이라 Ⅲ/Ⅴ/Ⅷ/Ⅸ 섹션의 정성 블록은
 * "정성 분석 대기"로 표시된다(정상 — buildReportWorkspaceSeed의 기존 동작 그대로).
 * 요주의 지표(lib/quant/reviewFlags.ts)는 개별 차트에 배지를 붙이는 대신 상단 패널에
 * 모아 보여준다 — 위치 문자열을 차트 id에 일일이 매칭시키는 건 깨지기 쉬워서(단순함 우선).
 */
export function QuantReviewStep({
  fileUrl,
  fileName,
  onNext,
}: {
  fileUrl: string;
  fileName: string | null;
  onNext: (stats: QuantStats) => void;
}) {
  const [sections, setSections] = useState<ReportSectionContent[] | null>(null);
  const [flags, setFlags] = useState<ReviewFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<QuantStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const computeRes = await fetch("/api/wizard/quant-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl, fileName }),
      });
      const computed = await computeRes.json();
      if (!computed.ok) {
        if (!cancelled) setError(computed.error ?? "정량 통계 계산에 실패했습니다.");
        return;
      }
      const workspaceRes = await fetch(`/api/report-workspace?source=${encodeURIComponent(fileUrl)}`, {
        cache: "no-store",
      });
      const workspace = await workspaceRes.json();
      if (cancelled) return;
      if (!workspace.ok) {
        setError(workspace.error ?? "정량 결과를 불러오지 못했습니다.");
        return;
      }
      setSections(workspace.workspace.sections);
      setStats(computed.stats);
      setFlags(flagQuantStatsForReview(computed.stats as QuantStats));
    }
    void run();
    return () => { cancelled = true; };
    // fileUrl 하나당 이 단계에 한 번만 진입한다 — 재계산은 명시적 새로고침으로만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="w-full max-w-2xl rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!sections) {
    return (
      <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        그래프용 응답 수치를 계산하고 있어요...
      </div>
    );
  }

  const warnings = flags.filter((f) => f.severity === "warning");
  const infos = flags.filter((f) => f.severity === "info");

  return (
    <div className="w-full max-w-3xl">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">정량 통계를 검토해주세요</h2>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        아래는 실제 보고서에 그대로 들어갈 그래프입니다. 정성 분석은 아직 시작 전이라 서술형
        분석 영역은 &ldquo;대기&rdquo; 상태로 보여요.
      </p>

      {flags.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            다시 봐야 할 지표 {flags.length}건
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-900 dark:text-amber-200">
            {[...warnings, ...infos].map((f, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden>{f.severity === "warning" ? "⚠" : "ℹ"}</span>
                <span>
                  <span className="font-medium">{f.location}</span> — {f.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-8 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        {sections
          .filter((s) => ["II", "IV", "VI", "VII"].includes(s.numeral))
          .map((section) => (
            <div key={section.numeral}>
              <h3 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {section.numeral}. {section.title}
              </h3>
              {section.blocks.map((block) => (
                <BlockView key={block.id} block={block} onChange={() => {}} />
              ))}
            </div>
          ))}
      </div>

      <button
        type="button"
        onClick={() => stats && onNext(stats)}
        className="mt-6 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        확인했어요, 응답 내용 분석 시작하기
      </button>
    </div>
  );
}
