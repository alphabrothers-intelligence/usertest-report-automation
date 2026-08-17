"use client";

import { useMemo, useRef, useState } from "react";
import { findHtml, PREVIEW_NAVIGATION, type PatchPreview } from "./hwpx-preview/model";
import {
  A4Page,
  RivalabsConclusionReferencePage,
  RivalabsFeatureReferencePage,
  RivalabsSectionReferencePage,
} from "./hwpx-preview/RivalabsPreviewPages";
import { useHwpxPreviewEdits } from "./hwpx-preview/useHwpxPreviewEdits";
import { useHwpxPreviewWorkspace } from "./hwpx-preview/useHwpxPreviewWorkspace";

/**
 * HWPX 원본의 문서 언어(제목띠·표·여백)를 웹에서 검증하기 위한 독립 렌더러.
 * draft 저장이나 분석 재실행은 하지 않는다. 현재 화면에서의 직접 편집은 브라우저 안에서만
 * 유지되는 POC이며, 확정 시에만 기존 워크스페이스의 저장 모델과 연결한다.
 */
export function HwpxPreviewStudio({ sourceFileUrl }: { sourceFileUrl?: string }) {
  const { workspace, state, error } = useHwpxPreviewWorkspace(sourceFileUrl);
  const [patchPreview, setPatchPreview] = useState<PatchPreview | null>(null);
  const [patchPreviewError, setPatchPreviewError] = useState("");
  const previewRootRef = useRef<HTMLElement>(null);
  const { saveEdit, collectEdits, resetEdits } = useHwpxPreviewEdits(
    previewRootRef,
    sourceFileUrl,
    state === "ready",
  );

  const previewHwpxPatches = async () => {
    if (!sourceFileUrl) {
      setPatchPreview(null);
      setPatchPreviewError("데모 화면은 저장된 보고서 원본과 연결되어 있지 않아 HWPX 반영 목록을 만들 수 없습니다.");
      return;
    }
    const edits = collectEdits();
    try {
      const response = await fetch("/api/hwpx-preview/patches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceFileUrl, edits }),
      });
      const payload = await response.json() as { ok: boolean; error?: string; patches?: unknown[]; unsupportedEditKeys?: string[] };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "HWPX 반영 목록을 만들지 못했습니다.");
      setPatchPreview({ patches: payload.patches ?? [], unsupportedEditKeys: payload.unsupportedEditKeys ?? [] });
      setPatchPreviewError("");
    } catch (reason) {
      setPatchPreview(null);
      setPatchPreviewError(reason instanceof Error ? reason.message : "HWPX 반영 목록을 만들지 못했습니다.");
    }
  };

  const features = useMemo(() => workspace?.quantStats.featureSatisfaction ?? [], [workspace]);
  const analysisHtml = useMemo(() => workspace ? findHtml(workspace, "feature-analysis-summary") : "", [workspace]);
  const featureQuestions = useMemo(
    () => workspace?.quantStats.surveyQuestions.filter((item) => item.stage === "기능별 고객 경험 평가") ?? [],
    [workspace],
  );
  const sectionsBeforeFeatures = workspace?.sections.filter((section) => section.numeral === "I" || section.numeral === "II") ?? [];
  const sectionsAfterFeatures = workspace?.sections.filter((section) => ["IV", "V", "VI", "VII", "VIII"].includes(section.numeral)) ?? [];

  if (state === "loading") return <main className="min-h-screen bg-[#eef1f5] p-8 text-center text-sm text-slate-500">HWPX 양식 미리보기를 준비하고 있습니다.</main>;
  if (state === "error" || !workspace) return <main className="min-h-screen bg-[#eef1f5] p-8 text-center text-sm text-rose-700">{error}</main>;

  const info = workspace.productInfo;
  return (
    <main ref={previewRootRef} onInput={saveEdit} data-hwpx-preview className="min-h-screen bg-[#e9edf2] text-[#171a22]">
      <header className="hwpx-preview-toolbar sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-[#dce2e9] bg-white px-6 shadow-sm">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-[#315c9c]">HWPX TEMPLATE PREVIEW · POC</p>
          <h1 className="mt-0.5 text-base font-bold">리바랩스 원본 기반 웹 문서 미리보기</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-[#d6e0ef] bg-[#f6f9ff] px-3 py-1.5 text-xs font-semibold text-[#315c9c]">기존 /viewer와 분리됨</span>
          <button type="button" onClick={() => window.print()} className="rounded-md bg-[#315c9c] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#244b83]">PDF 인쇄 미리보기</button>
          <button type="button" onClick={() => void previewHwpxPatches()} className="rounded-md border border-[#9db6df] bg-[#eef5ff] px-3 py-1.5 text-xs font-bold text-[#315c9c] hover:bg-[#e0edff]">HWPX 반영 확인</button>
          <button type="button" onClick={resetEdits} className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-slate-50">수정 초기화</button>
        </div>
      </header>

      {(patchPreview || patchPreviewError) ? <div className="fixed right-6 top-20 z-30 w-[360px] rounded-xl border border-[#c9daf2] bg-white p-5 shadow-xl">
        <button type="button" onClick={() => { setPatchPreview(null); setPatchPreviewError(""); }} className="float-right text-lg text-slate-400">×</button>
        <p className="text-xs font-bold tracking-wide text-[#315c9c]">HWPX 반영 점검</p>
        {patchPreview ? <>
          <p className="mt-2 text-base font-bold text-slate-800">안전 반영 가능 {patchPreview.patches.length}건</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">저장된 표지·기능별 수치·정성 요약/비율·기능별 고객 제언은 원본의 확정 문단 슬롯으로 변환했습니다.</p>
          {patchPreview.unsupportedEditKeys.length > 0 ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">추가 슬롯 매핑 필요: {patchPreview.unsupportedEditKeys.length}건. 위치가 확정되기 전에는 문서에 임의 반영하지 않습니다.</p> : <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">현재 수정값은 모두 안전한 HWPX 문단 위치로 변환되었습니다.</p>}
        </> : <p className="mt-3 pr-4 text-sm leading-6 text-rose-700">{patchPreviewError}</p>}
      </div> : null}

      <div className="mx-auto flex max-w-[1820px] gap-6 px-5 py-8 xl:px-9">
        <aside className="hwpx-preview-nav sticky top-24 hidden h-fit w-56 shrink-0 rounded-2xl border border-[#dce2ea] bg-white p-5 shadow-sm lg:block">
          <p className="text-[11px] font-bold tracking-[0.1em] text-[#64748b]">문서 목차</p>
          <nav className="mt-4 space-y-2 text-sm">
            {PREVIEW_NAVIGATION.map(([item, target], index) => (
              <a key={item} href={`#${target}`} className={`block rounded-lg px-3 py-2 ${index === 4 ? "bg-[#eaf2ff] font-bold text-[#1d63bd]" : "text-[#607085] hover:bg-slate-50"}`}>{item}</a>
            ))}
          </nav>
          <p className="mt-7 border-t border-[#e7ebf0] pt-4 text-xs leading-5 text-[#7d8a9a]">이 POC는 HWPX 양식의 웹 재현 가능성을 확인하는 화면입니다. 기존 저장·다운로드에는 영향을 주지 않습니다.</p>
        </aside>

        <section className="min-w-0 flex-1 space-y-8">
          <A4Page id="preview-page-0" className="rivalabs-cover flex min-h-[1122px] flex-col overflow-hidden p-[15mm]" >
            <div className="self-end text-[10pt] tracking-wide text-[#667085]">2025 by Alphabrothers</div>
            <div className="mt-20 text-[11pt] leading-8 text-[#334155]">
              <p>발주처 l 정보통신산업진흥원</p>
              <p>사업명 l SW제품 시장성테스트 및 개선방안 수립 지원 사업</p>
            </div>
            <div className="rivalabs-cover-title mt-auto border-y-[3px] border-[#49bddd] py-14">
              <p>사용성 테스트</p>
              <h2>결과보고서</h2>
              <div data-hwpx-edit-key="cover:company" contentEditable suppressContentEditableWarning className="mt-12 text-[26pt] font-bold outline-none">{info?.companyName ?? "기업명 입력"}</div>
              <p data-hwpx-edit-key="cover:service" contentEditable suppressContentEditableWarning className="mt-3 text-[14pt] font-medium">Usability Test Proposal for ‘{info?.serviceName ?? "서비스·제품명 입력"}’</p>
            </div>
            <p className="mt-auto text-right text-[11pt] text-[#475569]">2025. 09.05</p>
          </A4Page>

          <A4Page id="preview-page-1" className="min-h-[1122px] p-14 sm:p-20">
            <p className="text-3xl font-bold text-[#1d5eaa]">목차</p>
            <div className="mt-12 space-y-6 text-[17px] leading-8 text-[#27364b]">
              {["Part 1. 조사 기획", "Part 2. 사용성 테스트", "Ⅲ. 기능별 고객 경험 평가", "Ⅳ. 핵심구매요소", "Ⅴ. 4대 가치 만족도", "Ⅷ. 종합 만족도 및 NPS 지수", "Ⅸ. 종합 결과 및 제언"].map((item, index) => <p key={item} className={index === 2 ? "font-bold text-[#1d63bd]" : ""}>{item}<span className="ml-3 text-[#9aa6b5]">····················</span></p>)}
            </div>
          </A4Page>

          {sectionsBeforeFeatures.map((section) => <RivalabsSectionReferencePage key={section.numeral} section={section} />)}

          {features.map((feature, index) => {
            const qIndex = index + 1;
            const question = featureQuestions[index]?.question ?? `'${feature.name}' 기능의 만족도는 몇 점입니까?`;
            return <RivalabsFeatureReferencePage
              key={feature.name}
              feature={feature}
              question={question}
              scoreboxHtml={findHtml(workspace, `feature-qualitative-q${qIndex}-scorebox`)}
              emotionboxHtml={findHtml(workspace, `feature-qualitative-q${qIndex}-emotionbox`)}
              detailHtml={findHtml(workspace, `feature-qualitative-q${qIndex}-detail`)}
              pageId={`preview-feature-${index}`}
              detailPageId={`preview-feature-detail-${index}`}
              showChapterHeading={index === 0}
            />;
          })}

          <A4Page className="p-[15mm]" id="preview-analysis">
            <div className="border-t-4 border-[#48c1e0] border-x border-b border-[#89a3dd]">
              <p className="bg-[#bdcbed] px-5 py-3 text-center text-xl font-bold">[ 기능별 중요 순위 및 만족도 종합 해석 ]</p>
              <div className="p-8" data-hwpx-edit-key="feature:analysis" contentEditable suppressContentEditableWarning>
                <h2 className="mb-6 text-2xl font-bold">종합 해석</h2>
                {analysisHtml ? <div className="report-rich-static leading-8" dangerouslySetInnerHTML={{ __html: analysisHtml }} /> : <p className="text-[#6c7c90]">정성 분석 결과가 저장되면 이 영역에 반영됩니다.</p>}
              </div>
            </div>
          </A4Page>

          {sectionsAfterFeatures.map((section) => <RivalabsSectionReferencePage key={section.numeral} section={section} />)}

          <RivalabsConclusionReferencePage workspace={workspace} />
        </section>
      </div>
    </main>
  );
}
