import type { QuantStats } from "@/lib/quant/compute";
import type { CategoryCount, MeanSd } from "@/lib/quant/basic";

// 도표 제목("나이대 분포", "성별" 등)이 너무 작고 굵지 않아 도표끼리 구별이 잘 안 된다는
// 실측 피드백(2026-07-20) — 굵게·크게 키우고 밑줄로 그룹을 구분한다.
const subLabel =
  "text-sm font-bold text-zinc-800 dark:text-zinc-100 pb-1 mb-1 border-b border-zinc-200 dark:border-zinc-700";
const chartGroupBox =
  "rounded-md border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/20";

/**
 * 표만 나열하면 "어떤 게 더 큰지" 한눈에 안 들어온다는 실측 피드백(2026-07-20) — 값 자체는
 * 맞아도 사용자가 바로 해석할 수 없으면 소용없다는 원칙에 따라, 단일 값 비교가 필요한 곳은
 * 전부 막대그래프로 바꿨다(순수 CSS, 차트 라이브러리 불필요 — lib/pdf/charts.tsx의 PDF쪽
 * View 기반 막대와 같은 접근).
 */
function BarRow({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 truncate" title={label}>
        {label}
      </span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
        {value}
        {unit}
      </span>
    </div>
  );
}

function MeanSdBarChart({
  rows,
  showSd = true,
}: {
  rows: { name: string; mean: number; sd: number; n?: number }[];
  showSd?: boolean;
}) {
  return (
    <div className="mt-1">
      {rows.map((r) => (
        <BarRow key={r.name} label={r.name} value={r.mean} max={10} unit="점" />
      ))}
      {showSd && (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          표준편차: {rows.map((r) => `${r.name} ${r.sd}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function DistributionBarChart({ rows }: { rows: CategoryCount[] }) {
  return (
    <div className="mt-1">
      {rows.map((r) => (
        <BarRow key={r.label} label={r.label} value={r.percentage} max={100} unit="%" />
      ))}
    </div>
  );
}

/** 순위 기반 상대중요도는 음수도 나올 수 있어(6.8절 공식) 0을 기준으로 좌우로 뻗는 막대로 그린다. */
function DivergingBarRow({ label, value, maxAbs }: { label: string; value: number; maxAbs: number }) {
  const pct = maxAbs === 0 ? 0 : Math.min(100, (Math.abs(value) / maxAbs) * 100) / 2;
  const isPositive = value >= 0;
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 truncate" title={label}>
        {label}
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-300 dark:bg-zinc-600" />
        <div
          className={`absolute inset-y-0 rounded ${isPositive ? "bg-teal-500" : "bg-red-400"}`}
          style={
            isPositive
              ? { left: "50%", width: `${pct}%` }
              : { right: "50%", width: `${pct}%` }
          }
        />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{value}</span>
    </div>
  );
}

function oneLineMeanSd(label: string, s: MeanSd): string {
  return `${label}: ${s.mean}점 (SD ${s.sd}, n=${s.n})`;
}

/** PRD 3.2절(v1.4) UX 원칙 — 접기/펼치기로 8개 섹션을 한 번에 다 안 보여주고 필요한 것만 열게 한다. */
function Section({ numeral, title, children }: { numeral: string; title: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className="text-zinc-400 transition-transform group-open:rotate-90 dark:text-zinc-500">▶</span>
        <span className="text-base font-bold">
          {numeral}. {title}
        </span>
      </summary>
      <div className="mt-2 pl-5">{children}</div>
    </details>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/40">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-base font-bold text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}

export function QuantStatsSummary({ s }: { s: QuantStats }) {
  const rankedImportance = [...s.relativeImportance].sort((a, b) => b.score - a.score);
  const rankedFeatures = [...s.featureSatisfaction].sort((a, b) => b.mean - a.mean);
  const topFeature = rankedFeatures[0];
  const topImportance = rankedImportance[0];
  const maxImportanceAbs = Math.max(1, ...s.relativeImportance.map((r) => Math.abs(r.score)));

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 text-base text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="text-base font-semibold">정량 통계 계산 완료 (응답자 {s.respondentCount}명)</p>
      {/* 카드 자체에 "왜 지금 이게 나왔는지" + "확인하고 넘어가는 절차"임을 고정으로 박아둔다 —
          채팅 텍스트는 스크롤로 지나가 버릴 수 있지만 이 문구는 카드를 볼 때마다 항상 보인다
          (2026-07-20 피드백: 연결 문구를 채팅에 한 번 띄우는 것만으로는 부족했고, "정량 통계를
          낼 거다 → 확인하고 넘어가는 절차다"라는 흐름 자체를 고지하고 싶다는 요청). 아래 섹션
          번호(Ⅱ~Ⅷ)는 방금 동의한 목차 카드의 섹션 번호와 그대로 대응된다. */}
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        방금 동의하신 목차의 Ⅱ~Ⅷ장에 그대로 들어갈 내용이에요(아래 섹션 번호가 목차의 섹션
        번호와 같습니다). 내용을 확인해주시면 다음 단계(정성 분석 진행 여부)로 넘어갑니다.
      </p>

      {/* 핵심 요약 — 표를 하나하나 안 읽어도 결과의 큰 그림이 바로 보이게 */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="NPS" value={`${s.nps.npsScore}`} />
        <StatTile label="종합만족도" value={`${s.overallSatisfaction.mean}점`} />
        {topFeature && <StatTile label="1위 기능" value={`${topFeature.name} (${topFeature.mean}점)`} />}
        {topImportance && <StatTile label="핵심구매요소 1위" value={topImportance.name} />}
      </div>

      <div className="mt-4">
        <Section numeral="Ⅱ" title="인적사항 및 특성조사">
          <ul className="space-y-1 text-sm">
            <li>
              나이: 평균 {s.demographics.age.mean}세 (SD {s.demographics.age.sd}, n={s.demographics.age.n})
            </li>
            <li>
              유사서비스 경험률: {s.demographics.priorServiceExperienceRate}% (경험자 만족도:{" "}
              {s.demographics.priorServiceSatisfaction.mean}점, n={s.demographics.priorServiceSatisfaction.n})
            </li>
          </ul>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={chartGroupBox}>
              <p className={subLabel}>나이대 분포</p>
              <DistributionBarChart rows={s.demographics.ageDistribution} />
            </div>
            <div className={chartGroupBox}>
              <p className={subLabel}>성별</p>
              <DistributionBarChart rows={s.demographics.gender} />
            </div>
            <div className={chartGroupBox}>
              <p className={subLabel}>운영체제</p>
              <DistributionBarChart rows={s.demographics.os} />
            </div>
            <div className={chartGroupBox}>
              <p className={subLabel}>하루 평균 걷는 시간</p>
              <DistributionBarChart rows={s.demographics.avgWalkTime} />
            </div>
            <div className={chartGroupBox}>
              <p className={subLabel}>일주일 기준 산책 빈도</p>
              <DistributionBarChart rows={s.demographics.walkFrequencyPerWeek} />
            </div>
          </div>
        </Section>

        <Section numeral="Ⅲ" title="기능별 고객경험평가">
          <MeanSdBarChart rows={s.featureSatisfaction} />
        </Section>

        <Section numeral="Ⅳ" title="핵심구매요소">
          <div className={chartGroupBox}>
            <p className={subLabel}>상대중요도 (높은 순)</p>
            <div className="mt-1">
              {rankedImportance.map((r) => (
                <DivergingBarRow key={r.name} label={r.name} value={r.score} maxAbs={maxImportanceAbs} />
              ))}
            </div>
          </div>
          <div className={`mt-3 ${chartGroupBox}`}>
            <p className={subLabel}>핵심구매요소 응답 분포</p>
            <DistributionBarChart rows={s.keyFactorDistribution} />
          </div>
        </Section>

        <Section numeral="Ⅴ" title="4대가치 만족도">
          <MeanSdBarChart
            rows={[
              { name: "기능적", ...s.fourValues.functional },
              { name: "심미적", ...s.fourValues.aesthetic },
              { name: "경제적", ...s.fourValues.economic },
              { name: "사회·공공적", ...s.fourValues.social },
            ]}
          />
        </Section>

        <Section numeral="Ⅵ" title="사용자 경험 품질 평가">
          <div className={chartGroupBox}>
            <p className={subLabel}>실용성</p>
            <MeanSdBarChart rows={s.uxQuality.usability} />
          </div>
          <div className={`mt-3 ${chartGroupBox}`}>
            <p className={subLabel}>즐거움</p>
            <MeanSdBarChart rows={s.uxQuality.fun} />
          </div>
        </Section>

        <Section numeral="Ⅷ" title="NPS 종합만족도 및 개선아이디어">
          <ul className="space-y-1 text-sm">
            <li>{oneLineMeanSd("전반적 만족도", s.overallSatisfaction)}</li>
          </ul>
          <div className={`mt-3 ${chartGroupBox}`}>
            <p className={subLabel}>NPS: {s.nps.npsScore} (n={s.nps.n})</p>
            <DistributionBarChart
              rows={[
                { label: "추천(9~10점)", count: 0, percentage: s.nps.promoterPct },
                { label: "중립(7~8점)", count: 0, percentage: s.nps.passivePct },
                { label: "비추천(0~6점)", count: 0, percentage: s.nps.detractorPct },
              ]}
            />
          </div>
        </Section>

        <Section numeral="Ⅶ" title="교차분석">
          <div className={chartGroupBox}>
            <p className={subLabel}>연령대별 기능 만족도</p>
            {s.crossAnalysis.byAgeGroup.map((g) => (
              <div key={g.group} className="mt-2">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {g.group} (n={g.n})
                </p>
                <MeanSdBarChart
                  showSd={false}
                  rows={[
                    ...g.featureSatisfaction.map((f) => ({ name: f.name, mean: f.mean, sd: 0 })),
                    { name: "기능적가치", mean: g.fourValues.functional, sd: 0 },
                    { name: "심미적가치", mean: g.fourValues.aesthetic, sd: 0 },
                    { name: "경제적가치", mean: g.fourValues.economic, sd: 0 },
                    { name: "사회공공가치", mean: g.fourValues.social, sd: 0 },
                  ]}
                />
              </div>
            ))}
          </div>
          <div className={`mt-3 ${chartGroupBox}`}>
            <p className={subLabel}>성별 기능 만족도</p>
            {s.crossAnalysis.byGender.map((g) => (
              <div key={g.group} className="mt-2">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {g.group} (n={g.n})
                </p>
                <MeanSdBarChart
                  showSd={false}
                  rows={[
                    ...g.featureSatisfaction.map((f) => ({ name: f.name, mean: f.mean, sd: 0 })),
                    { name: "기능적가치", mean: g.fourValues.functional, sd: 0 },
                    { name: "심미적가치", mean: g.fourValues.aesthetic, sd: 0 },
                    { name: "경제적가치", mean: g.fourValues.economic, sd: 0 },
                    { name: "사회공공가치", mean: g.fourValues.social, sd: 0 },
                  ]}
                />
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
