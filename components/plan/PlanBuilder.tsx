"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { planFileName, splitByProduct, SURVEY_STAGES, type PlanInfo, type SurveyDraft } from "@/lib/survey/types";

const SAVE_DELAY_MS = 800;
const PLAN_MEMO_KEY = "survey-plan";
const EMPTY: PlanInfo = { businessArea: "", testers: "", schedule: "", managers: "", client: "" };

/**
 * 기획안 만들기 — 설문 문항 다음 단계(PRD 3.4.3). 설문 편집기의 `다음 단계: 기획안 만들기`가 여기로 온다.
 * 한 화면에 ① 어떤 설문으로 ② 어떤 사전요청서로 ③ 표지·개요 칸 ④ 내려받기를 위에서 아래로 둔다.
 * Ⅱ장(설문 구성)은 설문 편집기에서 이미 검토했으므로 여기서 새로 확인할 것은 ③의 칸뿐이다 — 그래서 ③은
 * 기획안 표지·Ⅰ장의 모양 그대로 보여주고 그 자리에서 고친다. 고친 칸은 설문(`draft.plan`)에 자동 저장한다.
 */
export function PlanBuilder({ surveyId }: { surveyId: string }) {
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pristine = useRef(true);

  useEffect(() => {
    fetch(`/api/survey/${surveyId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        const d: SurveyDraft = payload.draft;
        // 담당자·발주처는 사전요청서에 없고 프로젝트마다 거의 같다 — 이 브라우저에 기억한 마지막 값으로 빈 칸을 채운다.
        const plan = { ...EMPTY, ...d.plan };
        for (const k of ["managers", "client"] as const) if (!plan[k]) plan[k] = localStorage.getItem(`${PLAN_MEMO_KEY}.${k}`) ?? "";
        setDraft({ ...d, plan });
        setSourceFileName(payload.sourceFileName ?? null);
      })
      .catch(() => setError("설문 문항을 불러오지 못했습니다."));
  }, [surveyId]);

  useEffect(() => {
    if (!draft) return;
    if (pristine.current) { pristine.current = false; return; }
    const timer = setTimeout(() => {
      void fetch(`/api/survey/${surveyId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, surveyId]);

  if (error && !draft) return <Shell><p className="rounded-xl bg-[#fff1ef] px-4 py-3 text-sm text-[#b42318]">{error}</p></Shell>;
  if (!draft) return <Shell><p className="text-sm text-[#94a0b2]">불러오는 중…</p></Shell>;

  const plan = { ...EMPTY, ...draft.plan };
  const set = (patch: Partial<SurveyDraft>) => setDraft({ ...draft, ...patch });
  const setPlan = (k: keyof PlanInfo, v: string) => set({ plan: { ...plan, [k]: v } });
  const products = splitByProduct(draft);
  const stageCounts = SURVEY_STAGES.map((s) => [s, draft.questions.filter((q) => q.stage === s).length] as const).filter(([, n]) => n);
  const required: [string, string][] = [["발주처", plan.client ?? ""], ["핵심 비즈니스 영역", plan.businessArea], ["테스트 인원", plan.testers], ["진행 일정", plan.schedule], ["담당자", plan.managers]];
  const blanks = required.filter(([, v]) => !v.trim()).map(([k]) => k);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/survey/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ surveyId, draft }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `기획안을 만들지 못했습니다 (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: planFileName(draft!.companyName) }).click();
      URL.revokeObjectURL(url);
      for (const k of ["managers", "client"] as const) if (plan[k]?.trim()) localStorage.setItem(`${PLAN_MEMO_KEY}.${k}`, plan[k]!.trim());
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell surveyId={surveyId}>
      <Step n={1} title="설문 문항" hint="기획안의 진행 프로세스 표와 Ⅱ장 설문 구성은 이 설문에서 그대로 만들어집니다.">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold text-[#1d2433]">{draft.companyName || "기업명 없음"} <span className="font-normal text-[#6b778a]">· {draft.productName}</span></p>
            <p className="mt-1 text-[13px] text-[#6b778a]">{draft.questions.length}문항 · {stageCounts.map(([s, n]) => `${s} ${n}`).join(" · ")}</p>
            {products && (
              <p className="mt-2 text-[13px] text-[#356df3]">
                제품 {products.length}개({products.map((p) => p.productName).join(" / ")}) — 기획안 안에서 제품별 표·장으로 나눠 들어갑니다.
              </p>
            )}
          </div>
          <Link href={`/survey?id=${surveyId}`} className="rounded-lg bg-[#f0f0f2] px-3 py-1.5 text-[13px] font-semibold text-[#4a566b] hover:bg-[#e6e7ea]">설문 고치기</Link>
          <Link href="/survey" className="rounded-lg bg-[#f0f0f2] px-3 py-1.5 text-[13px] font-semibold text-[#4a566b] hover:bg-[#e6e7ea]">다른 설문 고르기</Link>
        </div>
      </Step>

      <Step n={2} title="사전요청서" hint="설문을 만들 때 읽은 파일입니다. 핵심 비즈니스 영역·테스트 인원·일정은 여기서 뽑았고, 뽑은 원문 문장을 ③의 칸 아래에 붙였습니다.">
        <p className="text-[14px] text-[#1d2433]">{sourceFileName ?? "사전요청서 없이 만든 설문입니다 — 아래 칸을 직접 채워 주세요."}</p>
      </Step>

      <Step n={3} title="표지·개요 확인" hint="기획안 1~3쪽에 들어가는 칸입니다. 칸을 눌러 바로 고치세요. 비운 칸은 문서에 ‘(입력 필요)’로 들어갑니다.">
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* 표지 — 실제 기획안 표지의 글자 배치를 줄여 그린다. */}
          <div className="aspect-[210/297] rounded-md border border-[#e3e7ee] bg-white p-5 shadow-[0_4px_14px_rgba(31,48,78,0.08)]">
            <Inline label="발주처" prefix="발주처 l " value={plan.client ?? ""} onChange={(v) => setPlan("client", v)} className="text-[11px] text-[#4a566b]" />
            <p className="mt-16 text-[17px] font-bold leading-snug text-[#1d2433]">사용성 테스트<br />설문 구성 기획안</p>
            <Inline label="기업명" value={draft.companyName} onChange={(v) => set({ companyName: v })} className="mt-3 text-[14px] font-semibold text-[#356df3]" />
            <p className="mt-1 text-[10px] text-[#6b778a]">Usablity Test Report for</p>
            <Inline label="제품명" value={draft.productName} onChange={(v) => set({ productName: v })} className="text-[10px] text-[#6b778a]" multiline />
          </div>
          {/* Ⅰ장 — 1) 대상 표, 2) 일정 */}
          <div className="rounded-md border border-[#e3e7ee] bg-white p-5 text-[13px] text-[#1d2433] shadow-[0_4px_14px_rgba(31,48,78,0.08)]">
            <p className="font-bold">1. 사용성 테스트 개요</p>
            <p className="mt-3 font-semibold">1) 사용성 테스트 대상</p>
            <table className="mt-2 w-full border-collapse">
              <tbody>
                {([
                  ["기업명", draft.companyName, (v: string) => set({ companyName: v }), undefined],
                  ["제품명", draft.productName, (v: string) => set({ productName: v }), undefined],
                  ["핵심 비즈니스 영역", plan.businessArea, (v: string) => setPlan("businessArea", v), plan.sources?.businessArea],
                  ["테스트 인원", plan.testers, (v: string) => setPlan("testers", v), plan.sources?.testers],
                ] as const).map(([label, v, on, source]) => (
                  <tr key={label} className="border-y border-[#dfe4ec]">
                    <th className="w-[150px] bg-[#eef3fb] px-3 py-2 text-left font-semibold">{label}</th>
                    <td className="px-3 py-1.5">
                      <Inline label={label} prefix="· " value={v} onChange={on} multiline />
                      <Source text={source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 font-semibold">2) 사용성 테스트 진행 일정</p>
            <Inline label="진행 일정" prefix="• 일  시 : " value={plan.schedule} onChange={(v) => setPlan("schedule", v)} className="mt-2" />
            <Source text={plan.sources?.schedule} />
            <Inline label="담당자" prefix="• 담당자 : " value={plan.managers} onChange={(v) => setPlan("managers", v)} className="mt-1" />
          </div>
        </div>
      </Step>

      <Step n={4} title="기획안 내려받기">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1 text-[13px] text-[#6b778a]">
            <p className="text-[14px] font-semibold text-[#1d2433]">{planFileName(draft.companyName)}</p>
            <p className="mt-1">
              {blanks.length ? <span className="text-[#b25e00]">빈 칸 {blanks.length}개({blanks.join(", ")}) — 내려받을 수는 있습니다.</span> : "모든 칸이 채워졌습니다."}
              {" "}목차의 쪽 번호는 어림값이니 한글에서 열어 확인해 주세요.
            </p>
          </div>
          <button type="button" onClick={download} disabled={busy} className="rounded-xl bg-[#356df3] px-6 py-3 text-[15px] font-semibold text-white hover:bg-[#2a5bd6] disabled:opacity-50">
            {busy ? "만드는 중…" : "기획안 HWPX 내려받기"}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-[#fff1ef] px-4 py-3 text-sm text-[#b42318]">{error}</p>}
        {done && (
          <p className="mt-3 rounded-lg bg-[#ecf8f0] px-4 py-3 text-sm text-[#1b7a3d]">
            내려받았습니다. 만든 기획안은 <Link href="/plan" className="font-semibold underline">기획안 탭</Link>에 모여 있습니다.
          </p>
        )}
      </Step>
    </Shell>
  );
}

function Shell({ children, surveyId }: { children: React.ReactNode; surveyId?: string }) {
  return (
    <div className="flex min-h-screen bg-[#f4f5f8]">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-6 py-10 lg:px-12">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <header className="mb-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#94a0b2]">
              {surveyId ? <Link href={`/survey?id=${surveyId}`} className="hover:text-[#356df3]">1단계 설문 문항</Link> : "1단계 설문 문항"}
              <span aria-hidden>›</span>
              <span className="text-[#356df3]">2단계 기획안 만들기</span>
            </p>
            <h1 className="mt-1 text-[30px] font-bold tracking-[-0.035em] text-[#1d2433]">설문 구성 기획안 만들기</h1>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e3e7ee] bg-white px-6 py-5 shadow-[0_2px_10px_rgba(31,48,78,0.04)]">
      <h2 className="flex items-center gap-2.5 text-[16px] font-bold text-[#1d2433]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#1d2433] text-[12px] text-white">{n}</span>
        {title}
      </h2>
      {hint && <p className="mb-4 mt-1 pl-[34px] text-[13px] text-[#6b778a]">{hint}</p>}
      <div className={hint ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

/** 칸을 채운 사전요청서 원문 한 줄 — 문서에는 들어가지 않고 확인용으로만 보인다. 원문에서 찾은 문장만 온다. */
function Source({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-0.5 pl-3 text-[11px] leading-snug text-[#94a0b2]">사전요청서 원문: “{text}”</p>;
}

/** 문서 모양 그대로 고치는 칸. 비어 있으면 문서와 같은 파란 `(입력 필요)`를 보여준다. */
function Inline({ label, value, onChange, prefix, suffix, className, multiline }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; className?: string; multiline?: boolean;
}) {
  const input = "min-w-0 flex-1 rounded border border-dashed border-transparent bg-transparent px-1 outline-none placeholder:text-[#356df3] hover:border-[#c9d3e3] focus:border-[#356df3] focus:bg-[#f6f9ff]";
  return (
    <label className={`flex items-start gap-0.5 ${className ?? ""}`}>
      {prefix && <span className="shrink-0 whitespace-pre">{prefix}</span>}
      {multiline
        ? <textarea aria-label={label} rows={Math.max(1, Math.ceil(value.length / 48))} placeholder="(입력 필요)" value={value} onChange={(e) => onChange(e.target.value)} className={`${input} resize-none`} />
        : <input aria-label={label} placeholder="(입력 필요)" value={value} onChange={(e) => onChange(e.target.value)} className={input} />}
      {suffix && <span className="shrink-0">{suffix}</span>}
    </label>
  );
}
