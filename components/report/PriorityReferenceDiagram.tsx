"use client";

/** 원본 보고서의 사분면 뒤 "영역별 참고 지표"를 웹 문서에도 유지한다.
 * 사분면 수치는 별도 차트에서 조정하고, 이 블록은 판정 기준을 명확히 전달하는 용도다.
 *
 * **9칸 평가기준 도표는 코드로 그리지 않고 FGI 원본 이미지를 그대로 쓴다**(2026-08-18 사용자
 * 지시). 예전엔 SVG로 근사해 그렸는데 칸 문구·경계가 원본과 달라 "잘못된 이미지"였다. 원본은
 * `data/사분면그래프_평가기준.png`이고, data/는 gitignore라 배포에 안 실리므로
 * `public/images/quadrant-priority-reference.png`로 복사해서 쓴다(fonts.ts와 같은 이유).
 * PDF 렌더러(lib/pdf/sectionsQuant.tsx의 PRIORITY_REF_PATH)도 같은 파일을 쓴다 — 이 참고
 * 지표가 필요한 렌더러가 새로 생기면 반드시 이 이미지를 쓸 것(코드로 다시 그리지 말 것). */
import type { ReportPriorityReferenceBlock } from "@/lib/report/sections";

export const PRIORITY_REFERENCE_IMAGE = "/images/quadrant-priority-reference.png";

const levels = [
  ["최상", "긴급 개선", "#f9c9a8"],
  ["상", "중요 개선", "#fde9dd"],
  ["중", "개선 권장 or 제외 권장", "#ffffff"],
  ["하", "개선 권장 or 필요성 낮음", "#dbe5f5"],
  ["최하", "필요성 적음", "#aebfe5"],
] as const;

const notes = [
  ["#f9c9a8", "중요도가 높으나 만족도가 낮으므로 긴급 개선 필요"],
  ["#fde9dd", "중요도가 높으나 만족도가 보통이므로 중요 개선 필요"],
  ["#ffffff", "중요도가 보통이나 만족도가 낮으므로 중요 개선 필요"],
  ["#ffffff", "중요도가 높으나 만족도가 높으므로 개선 필요성 낮음"],
  ["#dbe5f5", "중요도가 보통이고 만족도가 높으므로 추후 고도화"],
  ["#aebfe5", "중요도가 낮으나 만족도가 높으므로 개선 필요성 낮음"],
] as const;

export function PriorityReferenceDiagram({ block }: { block: ReportPriorityReferenceBlock }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex justify-end" data-copy-ignore><a href={PRIORITY_REFERENCE_IMAGE} download={`${block.title}.png`} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">참고 지표 PNG 다운로드</a></div>
      <div data-report-export="image" data-report-export-name={block.title} className="border border-[#d4d4d8] bg-white p-4">
        <h4 className="-mx-4 -mt-4 mb-4 border-b border-[#d4d4d8] bg-[#ececec] py-1.5 text-center text-sm font-bold text-[#111827]">{block.title}</h4>
        <div className="grid gap-4 md:grid-cols-[minmax(220px,0.9fr)_minmax(270px,1.1fr)]">
          <div className="mx-auto w-full max-w-[270px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image는 최적화 프록시를
                거쳐 URL이 바뀌는데, 이 요소는 섹션 ZIP 내보내기가 src를 그대로 fetch해 담는다. */}
            <img src={PRIORITY_REFERENCE_IMAGE} alt={block.title} className="block w-full" />
          </div>
          <div>
            <div className="border border-[#a1a1aa] text-xs">
              <div className="grid grid-cols-[88px_1fr] bg-[#ececec] font-bold"><span className="border-r border-[#a1a1aa] px-2 py-1 text-center">우선순위</span><span className="px-2 py-1 text-center">개선 필요성</span></div>
              {levels.map(([level, description, color]) => <div key={level} className="grid grid-cols-[88px_1fr] border-t border-[#a1a1aa]"><span className="flex items-center gap-2 border-r border-[#a1a1aa] px-2 py-1"><i className="h-3 w-3" style={{ backgroundColor: color }} />{level}</span><span className="px-2 py-1 text-center">{description}</span></div>)}
            </div>
            <div className="mt-3 space-y-1.5 text-xs leading-5 text-[#111827]">
              {notes.map(([color, text]) => <p key={text} className="flex gap-2"><i className="mt-1 h-3 w-3 shrink-0 border border-[#a1a1aa]" style={{ backgroundColor: color }} /><span>{text}</span></p>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
