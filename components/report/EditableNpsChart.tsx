"use client";

/* 원본 이미지 파일을 그대로 내려받고 캡처하기 위해 native img를 사용한다. */
/* eslint-disable @next/next/no-img-element */

/** 원본 VIII장의 NPS 0~10 등급·산식 안내를 원본 게이지 이미지로 표시한다.
 * 점수별 고객군·아이콘·산식은 원본과 같은 정보 디자인이므로, CSS/SVG로 재해석하지 않고
 * 제공받은 원본 자산을 사용한다. 실제 NPS 값은 바로 뒤의 5열 결과표에서 계산값으로 표시된다. */
import type { ReportNpsBlock } from "@/lib/report/sections";

export function EditableNpsChart({ block }: { block: ReportNpsBlock }) {
  return <section className="mb-5">
    <div className="mb-2 flex flex-wrap items-center gap-2" data-copy-ignore><a href="/images/nps-scale.png" download="NPS_지수_척도.png" className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">PNG 다운로드</a></div>
    <div data-report-export="chart" data-report-export-name="NPS_지수" className="border border-[#bac7dd] bg-white">
      <div data-export-exclude className="border-y-2 border-[#6388e6] bg-[#dfe7f6] px-3 py-2 text-[17px] font-bold text-[#6c82aa]">{block.title}</div>
      <img src="/images/nps-scale.png" alt="NPS 지수 산식과 고객군 구분" className="mx-auto block w-full max-w-[720px] p-3" />
    </div>
  </section>;
}
