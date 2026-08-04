"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface RecentReportItem {
  id: string;
  fileName: string | null;
  fileUrl: string;
  updatedAt: string;
  companyName: string | null;
  reportName: string | null;
  workspaceDraftSavedAt: string | null;
}

/**
 * 좌측 "저장된 보고서" 목록 — 웹뷰어에서 편집·저장한 보고서를 나중에 다시 찾아 이어서 열 수
 * 있게 한다. 클릭하면 report-workspace가 저장된 정량/정성 결과를 그대로 읽는
 * /viewer?source=<raw data URL>로 이동한다(재분석 없음). app/page.tsx(구 채팅)에 있던 것을
 * 마법사(app/new)와 공유하기 위해 별도 컴포넌트로 뺐다.
 */
export function RecentReportsSidebar() {
  const [reports, setReports] = useState<RecentReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { ok: boolean; reports?: RecentReportItem[] }) => {
        if (!cancelled) setReports(data.reports ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("보고서 목록을 불러오지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="hidden w-64 shrink-0 border-r border-[#e5e0d7] bg-[#faf9f6] px-3 py-7 lg:block">
      {/* 목록이 길어지면 한눈에 보기 힘들다는 피드백으로 접기/펼치기 가능하게 함(2026-08-04) —
          네이티브 <details>라 별도 상태 없이 브라우저가 열림/닫힘을 관리한다. 기본은 열림. */}
      <details open className="group">
        <summary className="mb-3 flex cursor-pointer list-none items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-[#9a9186]">
          저장된 보고서
          <span className="text-[#c2bcae] transition-transform group-open:rotate-90">▶</span>
        </summary>
        {error && <p className="px-2 text-sm text-[#a64d32]">{error}</p>}
        {!error && reports === null && <p className="px-2 text-sm text-[#9a9186]">불러오는 중...</p>}
        {!error && reports?.length === 0 && <p className="px-2 text-sm text-[#9a9186]">아직 저장된 보고서가 없습니다.</p>}
        <ul className="space-y-0.5">
          {reports?.map((r) => (
            <li key={r.id}>
              <Link
                href={`/viewer?source=${encodeURIComponent(r.fileUrl)}`}
                className="block rounded-lg px-2 py-2 text-sm text-[#3a342f] hover:bg-[#ece8df]"
                title={r.fileName ?? undefined}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{r.reportName || r.companyName || r.fileName || "이름 없는 보고서"}</span>
                  {r.workspaceDraftSavedAt && (
                    <span className="shrink-0 rounded-full bg-[#e1e8f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#315c9c]">
                      수정됨
                    </span>
                  )}
                </span>
                <span className="block text-xs text-[#9a9186]">
                  {new Date(r.workspaceDraftSavedAt ?? r.updatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
