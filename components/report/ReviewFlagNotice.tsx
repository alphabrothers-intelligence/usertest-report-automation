"use client";

/**
 * "이 도표는 한 번 더 봐주세요" 표시. 규칙은 `lib/quant/reviewFlags.ts`가 정하고(LLM 없음),
 * 여기서는 **대상 도표 바로 위에** 이유를 붙이기만 한다.
 *
 * **승인 게이트가 아니라 표시다**(memory: review-flag-not-gate). 계산이 틀렸다는 뜻이 아니라,
 * 맞게 계산했는데 사람이 오해하기 쉬운 자리를 짚어주는 것뿐이라 넘어가는 것을 막지 않는다.
 * 예: 리바랩스 Ⅱ장 유사 서비스 만족도는 100명이 아니라 91명 기준인데 그래프만 보면 전체
 * 결과로 읽힌다. Ⅲ장 순위표는 6.35 동점 두 기능이 3위/4위로 찍히는데 그건 컬럼 순서일 뿐이다.
 */
import type { ReviewFlag } from "@/lib/quant/reviewFlags";

/** 같은 이유가 여러 항목에서 걸리면 문구를 한 번만 쓰고 항목만 칩으로 나열한다. */
function groupByReason(flags: ReviewFlag[]) {
  const groups = new Map<string, { title?: string; message: string; severity: ReviewFlag["severity"]; locations: string[] }>();
  for (const flag of flags) {
    const key = `${flag.severity}:${flag.title}:${flag.message}`;
    const group = groups.get(key);
    if (group) group.locations.push(flag.location);
    else groups.set(key, { title: flag.title, message: flag.message, severity: flag.severity, locations: [flag.location] });
  }
  return [...groups.values()];
}

export function ReviewFlagNotice({ flags }: { flags: ReviewFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <>
      {groupByReason(flags).map((group, index) => (
        <div
          key={`${group.message}-${index}`}
          // 인쇄·한글 복사에는 안 실린다 — 보고서 본문이 아니라 화면 안내다.
          data-copy-ignore
          contentEditable={false}
          className={`mb-3 rounded-lg border-l-4 px-4 py-3 ${group.severity === "warning" ? "border-l-[#e6a23c] bg-[#fffaf1]" : "border-l-[#5a7ff5] bg-[#f6f8ff]"}`}
        >
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${group.severity === "warning" ? "bg-[#fff0d2] text-[#946313]" : "bg-[#e9efff] text-[#356df3]"}`}>
            {group.title ?? "보고서 해석 시 확인할 내용"}
          </span>
          <p className="mt-2 text-sm leading-6 text-[#526076]">{group.message}</p>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="해당 항목">
            {group.locations.map((location) => (
              <span key={location} className="rounded-full border border-[#ead7b4] bg-white px-2.5 py-1 text-xs font-semibold text-[#765b2b]">
                {location.split(" > ").at(-1)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}