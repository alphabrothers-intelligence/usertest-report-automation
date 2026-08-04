"use client";

import type { ProductType } from "./types";

/**
 * 마법사 1단계 — 제품유형 선택. "실제품(physical)"은 UI 선택지만 두고 "준비중" 처리한다
 * (customerJourney 계산·TOC 분기 등 파이프라인 자체가 아직 없음, lib/report/productType.ts
 * 참고 — v1.3은 SW/App형만 빌드 대상, 2026-08-03 사용자 확정).
 */
export function ProductTypeStep({
  value,
  onSelect,
  onNext,
}: {
  value: ProductType | null;
  onSelect: (type: ProductType) => void;
  onNext: () => void;
}) {
  return (
    <div className="w-full max-w-xl">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">어떤 종류의 제품인가요?</h2>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        보고서 목차와 제언의 논리 축이 제품 유형에 따라 달라져요.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelect("sw")}
          className={`rounded-xl border-2 px-5 py-6 text-left transition-colors ${
            value === "sw"
              ? "border-[#315c9c] bg-[#315c9c]/5"
              : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
          }`}
        >
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">SW (Web/Mobile)</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            앱·웹 서비스. 개선 우선순위를 중요도×만족도 사분면으로 분석합니다.
          </p>
        </button>
        <button
          type="button"
          onClick={() => onSelect("physical")}
          className={`relative rounded-xl border-2 px-5 py-6 text-left transition-colors ${
            value === "physical"
              ? "border-[#315c9c] bg-[#315c9c]/5"
              : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
          }`}
        >
          <span className="absolute right-3 top-3 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            준비 중
          </span>
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">실제품</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            영양제·기기 등 실물 제품. 고객여정·구매전환 중심 분석은 아직 준비 중이라, 선택해도
            우선 SW형과 같은 방식으로 진행됩니다.
          </p>
        </button>
      </div>
      <button
        type="button"
        disabled={!value}
        onClick={onNext}
        className="mt-6 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        다음
      </button>
    </div>
  );
}
