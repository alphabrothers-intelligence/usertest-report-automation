"use client";

import { useEffect, useState } from "react";
import { BlockView } from "@/components/ReportWebDocument";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import type { QuantStats } from "@/lib/quant/compute";
import { flagQuantStatsForReview, type ReviewFlag } from "@/lib/quant/reviewFlags";

const VISUAL_BLOCK_KINDS = new Set<ReportBlock["kind"]>([
  "chart", "rank-composition", "stacked-bar", "grouped-bar", "radar",
  "nps", "quadrant", "polarity",
]);

function isVisualBlock(block: ReportBlock): block is Extract<ReportBlock, { title: string }> {
  return VISUAL_BLOCK_KINDS.has(block.kind);
}

function graphGuide(block: Extract<ReportBlock, { title: string }>) {
  switch (block.kind) {
    case "rank-composition":
      return { description: "응답자가 각 항목을 몇 순위로 골랐는지 보여주는 그래프예요.", check: "순위별 비율과 가장 많이 선택된 항목이 원본 응답과 맞는지 봐주세요." };
    case "stacked-bar":
      return { description: "응답 집단 안에서 각 답변이 얼마나 차지하는지 보여주는 그래프예요.", check: "각 막대의 합계와 가장 큰 응답 구간이 예상과 맞는지 봐주세요." };
    case "grouped-bar":
      return { description: "연령이나 성별처럼 여러 집단의 점수를 나란히 비교하는 그래프예요.", check: "그룹별 응답자 수가 충분한지 확인해야 ‘어느 그룹이 더 만족한다’고 보고서에 쓸 수 있어요." };
    case "radar":
      return { description: "여러 사용 경험 항목의 강점과 약점을 한 번에 비교하는 그래프예요.", check: "유난히 높거나 낮은 항목이 실제 응답 흐름과 맞는지 봐주세요." };
    case "nps":
      return { description: "추천·중립·비추천 응답 비율과 NPS 결과를 보여주는 그래프예요.", check: "추천자보다 비추천자가 많은지 확인하면, 낮은 NPS의 원인을 사용자 의견에서 더 찾아야 하는지 판단할 수 있어요." };
    case "quadrant":
      return { description: "중요도와 만족도를 함께 놓고 먼저 개선할 기능을 찾는 그래프예요.", check: "‘중요하지만 만족도가 낮은’ 기능은 최우선 개선 과제로 제안되므로, 실제로 먼저 개선할 대상이 맞는지 확인해주세요." };
    case "polarity":
      return { description: "사용자 의견이 긍정·부정·중립 중 어디에 많이 모였는지 보여주는 그래프예요.", check: "분류 비율과 대표 의견의 분위기가 서로 어긋나지 않는지 봐주세요." };
    default:
      return { description: "항목별 결과의 크기와 순서를 비교하는 그래프예요.", check: "가장 높은 기능과 가장 낮은 기능은 보고서의 강점·개선점으로 이어져요. 원본 응답에서 예상한 결과와 크게 다르지 않은지 확인해주세요." };
  }
}

