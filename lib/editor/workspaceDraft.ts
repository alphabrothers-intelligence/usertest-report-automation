import { withDefaultQuadrantZones, type ReportBlock, type ReportSectionContent } from "@/lib/report/sections";

export const STORAGE_KEY = "usertest-report-studio-v3";

export type SavedDraft = {
  /** 어느 보고서의 초안인지 구분 — 다른 보고서를 열었을 때 잘못된 초안을 불러오지 않기 위함. */
  sourceFileUrl: string | null;
  sections: ReportSectionContent[];
  savedAt: string;
};

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
export function hydrateWorkspaceSections(sections: ReportSectionContent[]): ReportSectionContent[] {
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

/** 데모(source 없이 진입)는 실제 DB report 행이 없어 서버에 저장할 대상이 없다 — 이 경우에만
 * 예전처럼 localStorage를 계속 쓴다. 실제 보고서(sourceFileUrl 있음)는 아래
 * loadServerDraft/saveServerDraft가 대신한다. */
export function loadSavedDraft(sourceFileUrl: string | null): SavedDraft | null {
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

