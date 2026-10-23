"use client";

import { useState } from "react";
import { FileUploadButton, type UploadedFile } from "@/components/FileUploadButton";
import { ProductInfoPromptCard } from "@/components/ProductInfoPromptCard";
import { ProductInfoExtractedCard } from "@/components/ProductInfoCard";
import type { ProductInfo } from "@/lib/productInfo/types";
import type { ValidateResult } from "./types";

const RAW_DATA_EXTENSIONS = [".xlsx", ".csv"];

function isRawDataFile(name: string) {
  return RAW_DATA_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/**
 * 마법사 2단계 — raw data(필수) + 기업소개 파일(선택) 첨부, 기업 정보 입력(건너뛰기 가능).
 * app/api/chat/route.ts의 validateInput→presentProductInfoPrompt→(extractProductInfoFromFile)
 * →saveProductInfoTool 흐름을 REST 라우트(/api/wizard/*)로 순서대로 호출하는 형태로 옮겼다 —
 * LLM이 "다음에 뭘 부를지" 판단하지 않고 이 컴포넌트가 고정 순서로 호출한다.
 */
export function UploadStep({
  onValidated,
  onProductInfoDone,
  onNext,
  validation,
  productInfoDone,
}: {
  onValidated: (file: UploadedFile, result: ValidateResult) => void;
  onProductInfoDone: () => void;
  onNext: () => void;
  validation: ValidateResult | null;
  productInfoDone: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [rawDataFile, setRawDataFile] = useState<UploadedFile | null>(null);
  const [companyFile, setCompanyFile] = useState<UploadedFile | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ProductInfo | null>(null);
  const [lastExtracted, setLastExtracted] = useState<ProductInfo | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [savingInfo, setSavingInfo] = useState(false);

  async function handleUploaded(file: UploadedFile) {
    if (isRawDataFile(file.name)) {
      setRawDataFile(file);
      setIsValidating(true);
      const res = await fetch("/api/wizard/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: file.url, fileName: file.name }),
      });
      const result: ValidateResult = await res.json();
      setIsValidating(false);
      onValidated(file, result);
    } else {
      setCompanyFile(file);
    }
  }

  async function handleExtract() {
    if (!companyFile) return;
    setExtracting(true);
    setExtractError(null);
    const res = await fetch("/api/wizard/extract-product-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: companyFile.url }),
    });
    const data = await res.json();
    setExtracting(false);
    if (data.ok) {
      setExtracted(data.extracted);
      setLastExtracted(data.extracted);
    } else {
      setExtractError(data.error ?? "추출에 실패했습니다.");
    }
  }

  async function saveProductInfo(fields: ProductInfo) {
    if (!rawDataFile) return;
    if (!fields.companyName?.trim() || !fields.serviceName?.trim()) {
      setExtractError("기업명과 서비스·제품명을 입력해주세요.");
      setLastExtracted(fields);
      setExtracted(null);
      return;
    }
    setSavingInfo(true);
    await fetch("/api/wizard/product-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: rawDataFile.url, ...fields }),
    });
    setSavingInfo(false);
    onProductInfoDone();
  }

  return (
    <div className="w-full max-w-xl">
      <h2 className="text-xl font-bold text-[#202c40]">raw data와 기업 정보를 첨부해주세요</h2>
      <p className="mt-1.5 text-sm text-[#748196]">
        raw data(xlsx/csv)는 필수, 기업소개 파일(PDF/워드/텍스트)은 선택입니다.
      </p>

      <RawDataHeaderGuide />

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-[#dde5ef] bg-[#f8fafc] px-4 py-3">
        <FileUploadButton
          onUploaded={handleUploaded}
          onUploadingChange={setIsUploading}
        />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {isUploading || isValidating ? "처리 중..." : "파일을 첨부해주세요 (여러 개 가능)"}
        </span>
      </div>

      {validation && !validation.valid && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {validation.error ?? "보고서에 필요한 응답 구조를 찾지 못했습니다. 원본 파일을 다시 확인해주세요."}
        </div>
      )}

      {!!validation?.uxMissingPrefix?.length && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">사용자 경험 품질 문항 {validation.uxMissingPrefix.length}개에 계열 표시가 없어요 — 이대로면 실용성·즐거움 그래프가 보고서에 나오지 않습니다.</p>
          <p className="mt-1">raw data 파일의 문항 제목(1행) 앞에 <b>실용성1)</b>, <b>즐거움1)</b>처럼 계열과 번호를 붙인 뒤 다시 올려 주세요. 설문 생성 때 받은 ‘WALLA 설정 목록’ 6번에 어느 문항에 무엇을 붙일지 적혀 있습니다.</p>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-amber-800">
            {validation.uxMissingPrefix.slice(0, 8).map((h) => <li key={h}>{h.length > 70 ? `${h.slice(0, 70)}…` : h}</li>)}
          </ul>
        </div>
      )}

      {validation?.valid && validation.hasEnterprisePrefix === false && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">기업 요청 문항이 있었다면, 문항 제목 앞에 ‘기업 요청 질문 - ’이 붙어 있는지 확인해 주세요.</p>
          <p className="mt-1">이 표시가 없으면 기업 요청 문항이 기능 만족도로 분류돼 기능별 그래프·사분면에 섞일 수 있습니다. 설문 생성 때 받은 ‘WALLA 설정 목록’ 7번에 붙일 문항이 적혀 있습니다. 기업 요청 문항이 없던 설문이면 넘어가셔도 됩니다.</p>
        </div>
      )}

      {validation?.valid && !productInfoDone && (
        <div className="mt-4">
          {companyFile && !extracted && (
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting}
              className="mb-3 rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              {extracting ? "기업소개 파일에서 추출 중..." : "기업소개 파일에서 자동으로 채우기"}
            </button>
          )}
          {extractError && <p className="mb-2 text-sm text-red-600">{extractError}</p>}
          {extracted ? (
            <div>
              <ProductInfoExtractedCard
                state="output-available"
                output={{ ok: true, extracted }}
                onApprove={() => saveProductInfo(extracted)}
                editHint="틀린 부분이 있으면 아래에서 다시 입력할 수 있어요."
              />
              <button
                type="button"
                onClick={() => setExtracted(null)}
                className="mt-2 text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                직접 입력할게요
              </button>
            </div>
          ) : (
            <ProductInfoPromptCard
              onSkip={onProductInfoDone}
              onSubmit={saveProductInfo}
              initial={lastExtracted ?? undefined}
            />
          )}
          {savingInfo && <p className="mt-2 text-sm text-zinc-500">저장 중...</p>}
        </div>
      )}

      {validation?.valid && productInfoDone && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          기업/제품 정보 단계를 마쳤습니다 · 응답 {validation.respondentCount}명 · 기능{" "}
          {validation.featureNames?.length ?? 0}개 확인
        </div>
      )}

      <button
        type="button"
        disabled={!validation?.valid || !productInfoDone}
        onClick={onNext}
        className="mt-6 rounded-md bg-[#356df3] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(53,109,243,0.25)] hover:bg-[#2d60da] disabled:cursor-not-allowed disabled:bg-[#c8d1de] disabled:shadow-none"
      >
        다음
      </button>
    </div>
  );
}

