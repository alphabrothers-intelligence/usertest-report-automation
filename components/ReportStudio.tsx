"use client";

/**
 * 보고서 웹 작업공간의 최상위 상태 컨테이너 (2026-07-25 재구성, PRD 3.3).
 *
 * 예전엔 좌표로 박아둔 7개 고정 `EditableBlock` + 별도 단일 `chart` 상태였다 — 이제
 * `sections: ReportSectionContent[]`(Ⅰ~Ⅸ, 각 섹션이 실제 QuantStats로 채운 차트/표/글
 * 블록 목록) 하나로 통일한다. "PDF 확인" 모드의 좌표-오버레이 편집 UI도 새 블록 모델과
 * 맞지 않아 제거하고, PRD 3.3 "PDF 뷰어는 최종 확인용 보조 화면"에 맞춰 읽기 전용 미리보기
 * iframe만 남긴다.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import { withDefaultQuadrantZones, type ReportSectionContent } from "@/lib/report/sections";
import { ReportWebWorkspace } from "@/components/ReportWebWorkspace";

const STORAGE_KEY = "usertest-report-studio-v3";

type SavedDraft = {
  /** 어느 보고서의 초안인지 구분 — 다른 보고서를 열었을 때 잘못된 초안을 불러오지 않기 위함. */
  sourceFileUrl: string | null;
  sections: ReportSectionContent[];
  savedAt: string;
};

type DraftSnapshot = { sections: ReportSectionContent[] };

/** 이전 브라우저 초안을 현재 블록 계약으로 안전하게 승격한다. */
function hydrateWorkspaceSections(sections: ReportSectionContent[]): ReportSectionContent[] {
  return sections.map((section) => ({
    ...section,
    // 2026-07-28: 원본에 없는 "긍정·부정·중립" 가로 막대 카드가 과거 로컬 초안에 남아
    // 있어도 새 웹 양식을 덮어쓰지 않도록 복원 시 제거한다. 정성 본문/표는 그대로 보존한다.
    blocks: section.blocks
      .filter((block) => block.kind !== "polarity")
      .map((block) => block.kind === "quadrant" ? withDefaultQuadrantZones(block) : block),
  }));
}

function withInlinePdf(url?: string | null) {
  if (!url) return null;
  return `${url}${url.includes("?") ? "&" : "?"}inline=1`;
}

