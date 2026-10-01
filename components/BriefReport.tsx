"use client";

/**
 * **축소판(요약본) 화면.** 전체 보고서와 **완전히 분리된 경로**다(2026-09-09 담당자 지시).
 *
 * 기존 보고서 웹뷰(`ReportWebDocument`)는 편집·검토 패널·체크포인트가 얽혀 있어 여기서 쓰지
 * 않는다. 대신 잎 컴포넌트 두 개(`SectionBanner`·`BlockView`)만 빌려 A4 쪽으로 나눠 그린다 —
 * 그 둘은 고치지 않으므로 기존 화면에 영향이 없다.
 *
 * **쪽 나눔은 전체 보고서와 같은 규칙을 쓴다**(`lib/report/paginate.ts`, 2026-09-10 담당자
 * 지시: "두 버전 모두 추가되어야 한다"). 재는 방식도 웹뷰와 같다 — 블록 사이 여백은 margin
 * collapsing으로 `getBoundingClientRect`에 안 잡히므로 실제 `marginBottom`을 읽어 더한다.
 *
 * 읽기 전용이다. 편집·저장·승인 버튼을 두지 않는다 — 요약본은 "얼마나 줄었는지 보고 인쇄하는"
 * 화면이고, 고치는 일은 전체 보고서 쪽에서 한다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SectionBanner } from "@/components/report-web-document/ReportDocumentChrome";
import { BlockView } from "@/components/report-web-document/ReportBlockView";
import { toBriefSections, briefStats } from "@/lib/report/brief";
import { paginateBlocks, SECTION_BANNER_RESERVE_PX } from "@/lib/report/paginate";
import type { ReportSectionContent } from "@/lib/report/sections";

export function BriefReport({ dataset, source }: { dataset?: string; source?: string }) {
  const [full, setFull] = useState<ReportSectionContent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageGroups, setPageGroups] = useState<Record<string, string[][]>>({});
  const documentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 기존 읽기 전용 API를 그대로 쓴다 — 축소판 때문에 새 계산·새 저장을 만들지 않는다.
    const url = source
      ? `/api/report-workspace?source=${encodeURIComponent(source)}`
      : `/api/report-workspace/demo?dataset=${dataset ?? "rivalabs"}`;
    fetch(url)
      .then((response) => response.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? "보고서를 불러오지 못했습니다.");
        setFull(json.workspace.sections);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [dataset, source]);

  const brief = useMemo(() => (full ? toBriefSections(full) : []), [full]);

  useLayoutEffect(() => {
    const root = documentRef.current;
    if (!root || brief.length === 0) return;
    const measure = () => {
      const pxPerMm = 96 / 25.4;
      // 297mm에서 쪽 안쪽 여백을 뺀 값. 아래 <section>의 pt/pb 클래스와 반드시 같이 고칠 것.
      const capacity = (297 - 18 - 26) * pxPerMm;
      const next: Record<string, string[][]> = {};
      for (const section of brief) {
        const metrics = section.blocks.map((block) => {
          const element = root.querySelector<HTMLElement>(`[data-brief-block-id="${CSS.escape(block.id)}"]`);
          const inner = element?.firstElementChild;
          const gap = inner ? parseFloat(getComputedStyle(inner).marginBottom) || 0 : 0;
          return {
            id: block.id,
            height: element ? Math.ceil(element.getBoundingClientRect().height + Math.max(gap, 8)) : 0,
            isHeading: block.kind === "heading",
          };
        });
        const pages = paginateBlocks(metrics, capacity, SECTION_BANNER_RESERVE_PX);
        next[section.numeral] = pages.length > 0 ? pages : [section.blocks.map((block) => block.id)];
      }
      setPageGroups((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    measure();
    // 차트·이미지는 첫 레이아웃 뒤에 자리를 잡아 높이가 나중에 커진다 — 바뀌면 다시 묶는다.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [brief]);

  if (error) return <p className="p-8 text-sm text-[#b91c1c]">{error}</p>;
  if (!full) return <p className="p-8 text-sm text-[#71717a]">축소판을 만드는 중…</p>;

  const stats = briefStats(full, brief);
  const pct = (now: number, before: number) => (before === 0 ? 0 : Math.round((now / before) * 100));
  const pages = brief.flatMap((section) => {
    const groups = pageGroups[section.numeral] ?? [section.blocks.map((block) => block.id)];
    return groups.map((blockIds, pageIndex) => ({ section, blockIds, pageIndex }));
  });

  return (
    <div data-brief-root className="min-h-screen bg-[#f4f7fb] py-8">
      {/* 인쇄물에는 이 머리말을 싣지 않는다. 화면에서만 "얼마나 줄었는지" 보여준다. */}
      <div className="mx-auto mb-6 max-w-[210mm] rounded-xl border border-[#dbe3ef] bg-white px-6 py-5 print:hidden">
        <h1 className="text-lg font-bold text-[#18181b]">축소판 (요약본)</h1>
        <p className="mt-1 text-[13px] text-[#71717a]">
          전체 보고서에서 <strong className="font-semibold text-[#52525b]">문항별 상세(점수 박스·감정 분석·인용문)</strong>를
          빼고 장 단위 도표·해석과 마지막 장(종합 결과 및 제언)만 남긴 판입니다. 전체 보고서와
          별개 화면이며 여기서는 편집하지 않습니다.
        </p>
        <dl className="mt-4 grid grid-cols-4 gap-3 text-center">
          {[
            { label: "쪽", now: pages.length, before: null as number | null },
            { label: "장", now: stats.brief.sections, before: stats.full.sections },
            { label: "블록", now: stats.brief.blocks, before: stats.full.blocks },
            { label: "글자", now: stats.brief.chars, before: stats.full.chars },
          ].map((row) => (
            <div key={row.label} className="rounded-lg bg-[#f8fafc] px-3 py-3">
              <dt className="text-[12px] text-[#71717a]">{row.label}</dt>
              <dd className="mt-0.5 text-[13px] font-bold text-[#18181b]">
                {row.now.toLocaleString()}
                {row.before !== null && (
                  <span className="ml-1 text-[12px] font-medium text-[#a1a1aa]">/ {row.before.toLocaleString()}</span>
                )}
              </dd>
              {row.before !== null && (
                <dd className="text-[12px] font-semibold text-[#356df3]">{pct(row.now, row.before)}%</dd>
              )}
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] text-[#a1a1aa]">브라우저 인쇄(⌘P)로 PDF 저장하면 이 머리말은 빠집니다.</p>
      </div>

      {/* 인쇄 규칙은 **이 화면 안에서만** 쓴다. 기존 인쇄 규칙은 `body:has([data-workspace-status])`
          로 전체 보고서 웹뷰에만 걸려 있어 여기엔 적용되지 않는다 — globals.css를 건드리지 않고
          같은 효과(쪽마다 나눔 · 블록 중간에서 안 쪼개짐)를 내기 위해 여기에 둔다. */}
      <style>{`
        @media print {
          /* 바깥 여백을 0으로 만들지 않으면 쪽마다 32px씩 밀려 한 장이 두 장으로 흘러넘친다
             (2026-09-10 실측: 12쪽짜리가 18쪽으로 인쇄됨). */
          html, body { background: #fff !important; }
          [data-brief-root] { padding: 0 !important; margin: 0 !important; background: #fff !important; }
          [data-brief-pages] { gap: 0 !important; }
          [data-brief-page] {
            break-after: page; page-break-after: always;
            margin: 0 !important; border: 0 !important; box-shadow: none !important;
          }
          [data-brief-page]:last-child { break-after: auto; page-break-after: auto; }
          [data-brief-block-id],
          [data-brief-block-id] table tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div ref={documentRef} data-brief-pages className="flex flex-col items-center gap-6 print:gap-0">
        {pages.map(({ section, blockIds, pageIndex }) => (
          <section
            key={`${section.numeral}-${pageIndex}`}
            data-brief-page={section.numeral}
            className="relative box-border h-auto min-h-[297mm] w-[210mm] overflow-visible border border-[#dfe3e9] bg-white px-[18mm] pb-[26mm] pt-[18mm] shadow-[0_12px_34px_rgba(28,39,55,.11)] print:border-0 print:shadow-none"
          >
            {pageIndex === 0 ? <SectionBanner numeral={section.numeral} title={section.title} /> : null}
            {section.blocks
              .filter((block) => blockIds.includes(block.id))
              .map((block) => (
                <div key={block.id} data-brief-block-id={block.id}>
                  <BlockView block={block} onChange={() => {}} compact />
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
