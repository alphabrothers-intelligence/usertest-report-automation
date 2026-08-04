"use client";

import { useState } from "react";
import { FileUploadButton, type UploadedFile } from "@/components/FileUploadButton";
import { ProductInfoPromptCard } from "@/components/ProductInfoPromptCard";
import { ProductInfoExtractedCard } from "@/components/ProductInfoCard";
import type { ProductInfo } from "@/lib/productInfo/types";
import type { ProductType, ValidateResult } from "./types";

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
  productType,
  onValidated,
  onProductInfoDone,
  onNext,
  validation,
  productInfoDone,
}: {
  productType: ProductType;
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
      if (result.valid) {
        await fetch("/api/wizard/product-type", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: file.url, productType }),
        });
      }
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
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">raw data와 기업 정보를 첨부해주세요</h2>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        raw data(xlsx/csv)는 필수, 기업소개 파일(PDF/워드/텍스트)은 선택입니다.
      </p>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
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
        className="mt-6 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        다음
      </button>
    </div>
  );
}