function loadSavedDraft(sourceFileUrl: string | null): SavedDraft | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const draft = JSON.parse(stored) as SavedDraft;
    return draft.sourceFileUrl === sourceFileUrl ? draft : null;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function ReportStudio({
  pdfUrl,
  sourceFileUrl,
  initialSection,
  demo = false,
}: {
  pdfUrl?: string | null;
  /** raw data URL. 저장된 정량 결과를 웹 편집 화면에 불러오는 키다. */
  sourceFileUrl?: string | null;
  /** ?section= 쿼리로 넘어온 초기 활성 섹션(공유 링크·새로고침 유지용). */
  initialSection?: string | null;
  /** source가 없는 직접 진입에서 리바랩스 정량 예시를 표시한다. */
  demo?: boolean;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<ReportSectionContent[]>([]);
  const [activeSection, setActiveSection] = useState(initialSection || "I");
  // 이 화면의 주 목적은 "생성 결과를 읽고, 필요한 표·차트·문장을 고쳐 복사하는 것"이다.
  // 따라서 PDF가 존재하더라도 첫 진입은 웹 문서로 연다. 실제 발행본이 필요할 때만 사용자가
  // `발행 PDF` 탭으로 전환한다. 이전처럼 PDF를 기본값으로 두면, 사용자는 편집 가능한 보고서가
  // 없는 것처럼 느끼고 별도 전환을 해야 했다.
  const [workspaceMode, setWorkspaceMode] = useState<"web" | "pdf">("web");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<DraftSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DraftSnapshot[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<"idle" | "loading" | "ready" | "error">(sourceFileUrl || demo ? "loading" : "idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [workspaceSeed, setWorkspaceSeed] = useState<ReportWorkspaceSeed | null>(null);
  const inlinePdfUrl = useMemo(() => withInlinePdf(pdfUrl), [pdfUrl]);

  useEffect(() => {
    if (!sourceFileUrl && !demo) return;
    let cancelled = false;
    const workspaceUrl = sourceFileUrl
      ? `/api/report-workspace?source=${encodeURIComponent(sourceFileUrl)}`
      : "/api/report-workspace/demo";
    const draftKey = sourceFileUrl ?? (demo ? "__rivalabs-demo__" : null);
    void fetch(workspaceUrl, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { ok: boolean; error?: string; workspace?: ReportWorkspaceSeed };
        if (!response.ok || !payload.ok || !payload.workspace) {
          throw new Error(payload.error || "보고서 작업공간을 불러오지 못했습니다.");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled || !payload.workspace) return;
        const seed = payload.workspace;
        setWorkspaceSeed(seed);
        // 이 특정 보고서(source)를 이전에 편집·저장한 적이 있으면 서버가 방금 계산한 정량
        // 데이터 대신 저장된 편집본을 우선한다 — 없으면 서버 데이터 그대로 시작한다.
        const draft = loadSavedDraft(draftKey);
        // 과거 빈 초안이 새 예시/생성본을 통째로 덮어 "내용이 하나도 안 보이는" 상황을
        // 막는다. 실제 블록이 하나라도 있는 초안만 복원하고, 빈 초안은 최신 서버 시드로
        // 안전하게 되돌린다.
        const usableDraft = draft && draft.sections.some((section) => section.blocks.length > 0) ? draft : null;
        setSections(hydrateWorkspaceSections(usableDraft?.sections ?? seed.sections));
        if (usableDraft) setSavedAt(usableDraft.savedAt);
        setWorkspaceStatus("ready");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWorkspaceStatus("error");
          setWorkspaceError(error instanceof Error ? error.message : "보고서 작업공간을 불러오지 못했습니다.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceFileUrl, demo, reloadNonce]);

  function retryWorkspaceLoad() {
    setWorkspaceStatus("loading");
    setWorkspaceError(null);
    setReloadNonce((value) => value + 1);
  }

  function snapshot(): DraftSnapshot {
    return { sections: JSON.parse(JSON.stringify(sections)) as ReportSectionContent[] };
  }

  /** 한 번의 사용자 편집 직전 상태만 최대 30개 보관한다. */
  function checkpoint() {
    const before = snapshot();
    setUndoStack((items) => [...items, before].slice(-30));
    setRedoStack([]);
  }

  function restore(state: DraftSnapshot) {
    setSections(state.sections);
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = snapshot();
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [...items, current].slice(-30));
    restore(previous);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    const current = snapshot();
    setRedoStack((items) => items.slice(0, -1));
    setUndoStack((items) => [...items, current].slice(-30));
    restore(next);
  }

  function saveDraft() {
    const savedAtValue = new Date().toLocaleString("ko-KR");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sourceFileUrl: sourceFileUrl ?? (demo ? "__rivalabs-demo__" : null), sections, savedAt: savedAtValue } satisfies SavedDraft),
    );
    setSavedAt(savedAtValue);
  }

  function resetWorkspaceDraft() {
    const draftKey = sourceFileUrl ?? (demo ? "__rivalabs-demo__" : null);
    // 현재 저장 구조는 하나의 키 안에 sourceFileUrl을 함께 보관한다.
    // 다른 보고서의 초안을 지우지 않도록 현재 초안일 때만 삭제한다.
    if (draftKey && loadSavedDraft(draftKey)) window.localStorage.removeItem(STORAGE_KEY);
    // **실측 버그(2026-07-28) 수정**: 예전엔 여기서 setSections(workspaceSeed.sections)로
    // 메모리에 있는 seed로 되돌렸는데, 이 seed는 페이지를 맨 처음 열 때 딱 한 번 fetch한
    // 스냅샷이다 — 탭을 계속 켜둔 채로 서버 데이터(정성 분석 결과 등)가 나중에 갱신되면,
    // "초안 초기화"를 눌러도 그 오래된 스냅샷으로만 되돌아가 "버튼이 아무 반응이 없다"는
    // 것처럼 보였다(사용자 실측 확인). 새로고침으로 완전히 새 요청을 보내야 최신 서버 상태를
    // 확실히 반영한다.
    window.location.reload();
  }

  /** 목차 클릭 → 활성 섹션 전환 + URL의 ?section=을 동기화(새로고침·공유 링크 유지). */
  function changeActiveSection(numeral: string) {
    setActiveSection(numeral);
    const params = new URLSearchParams(window.location.search);
    params.set("section", numeral);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <main className="min-h-screen bg-[#f7f6f2] text-[#302b27]">
      <header className="sticky top-0 z-20 border-b border-[#dfdbd2] bg-[#fffdf9] px-4 py-3 shadow-[0_2px_16px_rgba(69,58,45,0.06)] sm:px-6">
        <div className="mx-auto flex max-w-[1900px] items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-[#d97757]">ALPHABROTHERS REPORT STUDIO</p>
            <h1 className="text-base font-bold sm:text-lg">사용성 테스트 결과보고서 편집 뷰어</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-lg border border-[#d8d1c6] bg-[#f5f1e9] p-0.5 md:flex">
              <button type="button" onClick={() => setWorkspaceMode("web")} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${workspaceMode === "web" ? "bg-white text-[#315c9c] shadow-sm" : "text-[#81786e]"}`}>웹 문서·편집</button>
              {pdfUrl && <button type="button" onClick={() => setWorkspaceMode("pdf")} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${workspaceMode === "pdf" ? "bg-white text-[#315c9c] shadow-sm" : "text-[#81786e]"}`}>발행 PDF</button>}
            </div>
            <span className="hidden text-xs text-[#81786e] md:block">{savedAt ? `초안 저장됨 · ${savedAt}` : "수정 후 저장하세요"}</span>
            <button type="button" onClick={undo} disabled={undoStack.length === 0} className="rounded-lg border border-[#d8d1c6] px-3 py-2 text-sm font-medium enabled:hover:bg-[#f5f1e9] disabled:cursor-not-allowed disabled:opacity-40">되돌리기</button>
            <button type="button" onClick={redo} disabled={redoStack.length === 0} className="rounded-lg border border-[#d8d1c6] px-3 py-2 text-sm font-medium enabled:hover:bg-[#f5f1e9] disabled:cursor-not-allowed disabled:opacity-40">다시 실행</button>
            <button type="button" onClick={saveDraft} className="rounded-lg bg-[#d97757] px-3 py-2 text-sm font-semibold text-white hover:bg-[#c96648]">초안 저장</button>
            <button type="button" onClick={resetWorkspaceDraft} className="rounded-lg border border-[#d8d1c6] px-3 py-2 text-sm font-medium hover:bg-[#f5f1e9]">초안 초기화</button>
            {pdfUrl && <a href={pdfUrl} className="rounded-lg border border-[#d8d1c6] px-3 py-2 text-sm font-semibold hover:bg-[#f5f1e9]">PDF 다운로드</a>}
            <Link href="/" className="rounded-lg border border-[#d8d1c6] px-3 py-2 text-sm font-medium hover:bg-[#f5f1e9]">채팅</Link>
          </div>
        </div>
      </header>

      {workspaceMode === "web" ? (
        <ReportWebWorkspace
          sections={sections}
          setSections={setSections}
          checkpoint={checkpoint}
          workspaceStatus={workspaceStatus}
          reportData={workspaceSeed}
          activeSection={activeSection}
          onActiveSectionChange={changeActiveSection}
          onRetry={retryWorkspaceLoad}
          sourceFileUrl={sourceFileUrl}
          workspaceError={workspaceError}
        />
      ) : (
        // 발행 보고서: 별도 웹 SVG를 재현한 화면이 아니라, ReportDocument.tsx가 실제로 만든
        // PDF를 그대로 쓴다. 따라서 PDF 다운로드본과 웹의 페이지/그래프/줄바꿈은 완전히 같다.
        <div className="mx-auto max-w-[1600px] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d7dce8] bg-white px-4 py-2.5 text-sm text-[#514a43]">
            <p><strong className="text-[#315c9c]">발행 보고서</strong> · 실제 PDF 렌더러 결과를 그대로 표시합니다.</p>
            <button type="button" onClick={() => setWorkspaceMode("web")} className="rounded border border-[#315c9c] px-3 py-1.5 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">이 데이터 웹에서 편집</button>
          </div>
          {inlinePdfUrl ? (
            <iframe title="발행된 사용성 테스트 결과보고서" src={inlinePdfUrl} className="h-[calc(100vh-155px)] min-h-[760px] w-full rounded-lg border border-[#d7dce8] bg-white shadow-[0_16px_38px_rgba(15,23,42,.18)]" />
          ) : (
            <div className="flex min-h-[760px] items-center justify-center rounded-lg border border-[#d7dce8] bg-white p-12 text-center text-slate-500">
              생성된 PDF가 아직 없습니다. 채팅에서 분석과 보고서 생성을 완료하면, 이 화면에 실제 발행 보고서가 표시됩니다.
            </div>
          )}
        </div>
      )}
    </main>
  );
}
