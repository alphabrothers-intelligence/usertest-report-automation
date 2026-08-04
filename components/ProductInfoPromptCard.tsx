"use client";

import { useState } from "react";
import { PRODUCT_INFO_FIELD_LABELS, type ProductInfo } from "@/lib/productInfo/types";

const FIELD_KEYS = Object.keys(PRODUCT_INFO_FIELD_LABELS) as (keyof ProductInfo)[];

export function ProductInfoPromptCard({
  onSkip,
  onSubmit,
  initial,
  productType,
}: {
  onSkip: () => void;
  onSubmit: (fields: ProductInfo) => void;
  /** 마법사에서 AI 추출 결과를 "직접 입력"으로 되돌릴 때 값을 이어받기 위한 초기값(선택). */
  initial?: ProductInfo;
  productType?: "sw" | "physical";
}) {
  const [fields, setFields] = useState<ProductInfo>(initial ?? {});
  const hasRequired = Boolean(fields.companyName?.trim() && fields.serviceName?.trim());

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        기업/제품 정보를 알려주시겠어요?
      </p>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        기업명과 {productType === "physical" ? "제품명" : "서비스명"}은 보고서 제목을 만들기 위한 필수 항목입니다.
        나머지 정보는 선택 입력이며 보고서 Ⅰ장에 반영됩니다.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FIELD_KEYS.map((key) => {
          const required = key === "companyName" || key === "serviceName";
          const label = key === "serviceName" && productType === "physical" ? "제품명" : PRODUCT_INFO_FIELD_LABELS[key];
          return (
            <label key={key} className="block">
              <span className={`mb-1 flex items-center gap-1 text-xs font-semibold ${required ? "text-[#285fc5]" : "text-[#758196]"}`}>
                {label}{required && <><span className="text-[#e14b4b]">*</span><span className="rounded bg-[#edf2ff] px-1.5 py-0.5 text-[10px] text-[#356df3]">필수</span></>}
              </span>
              <input
                value={fields[key] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={`${label}을(를) 입력해주세요`}
                required={required}
                aria-required={required}
                className={`w-full rounded-md px-3 py-2 text-sm outline-none transition ${required ? "border-2 border-[#b9cdf8] bg-[#fafdff] focus:border-[#356df3]" : "border border-zinc-300 focus:border-[#356df3]"}`}
              />
            </label>
          );
        })}
      </div>
      {!hasRequired && <p className="mt-3 text-xs font-medium text-[#c34c4c]">기업명과 {productType === "physical" ? "제품명" : "서비스명"}을 모두 입력해야 다음 단계로 이동할 수 있습니다.</p>}
      <div className="mt-4 flex gap-2">
        {!productType && <button type="button" onClick={onSkip} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">건너뛰기</button>}
        <button
          type="button"
          disabled={!hasRequired}
          onClick={() => onSubmit(fields)}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          저장하고 계속
        </button>
      </div>
    </div>
  );
}
