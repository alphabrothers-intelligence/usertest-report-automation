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
import { withDefaultQuadrantZones, type ReportBlock, type ReportSectionContent } from "@/lib/report/sections";
import { ReportWebWorkspace } from "@/components/ReportWebWorkspace";
import { applyTextFormat, insertArrowLine, FormatButton, FormatGlyph, SidebarIcon, UndoIcon } from "@/components/report-web-document/ReportBlockView";
import type { ProductInfo } from "@/lib/productInfo/types";
import type { ReviewFlag } from "@/lib/quant/reviewFlags";
import { useQualitativeJob } from "@/components/wizard/useQualitativeJob";
import { QualitativeArrivalBanner } from "@/components/report/QualitativeArrivalBanner";

const STORAGE_KEY = "usertest-report-studio-v3";

type SavedDraft = {
  /** 어느 보고서의 초안인지 구분 — 다른 보고서를 열었을 때 잘못된 초안을 불러오지 않기 위함. */
  sourceFileUrl: string | null;
  sections: ReportSectionContent[];
  savedAt: string;
};

type DraftSnapshot = { sections: ReportSectionContent[] };

/** 저장된 구버전 초안은 카테고리마다 원문 그룹이 하나씩이었다. 현재 UX의 검토 단위인
 * 긍정/부정/중립 의견 묶음으로 승격해, 새로 분석을 돌리지 않아도 왼쪽 근거 패널이 큰
 * 분석 블록 단위로 동작하게 한다. */
function upgradeLegacyQuoteGroups(html: string): string {
  if (typeof window === "undefined" || !html.includes("data-quote-group")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const banner of Array.from(doc.body.querySelectorAll<HTMLElement>("p"))) {
    const match = banner.textContent?.trim().match(/^\d+\.\s*(긍정|부정|중립)\s*의견/);
    if (!match || !banner.parentElement) continue;
    const label = `${match[1]} 의견`;
    const siblings = Array.from(banner.parentElement.children);
    const start = siblings.indexOf(banner) + 1;
    const categoryNodes: HTMLElement[] = [];
    for (let index = start; index < siblings.length; index += 1) {
      const sibling = siblings[index] as HTMLElement;
      if (sibling.tagName === "P" && /^\d+\.\s*(긍정|부정|중립)\s*의견/.test(sibling.textContent?.trim() ?? "")) break;
      if (sibling.matches("[data-quote-group]")) categoryNodes.push(sibling);
    }
    if (categoryNodes.length === 0) continue;
    const firstMarker = categoryNodes[0].querySelector<HTMLElement>("[data-quote-group-source]");
    if (!firstMarker?.dataset.quoteGroupSource) continue;
    if (decodeURIComponent(firstMarker.dataset.quoteGroupLabel ?? "") === label) continue;
    const wrapper = doc.createElement("div");
    wrapper.setAttribute("data-quote-group", "");
    const marker = doc.createElement("span");
    marker.hidden = true;
    marker.setAttribute("data-copy-ignore", "");
    marker.setAttribute("data-quote-group-source", firstMarker.dataset.quoteGroupSource);
    marker.setAttribute("data-quote-group-label", encodeURIComponent(label));
    wrapper.appendChild(marker);
    categoryNodes[0].before(wrapper);
    for (const categoryNode of categoryNodes) {
      categoryNode.removeAttribute("data-quote-group");
      categoryNode.querySelectorAll("[data-quote-group-source]").forEach((node) => node.remove());
      wrapper.appendChild(categoryNode);
    }
  }
  return doc.body.innerHTML;
}

function upgradeLegacyAnalysisEvidence(block: ReportSectionContent["blocks"][number]): ReportSectionContent["blocks"][number] {
  if ((block.kind !== "text" && block.kind !== "rich-static") || block.html.includes("data-analysis-evidence")) return block;
  const labels: Record<string, string> = {
    "feature-analysis-summary": "기능별 중요 순위 및 만족도 종합 해석",
    "four-values-analysis-summary": "4대 가치 만족도 종합 해석",
  };
  const label = labels[block.id];
  if (!label) return block;
  return { ...block, html: `<div data-analysis-evidence data-analysis-label="${encodeURIComponent(label)}">${block.html}</div>` };
}

