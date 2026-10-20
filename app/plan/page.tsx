"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { PlanListItem } from "@/lib/db/surveys";

const downloadUrl = (p: PlanListItem) => `/api/download?u=${encodeURIComponent(p.blobUrl)}&name=${encodeURIComponent(p.fileName)}`;

/**
 * 만든 기획안 모아 보기(PRD 3.4.3). 기획안은 설문에서 만든다 — 여기서 새로 만들 때는 설문 목록으로 보낸다
 * (설문 고르기 화면을 두 벌 두지 않는다). 각 기획안은 만들 때의 파일 그대로이고, 그 뒤 설문 문항이 바뀌었으면
 * 표시해 `다시 만들기`를 권한다. 다시 만들어도 옛 파일은 덮어쓰지 않고 새 줄이 생긴다.
 */
export default function PlanPage() {
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/plans", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { plans?: PlanListItem[] }) => setPlans(data.plans ?? []))
      .catch(() => setError("기획안 목록을 불러오지 못했습니다."));
  }, []);
  useEffect(load, [load]);

  async function regenerate(p: PlanListItem) {
    setBusyId(p.id);
    setError(null);
    try {
      const survey = await fetch(`/api/survey/${p.surveyId}`, { cache: "no-store" }).then((res) => res.json());
      if (!survey.ok) throw new Error("설문 문항을 불러오지 못했습니다.");
      const res = await fetch("/api/survey/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId: p.surveyId, draft: survey.draft }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `기획안을 만들지 못했습니다 (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: p.fileName }).click();
      URL.revokeObjectURL(url);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: PlanListItem) {
    if (!window.confirm(`‘${p.fileName}’을(를) 삭제할까요? 복구할 수 없습니다. 설문 문항은 그대로 남습니다.`)) return;
    setBusyId(p.id);
    const res = await fetch(`/api/plans/${p.id}`, { method: "DELETE" });
    if (res.ok) setPlans((list) => list?.filter((i) => i.id !== p.id) ?? []);
    else setError("기획안을 삭제하지 못했습니다.");
    setBusyId(null);
  }

  const button = "rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";
  return (
    <div className="flex min-h-screen bg-[#f4f5f8]">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-6 py-10 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#356df3]">기획안</p>
              <h1 className="mt-1 text-[30px] font-bold tracking-[-0.035em] text-[#1d2433]">만든 기획안</h1>
              <p className="mt-1 text-[15px] text-[#6b778a]">설문 문항으로 만든 설문 구성 기획안(HWPX)을 모아 봅니다.</p>
            </div>
            <Link href="/survey" className="rounded-lg bg-[#356df3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2a5bd6]">
              + 설문에서 기획안 만들기
            </Link>
          </header>

          {error && <p className="mb-4 rounded-lg bg-[#fff1ef] px-4 py-3 text-sm text-[#b42318]">{error}</p>}
          <section className="overflow-hidden rounded-2xl border border-[#e3e7ee] bg-white shadow-[0_2px_10px_rgba(31,48,78,0.04)]">
            {plans === null && !error && <p className="px-6 py-10 text-center text-sm text-[#94a0b2]">불러오는 중…</p>}
            {plans?.length === 0 && (
              <div className="px-6 py-14 text-center">
                <p className="text-[15px] text-[#6b778a]">아직 만든 기획안이 없습니다.</p>
                <Link href="/survey" className="mt-3 inline-block text-sm font-semibold text-[#356df3]">설문 문항 목록에서 고르기 →</Link>
              </div>
            )}
            {!!plans?.length && (
              <ul className="divide-y divide-[#eef1f5]">
                {plans.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-4 px-6 py-4 hover:bg-[#f9fafc]">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#1d2433]">
                        {p.companyName || "기업명 없음"}
                        {p.productName && <span className="font-normal text-[#6b778a]">· {p.productName}</span>}
                        {p.surveyChanged && <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[11px] font-semibold text-[#b25e00]">이후 설문이 바뀌었어요</span>}
                        {p.surveyChanged === null && <span className="rounded-full bg-[#f0f0f2] px-2 py-0.5 text-[11px] font-semibold text-[#6b778a]">설문 삭제됨</span>}
                      </p>
                      <p className="truncate text-[13px] text-[#94a0b2]">
                        {p.questionCount}문항 · {new Date(p.createdAt).toLocaleString("ko-KR")} 생성 · {p.fileName}
                      </p>
                    </div>
                    <a href={downloadUrl(p)} className={`${button} bg-[#356df3] text-white hover:bg-[#2a5bd6]`}>내려받기</a>
                    {p.surveyId && (
                      <>
                        <button type="button" onClick={() => void regenerate(p)} disabled={busyId === p.id} className={`${button} bg-[#eef3fe] text-[#356df3] hover:bg-[#e0eafd]`}>
                          {busyId === p.id ? "만드는 중…" : "지금 설문으로 다시 만들기"}
                        </button>
                        <Link href={`/survey?id=${p.surveyId}`} className={`${button} bg-[#f0f0f2] text-[#4a566b] hover:bg-[#e6e7ea]`}>설문 열기</Link>
                      </>
                    )}
                    <button type="button" onClick={() => void remove(p)} disabled={busyId === p.id} className={`${button} text-[#b42318] hover:bg-[#fff1ef]`}>삭제</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
