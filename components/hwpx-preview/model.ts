import type { ReportWorkspaceSeed } from "@/lib/report/workspace";

export type WorkspaceResponse = {
  ok: boolean;
  error?: string;
  workspace?: ReportWorkspaceSeed;
  reportName?: string | null;
};

export type PatchPreview = {
  patches: unknown[];
  unsupportedEditKeys: string[];
};

export const PREVIEW_NAVIGATION = [
  ["표지", "preview-page-0"],
  ["목차", "preview-page-1"],
  ["Ⅰ. 개요", "preview-section-I"],
  ["Ⅱ. 인적 사항 및 특성 조사", "preview-section-II"],
  ["Ⅲ. 기능별 고객 경험 평가", "preview-feature-0"],
  ["Ⅲ.2 기능별 종합 해석", "preview-analysis"],
  ["Ⅳ. 핵심구매요소", "preview-section-IV"],
  ["Ⅴ. 4대 가치 만족도", "preview-section-V"],
  ["Ⅵ. 사용자 경험 품질 평가", "preview-section-VI"],
  ["Ⅶ. 교차 분석", "preview-section-VII"],
  ["Ⅷ. 종합 만족도 및 NPS 지수", "preview-section-VIII"],
  ["Ⅸ. 종합 결과 및 제언", "preview-conclusion"],
] as const;

export function findHtml(workspace: ReportWorkspaceSeed, blockId: string): string {
  const block = workspace.sections
    .flatMap((section) => section.blocks)
    .find((item) => item.id === blockId);
  return block && (block.kind === "text" || block.kind === "rich-static") ? block.html : "";
}

export function keywordCandidates(detailHtml: string): string[] {
  const labels = [...detailHtml.matchAll(/\[\s*([^\]\n]{2,42})\s*\]/g)]
    .map((match) => match[1].trim())
    .filter((label) => !/긍정|부정|중립|인용문|원문/.test(label));
  return [...new Set(labels)].slice(0, 8);
}
