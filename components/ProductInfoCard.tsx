"use client";

import { PRODUCT_INFO_FIELD_LABELS, type ProductInfo } from "@/lib/productInfo/types";

function ProductInfoFieldList({ info }: { info: ProductInfo }) {
  const entries = (Object.keys(PRODUCT_INFO_FIELD_LABELS) as (keyof ProductInfo)[])
    .map((key) => ({ key, label: PRODUCT_INFO_FIELD_LABELS[key], value: info[key] }))
    .filter((e) => e.value);

  if (entries.length === 0) {
    return <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">추출된 항목이 없습니다.</p>;
  }

  return (
    <ul className="mt-2 space-y-1 text-sm">
      {entries.map((e) => (
        <li key={e.key}>
          <span className="font-medium">{e.label}</span>: {e.value}
        </li>
      ))}
    </ul>
  );
}

export interface ProductInfoExtractedOutput {
  ok: boolean;
  error?: string;
  extracted?: ProductInfo;
}

export function ProductInfoExtractedCard({
  state,
  output,
  onApprove,
  editHint = "틀린 부분이 있으면 채팅으로 고쳐서 알려주세요.",
}: {
  state: string;
  output?: ProductInfoExtractedOutput;
  onApprove: () => void;
  /** 마법사 등 채팅이 없는 화면에서 안내 문구를 바꿔 쓸 수 있게 열어둔다(기본값은 기존 채팅
   * 문구 그대로 — app/page.tsx 삭제 전까지 기존 동작을 안 건드리기 위함). */
  editHint?: string;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        기업소개 파일에서 정보 추출 중...
      </div>
    );
  }

  if (!output?.ok || !output.extracted) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "기업 정보 추출 중 오류가 발생했습니다."}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-base text-zinc-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-zinc-100">
      <p className="text-base font-semibold">파일에서 이런 기업 정보를 찾았습니다</p>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        AI가 문서에서 추출한 내용이라 확인이 필요해요. 맞으면 저장해주세요. {editHint}
      </p>
      <ProductInfoFieldList info={output.extracted} />
      <button
        type="button"
        onClick={onApprove}
        className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
      >
        확인했어요, 저장해주세요
      </button>
    </div>
  );
}

export interface ProductInfoSavedOutput {
  ok: boolean;
  error?: string;
  saved?: ProductInfo;
}

export function ProductInfoSavedCard({
  state,
  output,
}: {
  state: string;
  output?: ProductInfoSavedOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        기업 정보 저장 중...
      </div>
    );
  }

  if (!output?.ok || !output.saved) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "기업 정보 저장 중 오류가 발생했습니다."}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <p className="text-base font-semibold">기업/제품 정보를 보고서에 반영했습니다.</p>
      <p className="mt-1 text-sm">다음으로 보고서 목차를 확인해주세요.</p>
    </div>
  );
}
