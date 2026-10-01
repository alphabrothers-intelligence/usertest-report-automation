"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";

interface ReportItem {
  id: string;
  fileName: string | null;
  fileUrl: string;
  updatedAt: string;
  companyName: string | null;
  reportName: string | null;
  workspaceDraftSavedAt: string | null;
}

const displayName = (r: ReportItem) => r.reportName || r.companyName || r.fileName || "이름 없는 보고서";

/** 생성한 보고서 목록. 클릭하면 저장된 결과를 그대로 여는 /viewer로 간다(재분석 없음). */
export default function ReportsPage() {
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { reports?: ReportItem[] }) => { if (!cancelled) setReports(data.reports ?? []); })
      .catch(() => { if (!cancelled) setError("보고서 목록을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, []);

  async function deleteReport(report: ReportItem) {
    if (!window.confirm(`‘${displayName(report)}’을(를) 삭제할까요? 삭제한 보고서는 복구할 수 없습니다.`)) return;
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

  return (
    <div className="flex min-h-screen bg-[#f4f5f8]">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-6 py-10 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#356df3]">보고서 목록</p>
              <h1 className="mt-1 text-[30px] font-bold tracking-[-0.035em] text-[#1d2433]">생성한 보고서</h1>
              <p className="mt-1 text-[15px] text-[#6b778a]">raw data로 만든 사용성테스트 결과보고서를 한곳에서 확인합니다.</p>
            </div>
            <Link href="/new" className="rounded-lg bg-[#356df3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2a5bd6]">
              + 새 보고서 생성
            </Link>
          </header>

          <section className="overflow-hidden rounded-2xl border border-[#e3e7ee] bg-white shadow-[0_2px_10px_rgba(31,48,78,0.04)]">
            {error && <p className="px-6 py-10 text-center text-sm text-[#c44848]">{error}</p>}
            {!error && reports === null && <p className="px-6 py-10 text-center text-sm text-[#94a0b2]">불러오는 중…</p>}
            {!error && reports?.length === 0 && (
              <div className="px-6 py-14 text-center">
                <p className="text-[15px] text-[#6b778a]">아직 생성한 보고서가 없습니다.</p>
                <Link href="/new" className="mt-3 inline-block text-sm font-semibold text-[#356df3]">첫 보고서 만들기 →</Link>
              </div>
            )}
            {!!reports?.length && (
              // 표지 미리보기 카드(2026-10-01 담당자 요청): 실제 표지와 같은 배경 위에 기업명·날짜를 얹고,
              // 카드 아래에 제목과 마지막 수정 시각을 둔다.
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-8 p-6">
                {reports.map((r) => {
                  const when = new Date(r.workspaceDraftSavedAt ?? r.updatedAt);
                  return (
                    <li key={r.id} className="group relative">
                      <Link href={`/viewer?report=${r.id}`} title={r.fileName ?? undefined} className="block">
                        <div className="relative aspect-[210/297] overflow-hidden rounded-md border border-[#e3e7ee] bg-white shadow-[0_4px_14px_rgba(31,48,78,0.08)] transition group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_24px_rgba(31,48,78,0.14)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/images/rivalabs-cover-template.png" alt="" className="absolute inset-0 size-full object-cover" />
                          <div className="absolute left-[9%] right-[8%] top-[51%] tracking-[-0.05em]">
                            <p className="text-[13px] font-bold leading-tight text-[#075b9c]">사용성 테스트<br />결과보고서</p>
                            <p className="mt-1.5 truncate text-[11px] font-medium text-[#5d7fd0]">{r.companyName || displayName(r)}</p>
                            <p className="mt-1 text-[8px] text-[#666]">{when.toLocaleDateString("ko-KR")}</p>
                          </div>
                        </div>
                        <p className="mt-3 line-clamp-2 text-[14px] font-semibold leading-snug text-[#1d2433]">{displayName(r)}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#94a0b2]">
                          {when.toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {r.workspaceDraftSavedAt && <span className="rounded-full bg-[#e9efff] px-1.5 py-0.5 text-[10px] font-semibold text-[#356df3]">수정됨</span>}
                        </p>
                      </Link>
                      <button
                        type="button"
                        onClick={() => void deleteReport(r)}
                        disabled={deletingId === r.id}
                        className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md bg-white/90 text-[#8a94a3] opacity-0 shadow-sm transition-opacity hover:text-[#d83b3b] focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                        aria-label={`${displayName(r)} 삭제`}
                        title="보고서 삭제"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
