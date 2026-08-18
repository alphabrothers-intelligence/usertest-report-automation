import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportBlock } from "@/lib/report/sections";

export type WorkspaceResponse = {
  ok: boolean;
  error?: string;
  workspace?: ReportWorkspaceSeed;
  reportName?: string | null;
};

export type HwpxPreviewReportOption = {
  fileUrl: string;
  label: string;
};

export type PatchPreview = {
  patches: unknown[];
  unsupportedEditKeys: string[];
};

/**
 * 브라우저에서 바뀐 문서 값의 최소 영속 단위.
 *
 * 이 값은 원본 분석 DB를 바꾸지 않는, /hwpx-preview 전용 편집 오버레이이다.
 * HWPX로 실제 내보낼 수 있는지는 아래 슬롯 상태를 통해 별도로 판단한다.
 */
export type HwpxPreviewDocument = {
  version: 1;
  source: string;
  updatedAt: string;
  edits: Record<string, string>;
};

export type HwpxEditMapping = "mapped" | "web-only";

/**
 * 현재 리바랩스 원본 HWPX의 문단 위치가 확정된 웹 편집 키만 true이다.
 * 서버의 buildRivalabsSwWebEditPatches와 반드시 같은 범위를 유지한다.
 */
export function hwpxEditMapping(editKey: string): HwpxEditMapping {
  if (editKey === "cover:company" || editKey === "cover:service") return "mapped";
  if (/^feature:.+:(mean|sd)$/.test(editKey)) return "mapped";
  return "web-only";
}

export function summarizeHwpxEditMappings(edits: Record<string, string>) {
  return Object.keys(edits).reduce(
    (summary, editKey) => {
      summary[hwpxEditMapping(editKey)] += 1;
      return summary;
    },
    { mapped: 0, "web-only": 0 } satisfies Record<HwpxEditMapping, number>,
  );
}

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
  const block = findBlock(workspace, blockId);
  return block && (block.kind === "text" || block.kind === "rich-static") ? block.html : "";
}

/** 저장된 작업공간의 블록을 ID로 찾는다. HWPX 미리보기는 데이터를 복제하지 않고,
 * 기존 보고서 화면과 같은 ReportBlock을 차트 컴포넌트에 그대로 전달한다. */
export function findBlock(workspace: ReportWorkspaceSeed, blockId: string): ReportBlock | undefined {
  const findInBlocks = (blocks: ReportBlock[]): ReportBlock | undefined => {
    for (const block of blocks) {
      if (block.id === blockId) return block;
      // Ⅸ장 요약표처럼 표의 셀 안에 다시 ReportBlock을 넣는 경우도 같은 조회 경로로 찾는다.
      if (block.kind === "row-group") {
        const nested = findInBlocks(block.rows.flatMap((row) => row.blocks));
        if (nested) return nested;
      }
    }
    return undefined;
  };

  return findInBlocks(workspace.sections.flatMap((section) => section.blocks));
}
