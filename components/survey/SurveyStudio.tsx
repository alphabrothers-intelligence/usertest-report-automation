"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import {
  SURVEY_STAGES,
  stageColor,
  SURVEY_TYPES,
  isChoice,
  numberQuestions,
  surveyFileName,
  toCsv,
  toWallaTxt,
  type SurveyDraft,
  type SurveyQuestion,
  type SurveyType,
} from "@/lib/survey/types";
import { buildSurveyXlsx } from "@/lib/survey/xlsx";
import type { SurveyListItem } from "@/lib/db/surveys";

const TEMPLATE_URL = "/templates/survey-question-template.xlsx";
/** 고칠 때마다 저장하면 글자마다 요청이 나간다 — 손을 멈추고 이만큼 지나면 저장한다. */
const SAVE_DELAY_MS = 800;

const field = "w-full rounded-md border border-[#dfe4ec] bg-white px-2 py-1.5 text-[13px] text-[#1d2433] outline-none focus:border-[#356df3]";

function newQuestion(stage: string): SurveyQuestion {
  return {
    id: crypto.randomUUID(), stage, text: "", type: "주관식", options: [], required: true,
    followUp: false, branchOn: "", branchValue: "", note: "", caution: "",
  };
}

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

type SaveState = "saved" | "saving" | "error";

/**
 * 설문 문항 화면. id가 없으면 목록 + 새로 만들기, 있으면 그 문항 편집.
 * 만들 때 서버에 저장되고(POST /api/survey/generate), 이후 고친 내용은 자동 저장된다(PUT).
 */