function calculationEvidence(block: Extract<ReportBlock, { title: string }>, stats: QuantStats) {
  if (block.kind === "nps") return {
    source: "원본의 0~10점 추천 의향 응답",
    calculation: "9~10점은 추천자, 7~8점은 중립자, 0~6점은 비추천자로 나눈 뒤 ‘추천자 비율 − 비추천자 비율’로 계산",
    included: `${stats.nps.n}명`,
    verify: "추천 의향 문항이 맞게 연결됐는지와 0~10점 척도인지 확인이 필요합니다.",
  };
  if (block.kind === "quadrant") return {
    source: "기능 중요도 순위 응답과 기능별 0~10점 만족도 응답",
    calculation: "가로축은 평균 순위를 -5~+5의 상대 중요도로 변환하고, 세로축은 기능별 만족도 평균을 사용",
    included: `전체 응답 ${stats.respondentCount}명 중 각 문항에 값이 있는 응답`,
    verify: "순위 문항과 만족도 문항의 기능 이름이 서로 정확히 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "rank-composition") return {
    source: "원본의 기능 중요도 순위 응답",
    calculation: "각 순위에서 기능이 선택된 횟수를 해당 순위의 전체 응답 수로 나누어 비율로 계산",
    included: `최대 ${stats.respondentCount}명`,
    verify: "원본의 1위·2위·3위 열이 올바른 순서로 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "grouped-bar") return {
    source: block.id.includes("age") ? "원본의 연령과 항목별 점수 응답" : "원본의 성별과 항목별 점수 응답",
    calculation: "응답자를 그룹으로 나눈 뒤 그룹별 항목 평균을 계산",
    included: `전체 ${stats.respondentCount}명 중 그룹 정보와 점수가 모두 있는 응답`,
    verify: "그룹을 나누는 기준 열과 점수 문항이 맞게 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "stacked-bar") return {
    source: "원본의 성별과 연령 응답",
    calculation: "성별로 응답자를 나누고 각 연령대에 해당하는 인원을 합산",
    included: `전체 ${stats.respondentCount}명 중 성별과 연령이 모두 있는 응답`,
    verify: "비어 있는 성별·연령 값이 제외되는 것이 맞는지 확인이 필요합니다.",
  };
  if (block.kind === "radar") return {
    source: "원본의 사용자 경험 품질 항목별 점수",
    calculation: "각 항목의 유효 점수를 더한 뒤 응답자 수로 나눈 평균",
    included: `최대 ${stats.respondentCount}명`,
    verify: "그래프 축의 항목 이름과 원본 점수 문항이 같은 순서로 연결됐는지 확인이 필요합니다.",
  };
  if (block.kind === "polarity") return {
    source: "승인된 서술형 응답의 긍정·부정·중립 분류",
    calculation: "각 분류의 응답 수를 전체 분류 응답 수로 나누어 비율로 계산",
    included: "분류가 완료된 유효 서술형 응답",
    verify: "분석하려는 문항과 분류 결과가 정확히 연결됐는지 확인이 필요합니다.",
  };
  const isFeature = block.id === "feature-satisfaction";
  return {
    source: isFeature ? "원본의 기능별 0~10점 만족도 응답" : `원본에서 ‘${block.title}’에 연결된 응답`,
    calculation: block.kind === "chart" && block.unit === "%" ? "같은 답변의 수를 전체 유효 응답 수로 나누어 비율로 계산" : "항목별 유효 점수를 더한 뒤 해당 항목의 응답자 수로 나눈 평균",
    included: isFeature ? `기능별 유효 응답 수(n)는 각각 다를 수 있음` : `최대 ${stats.respondentCount}명`,
    verify: isFeature ? "기능 이름과 만족도 점수 열이 서로 바뀌지 않고 연결됐는지 확인이 필요합니다." : "원본 문항과 그래프 항목이 올바르게 연결됐는지 확인이 필요합니다.",
  };
}

function groupFlagsByReason(flags: ReviewFlag[]) {
  const groups = new Map<string, { title?: string; message: string; severity: ReviewFlag["severity"]; locations: string[] }>();
  for (const flag of flags) {
    const key = `${flag.severity}:${flag.title}:${flag.message}`;
    const group = groups.get(key);
    if (group) group.locations.push(flag.location);
    else groups.set(key, { title: flag.title, message: flag.message, severity: flag.severity, locations: [flag.location] });
  }
  return [...groups.values()];
}

/**
 * 마법사 4단계 — 정량 통계를 계산하고, 실제 보고서와 똑같은 차트(Editable*Chart, 웹뷰어와
 * 같은 컴포넌트)로 미리 보여준다. 아직 정성 분석 전이라 Ⅲ/Ⅴ/Ⅷ/Ⅸ 섹션의 정성 블록은
 * "정성 분석 대기"로 표시된다(정상 — buildReportWorkspaceSeed의 기존 동작 그대로).
 * 요주의 지표(lib/quant/reviewFlags.ts)는 대상 차트 바로 위에 붙여, 사용자가 이유와 그래프를
 * 한 화면에서 비교할 수 있게 한다.
 */
