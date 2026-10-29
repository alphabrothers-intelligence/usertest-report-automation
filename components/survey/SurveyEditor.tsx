"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SURVEY_STAGES,
  stageColor,
  SURVEY_TYPES,
  isChoice,
  numberQuestions,
  surveyFileName,
  toCsv,
  toWallaTxt,
  splitByProduct,
  wallaChecklist,
  wallaLayout,
  wallaTodos,
  type SurveyDraft,
  type SurveyQuestion,
  type SurveyType,
} from "@/lib/survey/types";
import { buildSurveyXlsx } from "@/lib/survey/xlsx";

const TEMPLATE_URL = "/templates/survey-question-template.xlsx";
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
export function SurveyEditor({ draft, onChange, surveyId }: { draft: SurveyDraft; onChange: (d: SurveyDraft) => void; surveyId: string | null }) {
  const router = useRouter();
  const [splitting, setSplitting] = useState(false);
  const parts = useMemo(() => splitByProduct(draft), [draft]);
  /** 제품마다 따로 폼을 돌리고 싶을 때 — 원래 설문은 남기고 제품별 설문을 새로 저장한 뒤 목록으로 간다. */
  async function splitIntoSurveys() {
    if (!surveyId || !parts) return;
    if (!window.confirm(`제품별로 완성된 설문 ${parts.length}개(${parts.map((p) => p.productName).join(" / ")})를 새로 만듭니다.\n지금 설문은 그대로 남습니다. 계속할까요?`)) return;
    setSplitting(true);
    try {
      const res = await fetch(`/api/survey/${surveyId}/split`, { method: "POST" });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error);
      router.push("/survey");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "나누지 못했습니다.");
    } finally {
      setSplitting(false);
    }
  }
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
  const layout = useMemo(() => wallaLayout(questions), [questions]);
  const wallaInfo = (q: SurveyQuestion) => ({ label: layout.find((s) => s.q.id === q.id)?.label ?? "", todos: wallaTodos(q, layout) });
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
        <DownloadMenu
          disabled={downloading}
          items={[
            { label: "문항리스트 xlsx", hint: "Tally 설문 폼 입력용 템플릿", run: downloadXlsx },
            { label: "문항리스트 csv", hint: "엑셀 없이 열 때", run: () => download(toCsv(questions), surveyFileName(draft.companyName, "csv"), "text/csv;charset=utf-8") },
            { label: "WALLA용 txt", hint: "WALLA ‘Qualtrics 심플 포맷으로 가져오기’에 올리는 파일", run: () => download(toWallaTxt(questions), surveyFileName(draft.companyName, "txt"), "text/plain;charset=utf-8") },
            { label: "WALLA 설정 목록", hint: "가져온 뒤 손으로 설정할 것(로직·필수·선형배율·기타 보기)", run: () => download(wallaChecklist(questions), surveyFileName(draft.companyName, "txt", "_WALLA설정목록"), "text/plain;charset=utf-8") },
          ]}
        />
        {/* 기획안은 버튼 묶음 속 내려받기 하나가 아니라 다음 단계다 — 따로 떼어 진하게 둔다(2026-10-20 담당자). */}
        <div className="ml-auto flex items-center gap-3 border-l border-[#e7ecf3] pl-4">
          {surveyId ? (
            <Link href={`/plan/new?survey=${surveyId}`} className="flex items-center gap-2 rounded-xl bg-[#356df3] px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_4px_12px_rgba(53,109,243,0.25)] hover:bg-[#2a5bd6]">
              다음 단계: 기획안 만들기 <span aria-hidden>→</span>
            </Link>
          ) : (
            <span className="rounded-xl bg-[#c9d6f7] px-5 py-2.5 text-[14px] font-semibold text-white">저장 중…</span>
          )}
        </div>
      </section>

      {parts && (
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#c9d8fb] bg-[#f3f7ff] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-[#1d2433]">
              제품 {parts.length}개를 한 설문에서 분기로 묻고 있어요 <span className="font-normal text-[#4a566b]">→ {parts.map((p) => p.productName).join(" / ")}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-[#4a566b]">
              제품마다 WALLA 폼을 따로 돌리려면 나누세요. 지금 설문은 그대로 남고, 기획안은 나누지 않아도 제품별로 정리됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={splitIntoSurveys}
            disabled={splitting || !surveyId}
            className="rounded-xl border border-[#356df3] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#356df3] hover:bg-[#eef3fe] disabled:opacity-50"
          >
            {splitting ? "나누는 중…" : `제품별 설문 ${parts.length}개로 나누기`}
          </button>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-4">
        <div className="overflow-clip rounded-2xl border border-[#e7ecf3] bg-white">
          {/* 문항 거르기 — 탭 글자만 있으면 누르는 것인지 몰랐다(2026-10-20). 테두리 있는 묶음 버튼으로 보이게 한다. */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#e3e8ef] px-4 py-3 text-[13px]">
            <span className="font-semibold text-[#6b778a]">문항 보기</span>
            <div role="group" aria-label="문항 보기" className="inline-flex rounded-xl border border-[#dfe4ec] bg-[#f6f8fb] p-1">
              {[
                { on: false, label: "전체 문항", count: questions.length },
                { on: true, label: "확인 필요한 문항만", count: flagged.length },
              ].map((tab) => {
                const active = (onlyFlagged && flagged.length > 0) === tab.on;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    aria-pressed={active}
                    disabled={tab.on && flagged.length === 0}
                    onClick={() => setOnlyFlagged(tab.on)}
                    className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? "bg-white text-[#1d2433] shadow-[0_1px_4px_rgba(31,48,78,0.15)]" : "cursor-pointer text-[#6b778a] hover:bg-white/70 hover:text-[#1d2433]"
                    }`}
                  >
                    {tab.on && <WarnIcon className="size-3.5 text-[#d97706]" />}
                    {tab.label}
                    <span className={`rounded-full px-1.5 text-[11px] ${tab.on ? "bg-[#fff4e0] text-[#b25e00]" : "bg-[#eef1f5] text-[#4a566b]"}`}>{tab.count}</span>
                  </button>
                );
              })}
            </div>
            {flagged.length > 0 && !onlyFlagged && <span className="text-[12px] text-[#94a0b2]">⚠ 표시가 붙은 문항 {flagged.length}개를 먼저 확인해 주세요.</span>}
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
                        className="cursor-default border-b border-r border-[#d9dfe8] px-3 py-3 text-center align-middle text-[12px] font-semibold leading-[1.45] text-[#3d4757]"
                      >
                        {/* 병합 칸 세로 가운데(엑셀 병합 셀과 같은 모양). 2026-10-20 담당자: 맨 위에 붙어 보기 힘들었다. */}
                        {q.stage}
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
              walla={wallaInfo(selected)}
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

function QuestionPanel({ q, number, walla, stages, earlier, numbers, canUp, canDown, onChange, onMove, onRemove, onInsert, onClose }: {
  q: SurveyQuestion; number: string; walla: { label: string; todos: string[] }; stages: string[]; earlier: SurveyQuestion[]; numbers: Map<string, string>;
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

        {/* txt로 넘어가지 않는 설정 — 문항에서 바로 보이게(2026-10-06 담당자 요청). 문항 내용에서 계산하므로 고치면 바로 바뀐다. */}
        {walla.todos.length > 0 && (
          <div className="rounded-lg border border-[#e3e8ef] bg-[#f8fafc] px-3 py-2.5">
            <p className="text-[12px] font-semibold text-[#6b778a]">
              WALLA에서 직접 할 일 <span className="font-normal text-[#94a0b2]">· WALLA 필드 {walla.label}</span>
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] leading-[1.5] text-[#1d2433]">
              {walla.todos.map((todo) => (
                <li key={todo} className="flex gap-2"><span className="text-[#94a0b2]">☐</span><span>{todo}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** 파일 내려받기 묶음 — 같은 무게의 버튼 네 개를 나열하지 않고 한 메뉴에 이름과 쓰임을 함께 적는다. */
function DownloadMenu({ items, disabled }: { items: { label: string; hint: string; run: () => void }[]; disabled: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-[#dfe4ec] bg-white px-4 py-2 text-sm font-semibold text-[#1d2433] hover:bg-[#f6f8fb] [&::-webkit-details-marker]:hidden">
        설문 파일 내려받기 <span aria-hidden className="text-[#94a0b2]">▾</span>
      </summary>
      <ul className="absolute left-0 z-30 mt-1 w-[320px] overflow-hidden rounded-xl border border-[#e3e7ee] bg-white py-1 shadow-[0_10px_30px_rgba(31,48,78,0.15)]">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => { item.run(); if (ref.current) ref.current.open = false; }}
              className="block w-full px-4 py-2.5 text-left hover:bg-[#f6f8fb] disabled:opacity-50"
            >
              <span className="block text-[14px] font-semibold text-[#1d2433]">{item.label}</span>
              <span className="block text-[12px] text-[#94a0b2]">{item.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