export function SurveyStudio({ initialId }: { initialId: string | null }) {
  const router = useRouter();
  const [id, setId] = useState(initialId);
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [loading, setLoading] = useState(initialId !== null);
  const [status, setStatus] = useState<"idle" | "uploading" | "generating">("idle");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** 서버에서 막 받은 draft는 다시 저장하지 않는다. */
  const pristine = useRef(true);

  useEffect(() => {
    if (!initialId) return;
    fetch(`/api/survey/${initialId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        pristine.current = true;
        setDraft(payload.draft);
        setFileName(payload.sourceFileName ?? "");
      })
      .catch(() => setError("저장된 설문 문항을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [initialId]);

  useEffect(() => {
    if (!id || !draft) return;
    if (pristine.current) {
      pristine.current = false;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/survey/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [id, draft]);

  async function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "hwp") {
      setError("HWP(구버전) 파일은 읽을 수 없습니다. 한글에서 '다른 이름으로 저장 → HWPX'로 저장해 올려 주세요.");
      return;
    }
    setError(null);
    setFileName(file.name);
    try {
      setStatus("uploading");
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        // 브라우저는 hwpx의 type을 비워 보낸다 — 업로드 허용 목록과 맞춰 명시한다.
        ...(ext === "hwpx" ? { contentType: "application/hwp+zip" } : {}),
      });
      setStatus("generating");
      const response = await fetch("/api/survey/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: blob.url, fileName: file.name }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? "설문 문항을 만들지 못했습니다.");
      // 새로 만든 문항은 이미 저장돼 있다 — 주소만 그 문항으로 바꾼다.
      pristine.current = true;
      setId(payload.id);
      setDraft(payload.draft);
      router.replace(`/survey?id=${payload.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설문 문항을 만들지 못했습니다.");
    } finally {
      setStatus("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = status !== "idle";

  return (
    <div className="flex min-h-screen bg-[#f4f5f8]">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-6 py-10 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#356df3]">
                {draft ? <Link href="/survey" className="hover:underline">설문 문항 목록</Link> : "설문 문항 생성"}
              </p>
              <h1 className="mt-1 text-[30px] font-bold tracking-[-0.035em] text-[#1d2433]">
                {draft ? `${draft.companyName || "기업명 없음"} 설문 문항` : "사전요청서로 설문 문항 만들기"}
              </h1>
              <p className="mt-1 text-[15px] text-[#6b778a]">
                {draft
                  ? `${fileName ? `‘${fileName}’에서 만든 문항입니다. ` : ""}고친 내용은 자동으로 저장됩니다.`
                  : "기업이 보낸 사전요청서(HWPX·PDF·DOCX)를 올리면 표준 구성에 맞춘 문항을 만듭니다. 여기서 고친 뒤 xlsx·csv로 내려받으세요."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {draft && <SaveBadge state={saveState} />}
              {!draft && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="rounded-lg bg-[#356df3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2a5bd6] disabled:opacity-50"
                >
                  사전요청서 올리기
                </button>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".hwpx,.hwp,.pdf,.docx,.txt"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          </header>

          {busy && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#dfe4ec] bg-white px-5 py-4 text-[15px] text-[#1d2433]">
              <span className="size-4 animate-spin rounded-full border-2 border-[#356df3] border-t-transparent" />
              {status === "uploading" ? `‘${fileName}’ 올리는 중…` : `‘${fileName}’을 읽고 문항을 설계하는 중… (보통 1~2분 걸립니다)`}
            </div>
          )}
          {error && <p className="mb-6 rounded-xl border border-[#f3c4bd] bg-[#fff4f2] px-5 py-4 text-[15px] text-[#b42318]">{error}</p>}
          {loading && <p className="text-[15px] text-[#6b778a]">불러오는 중…</p>}

          {!initialId && !draft && !busy && (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#cdd5e1] bg-white px-6 py-12 text-center hover:border-[#356df3]"
              >
                <span className="text-[17px] font-semibold text-[#1d2433]">사전요청서 파일을 선택하세요</span>
                <span className="text-[14px] text-[#6b778a]">HWPX · PDF · DOCX · TXT (HWP 구버전은 HWPX로 저장해 올려 주세요)</span>
              </button>
              <SurveyList />
            </>
          )}

          {draft && <SurveyEditor draft={draft} onChange={setDraft} />}
        </div>
      </main>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const label = { saved: "저장됨", saving: "저장 중…", error: "저장 실패 — 다시 고치면 재시도합니다" }[state];
  return <span className={`text-[13px] ${state === "error" ? "font-semibold text-[#b42318]" : "text-[#6b778a]"}`}>{label}</span>;
}

/** 저장된 설문 문항 목록 — 보고서 목록(`/reports`)과 같은 모양. */
function SurveyList() {
  const [items, setItems] = useState<SurveyListItem[] | null>(null);

  useEffect(() => {
    fetch("/api/survey", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => setItems(payload.surveys ?? []))
      .catch(() => setItems([]));
  }, []);

  async function remove(item: SurveyListItem) {
    if (!window.confirm(`‘${item.companyName || item.sourceFileName || "이름 없음"}’ 설문 문항을 삭제할까요? 복구할 수 없습니다.`)) return;
    const res = await fetch(`/api/survey/${item.id}`, { method: "DELETE" });
    if (res.ok) setItems((list) => list?.filter((i) => i.id !== item.id) ?? []);
  }

  if (!items || items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[17px] font-bold text-[#1d2433]">저장된 설문 문항</h2>
      <ul className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e7ecf3] bg-white">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#f9fafc]">
            <Link href={`/survey?id=${item.id}`} className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-[#1d2433]">
                {item.companyName || "기업명 없음"}{item.productName && <span className="font-normal text-[#6b778a]"> · {item.productName}</span>}
              </span>
              <span className="block truncate text-[13px] text-[#94a0b2]">
                {item.questionCount}문항 · {new Date(item.updatedAt).toLocaleString("ko-KR")} 수정{item.sourceFileName && ` · ${item.sourceFileName}`}
              </span>
            </Link>
            <button type="button" onClick={() => remove(item)} className="rounded-lg px-3 py-1.5 text-[13px] text-[#b42318] hover:bg-[#fff1ef]">
              삭제
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function problemOf(q: SurveyQuestion): string | null {
  if (!q.text.trim()) return "문항 문구가 비어 있습니다.";
  if (isChoice(q.type) && q.options.filter((o) => o.trim()).length === 0) return "객관식인데 보기가 없습니다.";
  return null;
}

function WarnIcon({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-label={title ?? "확인 필요"} role="img" className={`shrink-0 fill-current ${className ?? ""}`}>
      {title && <title>{title}</title>}
      <path d="M8 1.5c.4 0 .8.2 1 .6l6 10.6c.4.7-.1 1.6-1 1.6H2c-.9 0-1.4-.9-1-1.6l6-10.6c.2-.4.6-.6 1-.6Zm0 4a.8.8 0 0 0-.8.8v3a.8.8 0 0 0 1.6 0v-3a.8.8 0 0 0-.8-.8Zm0 6.2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
    </svg>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`size-4 shrink-0 fill-none stroke-current ${className ?? ""}`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

/**
 * 엑셀처럼 한눈에 훑는 표 + 오른쪽 고정 패널.
 * 표는 읽기 전용으로 촘촘하게 두고, 행을 고르면 오른쪽 패널에서 그 문항을 고친다 — 표 안에서
 * 칸이 열리고 닫히면 위치가 계속 밀려 훑기가 어렵다(2026-10-01 지적). 고른 게 없을 때 패널은
 * 설문 개요(단계별 문항 수·전체 확인 사항)를 보여준다. ↑/↓로 행을 옮기고 Esc로 선택을 푼다.
 */
function SurveyEditor({ draft, onChange }: { draft: SurveyDraft; onChange: (d: SurveyDraft) => void }) {
  const { questions } = draft;
  const numbers = useMemo(() => numberQuestions(questions), [questions]);
  const stages = useMemo(
    () => [...SURVEY_STAGES, ...new Set(questions.map((q) => q.stage).filter((s) => !(SURVEY_STAGES as readonly string[]).includes(s)))],
    [questions],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const selectedIndex = questions.findIndex((q) => q.id === selectedId);
  /** 확인이 필요한 문항만 걸러 보기 — 목록을 따로 읽게 하지 않고 표 자체를 거른다. */
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const setQuestions = (next: SurveyQuestion[]) => onChange({ ...draft, questions: next });
  const update = (id: string, patch: Partial<SurveyQuestion>) =>
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const move = (index: number, delta: number) => {
    const next = [...questions];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setQuestions(next);
  };
  const remove = (id: string) => {
    if (!window.confirm(`${numbers.get(id)} 문항을 삭제할까요?`)) return;
    // 지운 문항을 분기 대상으로 삼던 문항은 조건만 푼다.
    setQuestions(questions.filter((q) => q.id !== id).map((q) => (q.branchOn === id ? { ...q, branchOn: "", branchValue: "" } : q)));
    setSelectedId(null);
  };
  const insertAfter = (index: number, stage: string) => {
    const next = [...questions];
    const added = newQuestion(stage);
    next.splice(index + 1, 0, added);
    setQuestions(next);
    setSelectedId(added.id);
  };
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  };

  const flagged = questions.filter((q) => problemOf(q) || q.caution?.trim());
  const visible = onlyFlagged && flagged.length > 0 ? flagged : questions;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        if (e.key === "Escape") target.blur();
        return;
      }
      if (e.key === "Escape") setSelectedId(null);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const at = visible.findIndex((q) => q.id === selectedId);
      const next = visible[Math.min(visible.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        setSelectedId(next.id);
        rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId]);


  // 연속한 같은 단계의 첫 행에 단계 칸을 rowSpan으로 건다(엑셀 병합과 같은 모양).
  const stageSpan = useMemo(() => {
    const span = new Map<number, number>();
    for (let i = 0; i < visible.length; ) {
      let j = i;
      while (j + 1 < visible.length && visible[j + 1].stage === visible[i].stage) j += 1;
      span.set(i, j - i + 1);
      i = j + 1;
    }
    return span;
  }, [visible]);

  async function downloadXlsx() {
    setDownloading(true);
    try {
      const template = await (await fetch(TEMPLATE_URL)).arrayBuffer();
      const bytes = await buildSurveyXlsx(template, questions);
      download(bytes as BlobPart, surveyFileName(draft.companyName, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } finally {
      setDownloading(false);
    }
  }

  const selected = selectedIndex >= 0 ? questions[selectedIndex] : null;
  const cell = "border-b border-[#e9edf3] px-3 py-2 align-middle";

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#e7ecf3] bg-white px-5 py-4">
        <label className="w-[220px] text-[12px] font-semibold text-[#6b778a]">
          기업명 <span className="font-normal text-[#94a0b2]">(파일명에 쓰임)</span>
          <input className={`${field} mt-1`} value={draft.companyName} onChange={(e) => onChange({ ...draft, companyName: e.target.value })} />
        </label>
        <label className="min-w-[220px] flex-1 text-[12px] font-semibold text-[#6b778a]">
          제품명
          <input className={`${field} mt-1`} value={draft.productName} onChange={(e) => onChange({ ...draft, productName: e.target.value })} />
        </label>
        <button type="button" onClick={downloadXlsx} disabled={downloading} className="rounded-lg bg-[#1d2433] px-4 py-2 text-sm font-semibold text-white hover:bg-[#33405a] disabled:opacity-50">
          xlsx 다운로드
        </button>
        <button
          type="button"
          onClick={() => download(toCsv(questions), surveyFileName(draft.companyName, "csv"), "text/csv;charset=utf-8")}
          className="rounded-lg bg-[#f0f3f8] px-4 py-2 text-sm font-semibold text-[#1d2433] hover:bg-[#e4e9f1]"
        >
          csv 다운로드
        </button>
        <button
          type="button"
          title="WALLA ‘Qualtrics 심플 포맷으로 가져오기’에 올리는 파일입니다. 분기·필수 여부는 가져온 뒤 WALLA에서 설정해 주세요."
          onClick={() => download(toWallaTxt(questions), surveyFileName(draft.companyName, "txt"), "text/plain;charset=utf-8")}
          className="rounded-lg bg-[#f0f3f8] px-4 py-2 text-sm font-semibold text-[#1d2433] hover:bg-[#e4e9f1]"
        >
          WALLA용 txt
        </button>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-4">
        <div className="overflow-clip rounded-2xl border border-[#e7ecf3] bg-white">
          <div className="flex items-center gap-1 border-b border-[#e3e8ef] px-3 py-2 text-[13px]">
            {[
              { on: false, label: "전체", count: questions.length },
              { on: true, label: "확인 필요", count: flagged.length },
            ].map((tab) => (
              <button
                key={tab.label}
                type="button"
                disabled={tab.on && flagged.length === 0}
                onClick={() => setOnlyFlagged(tab.on)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold disabled:opacity-40 ${
                  (onlyFlagged && flagged.length > 0) === tab.on ? "bg-[#1d2433] text-white" : "text-[#4a566b] hover:bg-[#f0f3f8]"
                }`}
              >
                {tab.on && <WarnIcon className="size-3.5" />}
                {tab.label}
                <span className="font-normal opacity-70">{tab.count}</span>
              </button>
            ))}
          </div>
          <table className="w-full table-fixed border-collapse text-left text-[13px] text-[#1d2433]">
            <colgroup>
              <col className="w-[132px]" />
              <col className="w-[68px]" />
              <col />
              <col className="w-[96px]" />
              <col className="w-[30%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f6f8fb] text-[12px] font-semibold text-[#6b778a]">
              <tr>
                <th className="border-b border-[#e3e8ef] px-3 py-2.5">단계</th>
                <th className="border-b border-[#e3e8ef] px-3 py-2.5">번호</th>
                <th className="border-b border-[#e3e8ef] px-3 py-2.5">문항</th>
                <th className="border-b border-[#e3e8ef] px-3 py-2.5">형식</th>
                <th className="border-b border-[#e3e8ef] px-3 py-2.5">보기</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q, index) => {
                const span = stageSpan.get(index);
                const active = q.id === selectedId;
                const problem = problemOf(q);
                const options = q.options.filter((o) => o.trim());
                // 같은 응답자 묶음이 이어지는 동안은 분기 표시를 되풀이하지 않는다.
                // 분기 안내는 걸러 보기와 상관없이 실제 설문 순서상 바로 앞 문항과 비교한다.
                const prev = questions[questions.indexOf(q) - 1];
                const showBranch = q.branchOn && !(prev && prev.branchOn === q.branchOn && prev.branchValue === q.branchValue);
                const branchEnds = !q.branchOn && !q.followUp && prev?.branchOn;
                return (
                  <tr
                    key={q.id}
                    ref={(el) => { if (el) rowRefs.current.set(q.id, el); else rowRefs.current.delete(q.id); }}
                    onClick={() => select(active ? null : q.id)}
                    className={`cursor-pointer ${active ? "bg-[#e8efff]" : "hover:bg-[#f7f9fc]"}`}
                  >
                    {span && (
                      <td
                        rowSpan={span}
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: `#${stageColor(q.stage)}` }}
                        className="cursor-default border-b border-r border-[#d9dfe8] px-3 py-3 text-center align-top text-[12px] font-semibold leading-[1.45] text-[#3d4757]"
                      >
                        {/* 긴 단계도 스크롤하는 동안 이름이 화면에 남게 */}
                        <span className="sticky top-12 block">{q.stage}</span>
                      </td>
                    )}
                    <td className={`${cell} whitespace-nowrap font-semibold ${q.followUp ? "text-[#94a0b2]" : "text-[#356df3]"}`}>
                      <span className="flex items-center gap-1">
                        {numbers.get(q.id)}
                        {(problem || q.caution?.trim()) && (
                          <WarnIcon className={`size-3.5 ${problem ? "text-[#d92d20]" : "text-[#e8a317]"}`} title={problem ?? q.caution} />
                        )}
                      </span>
                    </td>
                    <td className={`${cell} ${q.followUp ? "pl-5 text-[#4a566b]" : "font-medium"}`}>
                      <span className="line-clamp-2">
                        {q.text || <span className="text-[#b42318]">문구 없음</span>}
                      </span>
                      {(showBranch || branchEnds || !q.required) && (
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                          {showBranch && <span className="text-[#356df3]">여기부터 {numbers.get(q.branchOn)}=‘{q.branchValue}’ 응답자만</span>}
                          {branchEnds && <span className="text-[#356df3]">여기부터 모든 응답자</span>}
                          {!q.required && <span className="text-[#94a0b2]">선택 응답</span>}
                        </span>
                      )}
                    </td>
                    <td className={`${cell} text-[12px] text-[#4a566b]`}>{q.type}</td>
                    <td className={`${cell} text-[12px] text-[#6b778a]`}>
                      <span className="line-clamp-2">{options.join(" · ")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="sticky top-6 max-h-[calc(100vh-48px)] overflow-y-auto rounded-2xl border border-[#e7ecf3] bg-white">
          {selected ? (
            <QuestionPanel
              key={selected.id}
              q={selected}
              number={numbers.get(selected.id) ?? ""}
              stages={stages}
              earlier={questions.slice(0, selectedIndex).filter((p) => isChoice(p.type))}
              numbers={numbers}
              canUp={selectedIndex > 0}
              canDown={selectedIndex < questions.length - 1}
              onChange={(patch) => update(selected.id, patch)}
              onMove={(delta) => move(selectedIndex, delta)}
              onRemove={() => remove(selected.id)}
              onInsert={() => insertAfter(selectedIndex, selected.stage)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <OverviewPanel draft={draft} numbers={numbers} onSelect={select} />
          )}
        </aside>
      </div>
    </div>
  );
}

/** 아무 문항도 고르지 않았을 때 — 설문 전체를 한눈에. */
function OverviewPanel({ draft, numbers, onSelect }: {
  draft: SurveyDraft; numbers: Map<string, string>; onSelect: (id: string) => void;
}) {
  const { questions } = draft;
  const byStage = [...new Set(questions.map((q) => q.stage))].map((stage) => ({
    stage,
    first: questions.find((q) => q.stage === stage)!,
    count: questions.filter((q) => q.stage === stage).length,
  }));
  const heading = "mb-2 text-[12px] font-bold uppercase tracking-wide text-[#94a0b2]";
  return (
    <div className="space-y-6 p-5 text-[13px] text-[#4a566b]">
      <div>
        <p className="text-[22px] font-bold tracking-[-0.03em] text-[#1d2433]">
          {[...numbers.values()].filter((n) => !n.includes("-")).length}문항
          <span className="ml-1.5 text-[13px] font-normal text-[#94a0b2]">하위 포함 {questions.length}줄</span>
        </p>
        <p className="mt-1 text-[12px] text-[#94a0b2]">행을 누르면 여기서 고칠 수 있어요 · ↑↓로 이동</p>
      </div>

      <div>
        <p className={heading}>단계</p>
        <ul className="space-y-1">
          {byStage.map(({ stage, first, count }) => (
            <li key={stage}>
              <button type="button" onClick={() => onSelect(first.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[#f6f8fb]">
                <span className="size-3 shrink-0 rounded-sm" style={{ background: `#${stageColor(stage)}` }} />
                <span className="flex-1 text-[#1d2433]">{stage}</span>
                <span className="text-[#94a0b2]">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {draft.reviewNotes.length > 0 && (
        <Disclosure label="설문 전체 메모" count={draft.reviewNotes.length}>
          <ul className="list-disc space-y-1.5 pl-4">{draft.reviewNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Disclosure>
      )}
      {draft.excludedFeatures.length > 0 && (
        <Disclosure label="평가에서 뺀 기능" count={draft.excludedFeatures.length}>
          <ul className="space-y-1.5">
            {draft.excludedFeatures.map((f, i) => <li key={i}><b className="text-[#1d2433]">{f.name}</b> — {f.reason}</li>)}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

/** 접었다 펴는 한 줄 — 제목 행 전체가 누르는 영역이다. */
function Disclosure({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group -mx-2 rounded-lg">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-[14px] text-[#1d2433] hover:bg-[#f6f8fb] [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{label}</span>
        <span className="text-[13px] text-[#94a0b2]">{count}</span>
        <Chevron className="text-[#94a0b2] transition-transform group-open:rotate-90" />
      </summary>
      <div className="px-2 pb-2 pt-1 leading-[1.6]">{children}</div>
    </details>
  );
}

function QuestionPanel({ q, number, stages, earlier, numbers, canUp, canDown, onChange, onMove, onRemove, onInsert, onClose }: {
  q: SurveyQuestion; number: string; stages: string[]; earlier: SurveyQuestion[]; numbers: Map<string, string>;
  canUp: boolean; canDown: boolean;
  onChange: (patch: Partial<SurveyQuestion>) => void; onMove: (delta: number) => void;
  onRemove: () => void; onInsert: () => void; onClose: () => void;
}) {
  const label = "block text-[12px] font-semibold text-[#6b778a]";
  const small = "rounded-lg px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-30";
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-[#eef1f5] bg-white px-5 py-3">
        <span className="mr-auto text-[16px] font-bold text-[#1d2433]">{number}</span>
        <button type="button" title="위로" disabled={!canUp} onClick={() => onMove(-1)} className={`${small} bg-[#f0f3f8] text-[#1d2433]`}>↑</button>
        <button type="button" title="아래로" disabled={!canDown} onClick={() => onMove(1)} className={`${small} bg-[#f0f3f8] text-[#1d2433]`}>↓</button>
        <button type="button" title="바로 아래에 새 문항" onClick={onInsert} className={`${small} bg-[#eef3fe] text-[#356df3]`}>+ 추가</button>
        <button type="button" onClick={onRemove} className={`${small} bg-[#fff1ef] text-[#b42318]`}>삭제</button>
        <button type="button" title="닫기 (Esc)" aria-label="닫기" onClick={onClose} className={`${small} text-[16px] leading-none text-[#6b778a] hover:bg-[#f0f3f8]`}>×</button>
      </div>

      <div className="space-y-4 p-5">
        {problemOf(q) && (
          <p className="flex gap-2 rounded-lg bg-[#fef3f2] px-3 py-2.5 text-[13px] leading-[1.55] text-[#912018]">
            <WarnIcon className="mt-0.5 size-4 text-[#d92d20]" />
            <span>{problemOf(q)}</span>
          </p>
        )}
        {q.caution?.trim() && (
          <p className="flex gap-2 rounded-lg bg-[#fff8e6] px-3 py-2.5 text-[13px] leading-[1.55] text-[#5c4300]">
            <WarnIcon className="mt-0.5 size-4 text-[#e8a317]" />
            <span>{q.caution}</span>
          </p>
        )}

        <label className={label}>
          문항
          <textarea className={`${field} mt-1 min-h-[72px] resize-y text-[14px]`} value={q.text} onChange={(e) => onChange({ text: e.target.value })} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            응답 형식
            <select className={`${field} mt-1`} value={q.type} onChange={(e) => onChange({ type: e.target.value as SurveyType })}>
              {SURVEY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className={label}>
            필수 여부
            <select className={`${field} mt-1`} value={q.required ? "필수" : "선택"} onChange={(e) => onChange({ required: e.target.value === "필수" })}>
              <option>필수</option>
              <option>선택</option>
            </select>
          </label>
        </div>

        {isChoice(q.type) && (
          <label className={label}>
            보기 <span className="font-normal text-[#94a0b2]">(한 줄에 하나)</span>
            <textarea
              className={`${field} mt-1 min-h-[110px] resize-y`}
              value={q.options.join("\n")}
              onChange={(e) => onChange({ options: e.target.value.split("\n") })}
            />
          </label>
        )}

        <label className={label}>
          안내 문구 <span className="font-normal text-[#94a0b2]">(응답자에게 문항 아래 작게 보임)</span>
          <textarea className={`${field} mt-1 min-h-[52px] resize-y`} value={q.note} onChange={(e) => onChange({ note: e.target.value })} />
        </label>

        <label className={label}>
          단계
          <select className={`${field} mt-1`} value={q.stage} onChange={(e) => onChange({ stage: e.target.value })}>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <div className="space-y-2">
          <span className={label}>보여줄 응답자</span>
          <select className={field} value={q.branchOn} onChange={(e) => onChange({ branchOn: e.target.value, branchValue: "" })}>
            <option value="">모두에게</option>
            {earlier.map((p) => <option key={p.id} value={p.id}>{numbers.get(p.id)} {p.text.slice(0, 22)}</option>)}
          </select>
          {q.branchOn && (
            <select className={field} value={q.branchValue} onChange={(e) => onChange({ branchValue: e.target.value })}>
              <option value="">…에서 이 보기를 고른 사람</option>
              {earlier.find((p) => p.id === q.branchOn)?.options.filter((o) => o.trim()).map((o) => <option key={o}>{o}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1.5 pt-1 text-[13px] text-[#4a566b]">
            <input type="checkbox" checked={q.followUp} onChange={(e) => onChange({ followUp: e.target.checked })} />
            앞 문항의 하위 문항 <span className="text-[#94a0b2]">(번호가 Q3-1처럼 붙음)</span>
          </label>
        </div>

        <label className={label}>
          담당자 확인 메모 <span className="font-normal text-[#94a0b2]">(파일에는 안 들어감)</span>
          <textarea className={`${field} mt-1 min-h-[52px] resize-y`} value={q.caution ?? ""} onChange={(e) => onChange({ caution: e.target.value })} />
        </label>
      </div>
    </div>
  );
}
