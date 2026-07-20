"use client";

import { useState } from "react";
import { PRODUCT_INFO_FIELD_LABELS, type ProductInfo } from "@/lib/productInfo/types";

const FIELD_KEYS = Object.keys(PRODUCT_INFO_FIELD_LABELS) as (keyof ProductInfo)[];

export function ProductInfoPromptCard({
  onSkip,
  onSubmit,
}: {
  onSkip: () => void;
  onSubmit: (fields: ProductInfo) => void;
}) {
  const [fields, setFields] = useState<ProductInfo>({});
  const hasAny = FIELD_KEYS.some((key) => (fields[key] ?? "").trim() !== "");

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        기업/제품 정보를 알려주시겠어요?
      </p>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        선택 입력이에요 — 입력하시면 보고서 Ⅰ장(개요)에 반영되고, 건너뛰어도 다음 단계로
        진행됩니다. 기업소개 파일(PDF/워드/텍스트)을 첨부하시면 자동으로 채워드릴 수도 있어요.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FIELD_KEYS.map((key) => (
          <input
            key={key}
            value={fields[key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
            placeholder={PRODUCT_INFO_FIELD_LABELS[key]}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-950"
          />
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          건너뛰기
        </button>
        <button
          type="button"
          disabled={!hasAny}
          onClick={() => onSubmit(fields)}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          저장하고 계속
        </button>
      </div>
    </div>
  );
}
