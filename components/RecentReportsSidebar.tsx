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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteReport(report: RecentReportItem) {
    const name = report.reportName || report.companyName || report.fileName || "이름 없는 보고서";
    if (!window.confirm(`‘${name}’을(를) 삭제할까요? 삭제한 보고서는 복구할 수 없습니다.`)) return;
    setDeletingId(report.id);
    const response = await fetch("/api/reports", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: report.id }),
    });
    if (response.ok) setReports((items) => items?.filter((item) => item.id !== report.id) ?? []);
    else setError("보고서를 삭제하지 못했습니다.");
    setDeletingId(null);
  }

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
    <aside className="hidden w-[260px] shrink-0 border-r border-[#dfe6ef] bg-white lg:flex lg:min-h-screen lg:flex-col">
      <div className="border-b border-[#e7ecf3] px-5 py-5">
        <Link href="/new" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-[#356df3]">
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#356df3] text-sm text-white">A</span>
          AX Report
        </Link>
        <p className="mt-1 pl-9 text-[11px] text-[#94a0b2]">Usability Report Studio</p>
      </div>
      <nav className="space-y-1 border-b border-[#e7ecf3] px-3 py-4 text-sm text-[#435066]">
        <Link href="/new" className="flex items-center gap-2 rounded-md bg-[#eef3f9] px-3 py-2 font-semibold text-[#243248]"><span aria-hidden>＋</span> 새 보고서 생성</Link>
        <Link href="/" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-[#f3f6fa]"><span aria-hidden>⌁</span> 보고서 도우미</Link>
      </nav>
      {/* 목록이 길어지면 한눈에 보기 힘들다는 피드백으로 접기/펼치기 가능하게 함(2026-08-04) —
          네이티브 <details>라 별도 상태 없이 브라우저가 열림/닫힘을 관리한다. 기본은 열림. */}
      <details open className="group min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <summary className="mb-3 flex cursor-pointer list-none items-center justify-between px-2 text-xs font-semibold tracking-wide text-[#78869a]">
          저장된 보고서
          <span className="text-[#aab4c2] transition-transform group-open:rotate-90">▶</span>
        </summary>
        {error && <p className="px-2 text-sm text-[#c44848]">{error}</p>}
        {!error && reports === null && <p className="px-2 text-sm text-[#94a0b2]">불러오는 중...</p>}
        {!error && reports?.length === 0 && <p className="px-2 text-sm leading-6 text-[#94a0b2]">아직 저장된 보고서가 없습니다.</p>}
        <ul className="space-y-0.5">
          {reports?.map((r) => (
            <li key={r.id} className="group relative">
              <Link
                href={`/viewer?source=${encodeURIComponent(r.fileUrl)}`}
                className="block rounded-lg px-2 py-2 pr-9 text-sm text-[#354158] hover:bg-[#f0f4f9]"
                title={r.fileName ?? undefined}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{r.reportName || r.companyName || r.fileName || "이름 없는 보고서"}</span>
                  {r.workspaceDraftSavedAt && (
                    <span className="shrink-0 rounded-full bg-[#e9efff] px-1.5 py-0.5 text-[10px] font-semibold text-[#356df3]">
                      수정됨
                    </span>
                  )}
                </span>
                <span className="block text-xs text-[#98a3b3]">
                  {new Date(r.workspaceDraftSavedAt ?? r.updatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void deleteReport(r)}
                disabled={deletingId === r.id}
                className="absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-md text-[#a4adba] transition-colors hover:bg-[#fff1f1] hover:text-[#d83b3b] focus:bg-[#fff1f1] focus:text-[#d83b3b] disabled:opacity-50"
                aria-label={`${r.reportName || r.companyName || r.fileName || "보고서"} 삭제`}
                title="보고서 삭제"
              >
                {deletingId === r.id ? <span className="text-[10px]">···</span> : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