/** 이전 브라우저 초안을 현재 블록 계약으로 안전하게 승격한다. */
function hydrateWorkspaceSections(sections: ReportSectionContent[]): ReportSectionContent[] {
  return sections.map((section) => ({
    ...section,
    // 2026-07-28: 원본에 없는 "긍정·부정·중립" 가로 막대 카드가 과거 로컬 초안에 남아
    // 있어도 새 웹 양식을 덮어쓰지 않도록 복원 시 제거한다. 정성 본문/표는 그대로 보존한다.
    blocks: section.blocks
      .filter((block) => block.kind !== "polarity")
      .map(hydrateWorkspaceBlock),
  }));
}

/** row-group(항목/주요 의견 표의 한 행)은 자식 블록에도 같은 승격 규칙을 재귀 적용한다 —
 * 그 안에 quadrant·rich-static이 중첩될 수 있어서(workspaceConclusion.ts 참고). */
function hydrateWorkspaceBlock(block: ReportBlock): ReportBlock {
  if (block.kind === "quadrant") return withDefaultQuadrantZones(block);
  if (block.kind === "text" || block.kind === "rich-static") {
    const withGroupedQuotes = { ...block, html: upgradeLegacyQuoteGroups(block.html) };
    return upgradeLegacyAnalysisEvidence(withGroupedQuotes);
  }
  if (block.kind === "row-group") {
    return { ...block, rows: block.rows.map((row) => ({ ...row, blocks: row.blocks.filter((child) => child.kind !== "polarity").map(hydrateWorkspaceBlock) })) };
  }
  return block;
}

function withInlinePdf(url?: string | null) {
  if (!url) return null;
  return `${url}${url.includes("?") ? "&" : "?"}inline=1`;
}

/** 데모(source 없이 진입)는 실제 DB report 행이 없어 서버에 저장할 대상이 없다 — 이 경우에만
 * 예전처럼 localStorage를 계속 쓴다. 실제 보고서(sourceFileUrl 있음)는 아래
 * loadServerDraft/saveServerDraft가 대신한다. */
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

function formatSavedAt(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString("ko-KR") : null;
}

