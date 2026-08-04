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
    <div className="w-full max-w-3xl">
      <h2 className="text-xl font-bold text-[#202c40]">어떤 종류의 제품인가요?</h2>
      <p className="mt-1.5 text-sm text-[#748196]">
        보고서 목차와 제언의 논리 축이 제품 유형에 따라 달라져요.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelect("sw")}
          className={`rounded-lg border-2 px-5 py-6 text-left transition-colors ${
            value === "sw"
              ? "border-[#356df3] bg-[#f8faff]"
              : "border-[#dde5ef] hover:border-[#b8c8e3]"
          }`}
        >
          <p className="text-base font-semibold text-[#263449]">SW (Web/Mobile)</p>
          <p className="mt-1 text-sm text-[#66758b]">
            앱·웹 서비스. 개선 우선순위를 중요도×만족도 사분면으로 분석합니다.
          </p>
        </button>
        <button
          type="button"
          onClick={() => onSelect("physical")}
          className={`relative rounded-lg border-2 px-5 py-6 text-left transition-colors ${
            value === "physical"
              ? "border-[#356df3] bg-[#f8faff]"
              : "border-[#dde5ef] hover:border-[#b8c8e3]"
          }`}
        >
          <span className="absolute right-3 top-3 rounded-full bg-[#fff3d9] px-2 py-0.5 text-xs font-medium text-[#8a6115]">
            준비 중
          </span>
          <p className="text-base font-semibold text-[#263449]">실제품</p>
          <p className="mt-1 text-sm text-[#66758b]">
            영양제·기기 등 실물 제품. 고객여정·구매전환 중심 분석은 아직 준비 중이라, 선택해도
            우선 SW형과 같은 방식으로 진행됩니다.
          </p>
        </button>
      </div>
      <button
        type="button"
        disabled={!value}
        onClick={onNext}
        className="mt-6 rounded-md bg-[#356df3] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(53,109,243,0.25)] hover:bg-[#2d60da] disabled:cursor-not-allowed disabled:bg-[#c8d1de] disabled:shadow-none"
      >
        다음
      </button>
    </div>
  );
}