export function QuantReviewStep({
  fileUrl,
  fileName,
  onNext,
}: {
  fileUrl: string;
  fileName: string | null;
  onNext: (stats: QuantStats) => void;
}) {
  const [sections, setSections] = useState<ReportSectionContent[] | null>(null);
  const [flags, setFlags] = useState<ReviewFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<QuantStats | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [showReviewHelp, setShowReviewHelp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const computeRes = await fetch("/api/wizard/quant-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl, fileName }),
      });
      const computed = await computeRes.json();
      if (!computed.ok) {
        if (!cancelled) setError(computed.error ?? "정량 통계 계산에 실패했습니다.");
        return;
      }
      const workspaceRes = await fetch(`/api/report-workspace?source=${encodeURIComponent(fileUrl)}`, {
        cache: "no-store",
      });
      const workspace = await workspaceRes.json();
      if (cancelled) return;
      if (!workspace.ok) {
        setError(workspace.error ?? "정량 결과를 불러오지 못했습니다.");
        return;
      }
      setSections(workspace.workspace.sections);
      setStats(computed.stats);
      setFlags(flagQuantStatsForReview(computed.stats as QuantStats));
    }
    void run();
    return () => { cancelled = true; };
    // fileUrl 하나당 이 단계에 한 번만 진입한다 — 재계산은 명시적 새로고침으로만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="w-full rounded-lg border border-[#f1caca] bg-[#fff7f7] px-5 py-4 text-sm text-[#b54141]">
        {error}
      </div>
    );
  }

  if (!sections) {
    return (
      <div className="w-full rounded-lg border border-[#dde5ef] bg-[#f8fafc] px-5 py-4 text-sm text-[#718096]">
        <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-[#356df3]" />그래프용 응답 수치를 계산하고 있어요...
      </div>
    );
  }

  const quantitativeSections = sections
    .map((section) => ({
      ...section,
      blocks: section.blocks.filter(isVisualBlock),
    }))
    .filter((section) => section.blocks.length > 0);

  return (
    <div className="w-full">
      <div className="border-b border-[#e5eaf1] pb-5">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-[#edf2ff] px-2 py-1 text-xs font-bold text-[#356df3]">STEP 4</span>
        <span className="text-xs font-medium text-[#8a97a9]">정량 분석 결과 확인</span>
      </div>
      <h2 className="mt-3 text-xl font-bold tracking-[-0.025em] text-[#202c40]">그래프로 정리된 결과를 확인해주세요</h2>
      <p className="mt-1.5 text-sm text-[#748196]">
        각 그래프가 보여주는 결과와 별도로 확인이 필요한 이유를 살펴본 뒤 다음 분석으로 넘어갑니다.
      </p>
      </div>

      {flags.length > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-[#d9e2f2] bg-[#f7f9fd] px-4 py-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#edf2ff] text-xs font-bold text-[#356df3]">!</span>
          <div>
            <p className="text-sm font-semibold text-[#354158]">한 번 더 확인하면 좋은 그래프가 {flags.length}건 있어요.</p>
            <p className="mt-0.5 text-xs leading-5 text-[#78869a]">결과가 틀렸다는 뜻은 아니에요. 아래 <strong className="text-[#52627a]">검토 필요</strong> 표시에서 그대로 보고서에 넣기 전 확인할 이유를 알려드릴게요.</p>
          </div>
        </div>
      )}

      {flags.length === 0 && (
        <div className="mt-5 rounded-lg border border-[#cfe0d8] bg-[#f5faf7] px-4 py-3 text-sm text-[#38664e]">
          자동 점검에서 큰 편차, 소표본, 동점처럼 별도 확인이 필요한 지표는 발견되지 않았습니다.
          그래도 위 핵심 값은 원본 응답과 한 번 대조해주세요.
        </div>
      )}

      <div className="mt-6 space-y-6 border-t border-[#e5eaf1] pt-6">
        <div>
          <h3 className="text-sm font-bold text-[#263449]">그래프 검토</h3>
          <p className="mt-1 text-xs text-[#8793a5]">이 단계에서는 보고서 본문을 제외하고, 정량 분석으로 만든 그래프만 보여드립니다.</p>
        </div>
        {quantitativeSections.map((section) => {
          const sectionFlags = flags.filter((flag) => flag.sectionNumeral === section.numeral);
          return (
            <details key={section.numeral} className="group rounded-lg border border-[#dde5ef] bg-white px-4 py-3 open:border-[#bfcdf8]" open={section.numeral === "III" || section.numeral === "VIII"}>
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[#354158]">
                <span className="text-[#94a0b2] transition-transform group-open:rotate-90">▶</span>
                <span>{section.numeral}. {section.title}</span>
                {sectionFlags.length > 0 && <span className="ml-auto rounded-full bg-[#fff1db] px-2.5 py-1 text-[11px] font-bold text-[#946313]">검토 필요 {sectionFlags.length}</span>}
              </summary>
              <div className="mt-4 border-t border-[#e8edf3] pt-4">
              {section.blocks.map((block) => {
                const visualBlock = isVisualBlock(block) ? block : null;
                const visual = visualBlock !== null;
                const guide = visualBlock ? graphGuide(visualBlock) : null;
                const evidence = visualBlock && stats ? calculationEvidence(visualBlock, stats) : null;
                return (
                <div key={block.id} className={visual ? `mx-auto mb-7 rounded-xl border border-[#e1e7f0] bg-[#fbfcfe] p-4 sm:p-5 ${block.kind === "quadrant" ? "max-w-[920px]" : "max-w-[760px]"}` : ""}>
                  {guide && (
                    <div className="mb-4">
                      <span className="inline-flex rounded-full bg-[#edf2ff] px-2.5 py-1 text-[11px] font-bold text-[#356df3]">그래프 안내</span>
                      <h4 className="mt-2 text-base font-bold tracking-[-0.015em] text-[#263449]">{visualBlock?.title}</h4>
                      <p className="mt-1 text-sm leading-6 text-[#66758b]">{guide.description}</p>
                      <p className="mt-2 rounded-lg bg-white px-3 py-2.5 text-sm leading-6 text-[#526076] ring-1 ring-[#e1e7f0]">
                        <strong className="mr-1 text-[#263449]">보고서에 반영하기 전 확인할 내용:</strong>{guide.check}
                      </p>
                      {evidence && (
                        <details className="mt-2 rounded-lg border border-[#dce4ef] bg-white px-3 py-2.5">
                          <summary className="cursor-pointer text-sm font-semibold text-[#356df3]">계산 근거 보기</summary>
                          <dl className="mt-3 grid gap-3 text-sm leading-5 text-[#66758b] sm:grid-cols-[110px_1fr]">
                            <dt className="font-semibold text-[#354158]">사용한 데이터</dt><dd>{evidence.source}</dd>
                            <dt className="font-semibold text-[#354158]">계산 방식</dt><dd>{evidence.calculation}</dd>
                            <dt className="font-semibold text-[#354158]">포함된 응답</dt><dd>{evidence.included}</dd>
                            <dt className="font-semibold text-[#354158]">검증할 부분</dt><dd className="font-medium text-[#8a5b18]">{evidence.verify}</dd>
                          </dl>
                          <p className="mt-3 border-t border-[#e8edf3] pt-3 text-xs leading-5 text-[#7a8799]">
                            그래프 값은 위 계산 결과에서 자동 생성되어 중간에 수동 입력되지 않습니다. 사용자는 계산을 다시 하기보다 원본 문항과 그래프 항목의 연결이 맞는지 확인합니다.
                          </p>
                        </details>
                      )}
                    </div>
                  )}
                  {groupFlagsByReason(sectionFlags.filter((flag) => flag.targetBlockId === block.id)).map((group, index) => (
                    <div key={`${group.message}-${index}`} className={`mb-3 rounded-lg border-l-4 px-4 py-3 ${group.severity === "warning" ? "border-l-[#e6a23c] bg-[#fffaf1]" : "border-l-[#5a7ff5] bg-[#f6f8ff]"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${group.severity === "warning" ? "bg-[#fff0d2] text-[#946313]" : "bg-[#e9efff] text-[#356df3]"}`}>{group.title ?? "보고서 해석 시 확인할 내용"}</span>
                      </div>
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
                  <div className={visual ? `[&_[data-copy-ignore]]:hidden [&_img]:mx-auto [&_img]:w-auto [&_img]:max-w-full [&_svg]:mx-auto [&_svg]:w-full ${block.kind === "quadrant" ? "[&_svg]:max-h-[620px]" : "[&_img]:max-h-[360px] [&_svg]:max-h-[360px]"}` : ""}>
                    <BlockView block={block} onChange={() => {}} />
                  </div>
                </div>
              );})}
              </div>
            </details>
          );
        })}
      </div>

      <label className={`mt-6 flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 text-sm transition-colors ${reviewConfirmed ? "border-[#356df3] bg-[#f8faff] text-[#45536a]" : "border-[#dce3ec] bg-white text-[#607087]"}`}>
        <input
          type="checkbox"
          checked={reviewConfirmed}
          onChange={(event) => setReviewConfirmed(event.target.checked)}
          className="mt-0.5 size-4 accent-[#356df3]"
        />
        <span>
          <strong className="block text-[#263449]">그래프와 확인이 필요한 결과를 검토했습니다.</strong>
          보고서에서 단정하면 안 되는 결과와 추가로 이유를 살펴볼 항목을 확인했습니다.
        </span>
      </label>

      <button
        type="button"
        onClick={() => stats && onNext(stats)}
        disabled={!stats || !reviewConfirmed}
        className="mt-5 rounded-md bg-[#356df3] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(53,109,243,0.25)] hover:bg-[#2d60da] disabled:cursor-not-allowed disabled:bg-[#c8d1de] disabled:shadow-none"
      >
        확인했어요, 응답 내용 분석 시작하기
      </button>

      <button
        type="button"
        onClick={() => setShowReviewHelp(true)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-[#356df3] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_24px_rgba(53,109,243,0.3)] hover:bg-[#2d60da]"
        aria-label="그래프 검토 방법 보기"
      >
        <span className="flex size-5 items-center justify-center rounded-full border border-white/70 text-xs">?</span>
        검토 방법
      </button>

      {showReviewHelp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#172033]/35 p-4" role="presentation" onMouseDown={() => setShowReviewHelp(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-help-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-[#356df3]">그래프 검토 방법</span>
                <h3 id="review-help-title" className="mt-1 text-lg font-bold text-[#263449]">계산을 다시 하실 필요는 없어요</h3>
              </div>
              <button type="button" onClick={() => setShowReviewHelp(false)} className="rounded-md px-2 py-1 text-xl text-[#7f8b9c] hover:bg-[#f1f4f8]" aria-label="닫기">×</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#66758b]">
              응답 수, 평균과 NPS 계산은 시스템이 확인합니다. 사용자는 그래프의 숫자를 원본과 일일이 대조하지 않고, 아래 두 가지만 판단하면 됩니다.
            </p>
            <ol className="mt-4 space-y-3 text-sm text-[#526076]">
              <li className="rounded-lg bg-[#f7f9fd] p-3"><strong className="block text-[#263449]">1. 결과가 실제 조사 경험과 크게 어긋나지 않나요?</strong><span className="mt-1 block leading-5">예상과 전혀 다른 결과가 있다면 원본 데이터의 문항 연결을 다시 확인합니다.</span></li>
              <li className="rounded-lg bg-[#f7f9fd] p-3"><strong className="block text-[#263449]">2. 확인 필요 안내가 있나요?</strong><span className="mt-1 block leading-5">평가가 갈리거나 응답자가 적은 결과는 단정하지 않고, 다음 의견 분석에서 이유를 확인합니다.</span></li>
            </ol>
            <div className="mt-4 rounded-lg border border-[#dce6fa] bg-[#f5f8ff] px-3 py-2.5 text-xs leading-5 text-[#53657f]">
              이상이 없다면 각 그래프를 훑어본 뒤 아래 확인란을 선택하면 됩니다.
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