export function ReportStudio({
  pdfUrl,
  sourceFileUrl,
  initialSection,
  demo = false,
  demoDataset,
  qualitativeJobId,
}: {
  pdfUrl?: string | null;
  /** raw data URL. 저장된 정량 결과를 웹 편집 화면에 불러오는 키다. */
  sourceFileUrl?: string | null;
  /** ?section= 쿼리로 넘어온 초기 활성 섹션(공유 링크·새로고침 유지용). */
  initialSection?: string | null;
  /** source가 없는 직접 진입에서 리바랩스 정량 예시를 표시한다. */
  demo?: boolean;
  /** ?dataset= 로 고른 예시 raw data(리바랩스 외 4종). 없으면 리바랩스. */
  demoDataset?: string | null;
  /** 아직 돌고 있는 정성 분석 job(`?job=`). **이 화면이 그 job의 진행 드라이버가 된다** —
   * run-next 는 클라이언트가 시켜야 진행되므로, 여기서 안 돌리면 분석이 멈춘다. */
  qualitativeJobId?: string | null;
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
  const [reviewFlags, setReviewFlags] = useState<ReviewFlag[]>([]);
  const [productInfo, setProductInfo] = useState<ProductInfo>({});
  const [reportName, setReportName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"hwpx" | null>(null);
  // 텍스트 서식·전체 복사·인용문 검토 버튼(2026-08-12, 헤더로 이전) — activeSection이
  // 바뀔 때마다 ReportWebDocument가 최신 핸들러로 갱신해준다.
  const [toolbarActions, setToolbarActions] = useState<{ copy: () => void; openCorrections: () => void; toggleToc: () => void; tocOpen: boolean } | null>(null);
  const inlinePdfUrl = useMemo(() => withInlinePdf(pdfUrl), [pdfUrl]);

  useEffect(() => {
    if (!sourceFileUrl && !demo) return;
    let cancelled = false;
    const workspaceUrl = sourceFileUrl
      ? `/api/report-workspace?source=${encodeURIComponent(sourceFileUrl)}`
      : `/api/report-workspace/demo${demoDataset ? `?dataset=${encodeURIComponent(demoDataset)}` : ""}`;
    // 예시마다 편집 초안을 따로 둔다 — 한 키를 공유하면 케어클 화면에 리바랩스 초안이 덮인다.
    const draftKey = sourceFileUrl ?? (demo ? `__demo-${demoDataset ?? "rivalabs"}__` : null);
    void fetch(workspaceUrl, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          ok: boolean;
          error?: string;
          workspace?: ReportWorkspaceSeed;
          reportName?: string | null;
          savedDraft?: { sections: ReportSectionContent[]; savedAt: string | null } | null;
          reviewFlags?: ReviewFlag[];
        };
        if (!response.ok || !payload.ok || !payload.workspace) {
          throw new Error(payload.error || "보고서 작업공간을 불러오지 못했습니다.");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled || !payload.workspace) return;
        const seed = payload.workspace;
        setWorkspaceSeed(seed);
        setReviewFlags(payload.reviewFlags ?? []);
        setProductInfo(seed.productInfo ?? {});
        setReportName(payload.reportName ?? "");
        // 이 특정 보고서(source)를 이전에 편집·저장한 적이 있으면 서버가 방금 계산한 정량
        // 데이터 대신 저장된 편집본을 우선한다 — 없으면 서버 데이터 그대로 시작한다.
        // 실제 보고서(sourceFileUrl)는 서버 초안(payload.savedDraft)을, 데모는 예전처럼
        // localStorage를 쓴다(데모는 DB report 행이 없어 서버에 저장할 대상이 없음).
        const draft = sourceFileUrl
          ? (payload.savedDraft ? { sourceFileUrl, sections: payload.savedDraft.sections, savedAt: formatSavedAt(payload.savedDraft.savedAt) ?? "" } : null)
          : loadSavedDraft(draftKey);
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
  }, [sourceFileUrl, demo, demoDataset, reloadNonce]);

  // ── 뒤에서 도는 의견(정성) 분석 ────────────────────────────────────────────────
  // **이 화면이 그 job 의 진행 드라이버다.** run-next 는 서버가 알아서 도는 배치가 아니라
  // 클라이언트가 문항 하나씩 시켜야 진행되므로, 여기서 훅을 돌리지 않으면 보고서를 여는
  // 순간 분석이 멈춘다(2026-08-31 새 흐름의 전제).
  const job = useQualitativeJob(qualitativeJobId ?? null);
  const [applyingQualitative, setApplyingQualitative] = useState(false);
  const [qualitativeApplied, setQualitativeApplied] = useState(false);
  const [retryingQualitative, setRetryingQualitative] = useState(false);

  /** 빠진 문항만 다시 큐에 넣는다. 워커 루프가 알아서 집어가므로 여기서는 상태만 되돌린다. */
  async function retryFailedQualitative() {
    if (!qualitativeJobId) return;
    setRetryingQualitative(true);
    try {
      const response = await fetch(`/api/qualitative-jobs/${qualitativeJobId}/retry-failed`, { method: "POST" });
      const payload = await response.json() as { ok: boolean; error?: string };
      if (!payload.ok) throw new Error(payload.error || "빠진 문항을 다시 시작하지 못했습니다.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "빠진 문항을 다시 시작하지 못했습니다.");
    } finally {
      setRetryingQualitative(false);
    }
  }


  /**
   * 도착한 의견 분석을 **비어 있는 자리에만** 채운다.
   *
   * 통째로 새로 불러오면 그 사이 담당자가 고친 내용이 날아간다. 그렇다고 자동 병합을 하면
   * 어디가 바뀌었는지 알 수 없다. 그래서 기준을 하나로 잡았다 — **"정성 분석 대기" 블록이
   * 들어 있는 장만** 새 것으로 바꾼다. 그 장은 아직 채울 내용이 없어 편집할 것도 없었다.
   */
  async function applyQualitative() {
    if (!sourceFileUrl) return;
    setApplyingQualitative(true);
    try {
      const response = await fetch(`/api/report-workspace?source=${encodeURIComponent(sourceFileUrl)}`, { cache: "no-store" });
      const payload = await response.json() as { ok: boolean; error?: string; workspace?: ReportWorkspaceSeed };
      if (!payload.ok || !payload.workspace) throw new Error(payload.error || "분석 결과를 불러오지 못했습니다.");
      const fresh = payload.workspace;
      setWorkspaceSeed(fresh);
      setSections((current) => {
        const next = current.map((section) => {
          const waiting = section.blocks.some((block) => block.kind === "text" && block.pending);
          if (!waiting) return section;
          const replacement = fresh.sections.find((candidate) => candidate.numeral === section.numeral);
          return replacement ? hydrateWorkspaceSections([replacement])[0] : section;
        });
        return next;
      });
      setQualitativeApplied(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "분석 결과를 반영하지 못했습니다.");
    } finally {
      setApplyingQualitative(false);
    }
  }

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

  /** 실제 보고서(sourceFileUrl)는 서버 DB에 저장한다(2026-08-04 신규 — 다른 기기·브라우저에서도
   * 이어서 편집할 수 있게). 데모는 저장할 DB report 행이 없어 그대로 localStorage를 쓴다. */
  async function saveDraft() {
    setDraftSaving(true);
    setSaveError(null);
    try {
      if (sourceFileUrl) {
        if (productInfo.companyName?.trim() && productInfo.serviceName?.trim()) {
          const productResponse = await fetch("/api/wizard/product-info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileUrl: sourceFileUrl, ...productInfo }),
          });
          if (!productResponse.ok) throw new Error("표지 정보를 저장하지 못했습니다.");
        }
        const res = await fetch("/api/report-workspace/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: sourceFileUrl, sections }),
        });
        const payload = await res.json() as { ok: boolean; savedAt?: string | null; error?: string };
        if (!res.ok || !payload.ok) throw new Error(payload.error || "초안을 저장하지 못했습니다.");
        setSavedAt(formatSavedAt(payload.savedAt ?? null) ?? new Date().toLocaleString("ko-KR"));
        return;
      }
      const savedAtValue = new Date().toLocaleString("ko-KR");
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sourceFileUrl: demo ? "__rivalabs-demo__" : null, sections, savedAt: savedAtValue } satisfies SavedDraft),
      );
      setSavedAt(savedAtValue);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "초안을 저장하지 못했습니다.");
    } finally {
      setDraftSaving(false);
    }
  }

  async function downloadHwpx() {
    if (!sourceFileUrl) return;
    setExporting("hwpx");
    setSaveError(null);
    try {
      const response = await fetch("/api/report-workspace/hwpx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceFileUrl, sections, productInfo }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "HWPX를 만들지 못했습니다.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = encodedName ? decodeURIComponent(encodedName) : "사용성테스트_결과보고서.hwpx";
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "HWPX를 만들지 못했습니다.");
    } finally {
      setExporting(null);
    }
  }

  async function resetWorkspaceDraft() {
    if (sourceFileUrl) {
      await fetch("/api/report-workspace/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: sourceFileUrl, sections: null }),
      });
    } else {
      const draftKey = demo ? "__rivalabs-demo__" : null;
      // 현재 저장 구조는 하나의 키 안에 sourceFileUrl을 함께 보관한다.
      // 다른 보고서의 초안을 지우지 않도록 현재 초안일 때만 삭제한다.
      if (draftKey && loadSavedDraft(draftKey)) window.localStorage.removeItem(STORAGE_KEY);
    }
    // **실측 버그(2026-07-28) 수정**: 예전엔 여기서 setSections(workspaceSeed.sections)로
    // 메모리에 있는 seed로 되돌렸는데, 이 seed는 페이지를 맨 처음 열 때 딱 한 번 fetch한
    // 스냅샷이다 — 탭을 계속 켜둔 채로 서버 데이터(정성 분석 결과 등)가 나중에 갱신되면,
    // "초안 초기화"를 눌러도 그 오래된 스냅샷으로만 되돌아가 "버튼이 아무 반응이 없다"는
    // 것처럼 보였다(사용자 실측 확인). 새로고침으로 완전히 새 요청을 보내야 최신 서버 상태를
    // 확실히 반영한다.
    window.location.reload();
  }

  /** 좌측 "저장된 보고서" 목록에 표시할 이름(2026-08-04 신규). blur 시점에만 저장해 타이핑마다
   * 요청을 보내지 않는다. 데모는 저장할 DB report 행이 없어 이름 입력을 아예 숨긴다. */
  async function saveReportName() {
    if (!sourceFileUrl) return;
    setNameSaving(true);
    try {
      await fetch("/api/report-workspace/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: sourceFileUrl, name: reportName }),
      });
    } finally {
      setNameSaving(false);
    }
  }

  /** 목차 클릭 → 활성 섹션 전환 + URL의 ?section=을 동기화(새로고침·공유 링크 유지). */
  function changeActiveSection(numeral: string) {
    setActiveSection(numeral);
    const params = new URLSearchParams(window.location.search);
    params.set("section", numeral);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <main className="min-h-screen bg-[#f4f6f9] text-[#252a34]">
      <header className="sticky top-0 z-20 bg-white shadow-[0_1px_0_rgba(35,45,65,0.1)]">
        <div className="mx-auto flex min-h-[68px] max-w-[2000px] items-center justify-between gap-4 px-5 sm:px-8">
          <div>
            <h1 className="text-[17px] font-bold tracking-[-0.02em] text-[#20242c]">Usability Report Studio</h1>
            {sourceFileUrl && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={reportName}
                  onChange={(event) => setReportName(event.target.value)}
                  onBlur={saveReportName}
                  placeholder="보고서 제목을 입력하세요 (좌측 목록에 표시됩니다)"
                  className="w-72 border-0 bg-transparent p-0 text-xs text-[#7d8796] outline-none placeholder:text-[#a4adba] focus:text-[#344054]"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {nameSaving && <span className="hidden text-xs text-[#8b95a5] md:block">이름 저장 중...</span>}
            <div className="hidden rounded-lg bg-[#f1f4f8] p-1 md:flex">
              <button type="button" onClick={() => setWorkspaceMode("web")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${workspaceMode === "web" ? "bg-white text-[#1473e6] shadow-sm" : "text-[#667085]"}`}>보고서 편집</button>
              {pdfUrl && <button type="button" onClick={() => setWorkspaceMode("pdf")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${workspaceMode === "pdf" ? "bg-white text-[#1473e6] shadow-sm" : "text-[#667085]"}`}>PDF 미리보기</button>}
            </div>
            <button type="button" onClick={() => window.print()} disabled={workspaceStatus !== "ready"} className="rounded-lg border border-[#d9e0e9] px-3 py-2 text-sm font-semibold text-[#475467] hover:bg-[#f7f9fc] disabled:opacity-50">PDF 저장</button>
            {sourceFileUrl && <button type="button" onClick={() => void downloadHwpx()} disabled={workspaceStatus !== "ready" || exporting === "hwpx"} className="rounded-lg border border-[#d9e0e9] px-3 py-2 text-sm font-semibold text-[#475467] hover:bg-[#f7f9fc] disabled:opacity-50">{exporting === "hwpx" ? "HWPX 생성 중..." : "HWPX 다운로드"}</button>}
            <Link href="/new" className="rounded-lg border border-[#d9e0e9] px-3 py-2 text-sm font-medium text-[#475467] hover:bg-[#f7f9fc]">나가기</Link>
          </div>
        </div>
        <div className="border-t border-[#e4e8ef] bg-[#f8f9fc]">
          <div className="mx-auto flex min-h-[54px] max-w-[2000px] items-center gap-2 px-5 sm:px-8">
            {workspaceMode === "web" && toolbarActions && (
              <>
                <button
                  type="button"
                  title={toolbarActions.tocOpen ? "목차 접기" : "목차 펼치기"}
                  aria-label={toolbarActions.tocOpen ? "목차 접기" : "목차 펼치기"}
                  aria-pressed={toolbarActions.tocOpen}
                  onClick={toolbarActions.toggleToc}
                  className={`flex size-9 items-center justify-center rounded-md hover:bg-white ${toolbarActions.tocOpen ? "text-[#1473e6]" : "text-[#526174]"}`}
                >
                  <SidebarIcon />
                </button>
                <span className="mx-2 h-7 w-px bg-[#dce2ea]" />
              </>
            )}
            <button type="button" title="되돌리기" aria-label="되돌리기" onClick={undo} disabled={undoStack.length === 0} className="flex size-9 items-center justify-center rounded-md text-[#526174] hover:bg-white disabled:opacity-30"><UndoIcon /></button>
            <button type="button" title="다시 실행" aria-label="다시 실행" onClick={redo} disabled={redoStack.length === 0} className="flex size-9 items-center justify-center rounded-md text-[#526174] hover:bg-white disabled:opacity-30"><UndoIcon flip /></button>
            <span className="mx-2 h-7 w-px bg-[#dce2ea]" />
            {workspaceMode === "web" && toolbarActions && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <FormatButton label={<FormatGlyph variant="bold" />} title="굵게" onApply={() => applyTextFormat("bold")} />
                  <FormatButton label={<FormatGlyph variant="italic" />} title="기울임" onApply={() => applyTextFormat("italic")} />
                  <FormatButton label={<FormatGlyph variant="underline" />} title="밑줄" onApply={() => applyTextFormat("underline")} />
                  <FormatButton label={<span className="text-[15px]">→</span>} title="제언 화살표 문단 추가" onApply={insertArrowLine} />
                </div>
                <span className="mx-2 h-7 w-px bg-[#dce2ea]" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={toolbarActions.copy} className="rounded border border-[#d7dce8] px-2.5 py-1.5 text-sm font-semibold text-[#315f9d] hover:bg-[#f2f7ff]">내용 전체 복사하기</button>
                  <button type="button" onClick={toolbarActions.openCorrections} className="rounded border border-[#d7dce8] px-2.5 py-1.5 text-sm font-semibold text-[#315f9d] hover:bg-[#f2f7ff]">인용문 일괄 검토</button>
                </div>
                <span className="mx-2 h-7 w-px bg-[#dce2ea]" />
              </>
            )}
            <span className={`hidden text-xs md:block ${saveError ? "text-[#b54747]" : "text-[#8a94a3]"}`}>{saveError ?? (savedAt ? `저장됨 · ${savedAt}` : "수정 내용을 저장할 수 있습니다")}</span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={resetWorkspaceDraft} className="rounded-lg px-3 py-2 text-xs font-semibold text-[#667085] hover:bg-white">초기화</button>
              <button type="button" onClick={() => void saveDraft()} disabled={draftSaving} className="rounded-lg bg-[#1473e6] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0f65cf] disabled:opacity-60">{draftSaving ? "저장 중..." : "변경사항 저장"}</button>
            </div>
          </div>
        </div>
      </header>

      {qualitativeJobId && (
        <QualitativeArrivalBanner
          status={job.status}
          done={job.done}
          total={job.total}
          isFinished={job.isFinished}
          isSuccessful={job.isSuccessful}
          isIncomplete={job.isIncomplete}
          failed={job.failed}
          networkNotice={job.networkNotice}
          applying={applyingQualitative}
          applied={qualitativeApplied}
          retrying={retryingQualitative}
          onApply={() => void applyQualitative()}
          onRetryFailed={() => void retryFailedQualitative()}
        />
      )}

      {workspaceMode === "web" ? (
        <ReportWebWorkspace
          sections={sections}
          setSections={setSections}
          checkpoint={checkpoint}
          workspaceStatus={workspaceStatus}
          reportData={workspaceSeed}
          reviewFlags={reviewFlags}
          productInfo={productInfo}
          onProductInfoChange={setProductInfo}
          activeSection={activeSection}
          onActiveSectionChange={changeActiveSection}
          onRetry={retryWorkspaceLoad}
          sourceFileUrl={sourceFileUrl}
          workspaceError={workspaceError}
          onToolbarActionsChange={setToolbarActions}
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
