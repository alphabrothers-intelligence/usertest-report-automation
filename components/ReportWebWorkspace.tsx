"use client";

import type { Dispatch, SetStateAction } from "react";
import { ReportWebDocument } from "@/components/ReportWebDocument";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportSectionContent } from "@/lib/report/sections";
import type { ProductInfo } from "@/lib/productInfo/types";

type ReportWebWorkspaceProps = {
  sections: ReportSectionContent[];
  setSections: Dispatch<SetStateAction<ReportSectionContent[]>>;
  checkpoint: () => void;
  workspaceStatus: "idle" | "loading" | "ready" | "error";
  reportData: ReportWorkspaceSeed | null;
  activeSection: string;
  onActiveSectionChange: (numeral: string) => void;
  workspaceError?: string | null;
  onRetry: () => void;
  sourceFileUrl?: string | null;
  onToolbarActionsChange?: (actions: { copy: () => void; openCorrections: () => void }) => void;
  productInfo: ProductInfo;
  onProductInfoChange: (next: ProductInfo) => void;
};

/**
 * 웹 편집 진입점. `ReportWebDocument`로의 순수 전달 래퍼(로직 없음) — 목차 클릭 네비게이션과
 * 실제 QuantStats 기반 섹션 콘텐츠 렌더링은 전부 `ReportWebDocument.tsx`가 담당한다
 * (2026-07-25 재구성, PRD 3.3).
 */
export function ReportWebWorkspace({
  sections,
  setSections,
  checkpoint,
  workspaceStatus,
  reportData,
  activeSection,
  onActiveSectionChange,
  workspaceError,
  onRetry,
  sourceFileUrl,
  onToolbarActionsChange,
  productInfo,
  onProductInfoChange,
}: ReportWebWorkspaceProps) {
  return (
    <div data-workspace-status={workspaceStatus}>
      <ReportWebDocument
        sections={sections}
        setSections={setSections}
        checkpoint={checkpoint}
        reportData={reportData}
        activeSection={activeSection}
        onActiveSectionChange={onActiveSectionChange}
        workspaceStatus={workspaceStatus}
        workspaceError={workspaceError}
        onRetry={onRetry}
        sourceFileUrl={sourceFileUrl}
        onToolbarActionsChange={onToolbarActionsChange}
        productInfo={productInfo}
        onProductInfoChange={onProductInfoChange}
      />
    </div>
  );
}