/**
 * 올리기 전에 raw data 문항 제목(1행)에 붙여야 하는 표시. WALLA 폼에는 응답자에게 안 보이게 이 표시를 빼고 만들기 때문에
 * (설문 생성기 WALLA txt), 응답을 받은 뒤 사람이 붙여야 한다. 빠뜨리면 장이 조용히 사라지거나 다른 장에 섞인다
 * (lib/agent/profile.ts GROUP_PREFIX, lib/agent/classify.ts ENTERPRISE_HEADER). 올린 뒤의 경고는 아래 노란 상자가 따로 띄운다.
 */
function RawDataHeaderGuide() {
  const rules = [
    {
      title: "기업 요청 문항",
      when: "기업이 따로 요청해 넣은 문항이 있을 때",
      add: "기업 요청 질문 - ",
      before: "‘약물안전리포트’의 내용을 이해하기 쉬웠나요?",
      why: "안 붙이면 기능 만족도로 분류돼 기능별 그래프·사분면에 섞입니다. 이유 문항에도 붙여 주세요.",
    },
    {
      title: "사용자 경험 품질 문항",
      when: "[불편하다 / 편하다] 같은 양끝 말 척도가 있을 때",
      add: "실용성1) ",
      before: "필톡의 조작은 [불편하다 / 편하다]",
      why: "안 붙이면 실용성·즐거움 그래프가 나오지 않습니다. 계열(실용성·즐거움)별로 번호를 1부터 매깁니다.",
    },
  ];
  return (
    <details className="mt-4 rounded-lg border border-[#c9d8fb] bg-[#f3f7ff] px-4 py-3 text-sm text-[#1d2433]" open>
      <summary className="cursor-pointer font-semibold">올리기 전에 확인: raw data 문항 제목 앞에 붙여야 하는 표시</summary>
      <p className="mt-1.5 text-[13px] text-[#4a566b]">
        WALLA 폼에는 응답자에게 안 보이게 빼 두었던 표시입니다. 엑셀에서 <b>1행(문항 제목)</b> 앞에 붙인 뒤 올려 주세요.
        어느 문항에 붙일지는 설문 생성 때 받은 ‘WALLA 설정 목록’ 6·7번에 적혀 있습니다. 해당 문항이 없으면 넘어가세요.
      </p>
      <div className="mt-3 space-y-3">
        {rules.map((r) => (
          <div key={r.title} className="rounded-md border border-[#dfe6f5] bg-white px-3 py-2.5">
            <p className="font-semibold">{r.title} <span className="font-normal text-[#94a0b2]">— {r.when}</span></p>
            <div className="mt-1.5 grid grid-cols-[60px_minmax(0,1fr)] gap-y-1 text-[13px]">
              <span className="text-[#94a0b2]">지금</span>
              <span className="text-[#6b778a]">{r.before}</span>
              <span className="font-semibold text-[#356df3]">고친 뒤</span>
              <span><mark className="rounded bg-[#ffe9a8] px-0.5 font-semibold">{r.add.trim()}</mark> {r.before}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-[#6b778a]">{r.why}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
