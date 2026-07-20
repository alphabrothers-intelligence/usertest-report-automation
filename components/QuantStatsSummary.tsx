import type { QuantStats } from "@/lib/quant/compute";
import type { CategoryCount, MeanSd } from "@/lib/quant/basic";

const subLabel = "text-sm text-zinc-600 dark:text-zinc-400";
const tableWrap = "mt-2 overflow-x-auto rounded-md border border-zinc-100 dark:border-zinc-800";
const table = "w-full min-w-[320px] border-collapse text-sm";
const th = "border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300";
const td = "border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800";

function MeanSdTable({ rows }: { rows: { name: string; mean: number; sd: number; n?: number }[] }) {
  return (
    <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th className={th}>항목</th>
            <th className={th}>평균</th>
            <th className={th}>SD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className={td}>{r.name}</td>
              <td className={td}>{r.mean}</td>
              <td className={td}>{r.sd}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributionTable({ rows }: { rows: CategoryCount[] }) {
  return (
    <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th className={th}>항목</th>
            <th className={th}>건수</th>
            <th className={th}>비율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className={td}>{r.label}</td>
              <td className={td}>{r.count}</td>
              <td className={td}>{r.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
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

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 text-base text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="text-base font-semibold">정량 통계 계산 완료 (응답자 {s.respondentCount}명)</p>

      {/* 핵심 요약 — 표를 하나하나 안 읽어도 결과의 큰 그림이 바로 보이게 */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="NPS" value={`${s.nps.npsScore}`} />
        <StatTile label="종합만족도" value={`${s.overallSatisfaction.mean}점`} />
        {topFeature && <StatTile label="1위 기능" value={`${topFeature.name} (${topFeature.mean}점)`} />}
        {topImportance && <StatTile label="핵심구매요소 1위" value={topImportance.name} />}
      </div>

      <div className="mt-4">
        <Section numeral="Ⅱ" title="인적사항">
          <ul className="space-y-1 text-sm">
            <li>{oneLineMeanSd("나이", s.demographics.age)}</li>
            <li>
              유사서비스 경험률: {s.demographics.priorServiceExperienceRate}% (경험자 만족도:{" "}
              {s.demographics.priorServiceSatisfaction.mean}점, n={s.demographics.priorServiceSatisfaction.n})
            </li>
          </ul>
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <p className={subLabel}>성별</p>
              <DistributionTable rows={s.demographics.gender} />
            </div>
            <div>
              <p className={subLabel}>운영체제</p>
              <DistributionTable rows={s.demographics.os} />
            </div>
            <div>
              <p className={subLabel}>하루 평균 걷는 시간</p>
              <DistributionTable rows={s.demographics.avgWalkTime} />
            </div>
            <div>
              <p className={subLabel}>일주일 기준 산책 빈도</p>
              <DistributionTable rows={s.demographics.walkFrequencyPerWeek} />
            </div>
          </div>
        </Section>

        <Section numeral="Ⅲ" title="기능별 만족도">
          <MeanSdTable rows={s.featureSatisfaction} />
        </Section>

        <Section numeral="Ⅳ" title="핵심구매요소">
          <p className={subLabel}>상대중요도 (높은 순)</p>
          <ul className="mt-1 space-y-1 text-sm">
            {rankedImportance.map((r) => (
              <li key={r.name}>
                {r.name}: {r.score}
              </li>
            ))}
          </ul>
          <p className={`mt-3 ${subLabel}`}>핵심구매요소 응답 분포</p>
          <DistributionTable rows={s.keyFactorDistribution} />
        </Section>

        <Section numeral="Ⅴ" title="4대가치 만족도">
          <MeanSdTable
            rows={[
              { name: "기능적", ...s.fourValues.functional },
              { name: "심미적", ...s.fourValues.aesthetic },
              { name: "경제적", ...s.fourValues.economic },
              { name: "사회·공공적", ...s.fourValues.social },
            ]}
          />
        </Section>

        <Section numeral="Ⅵ" title="UX 품질">
          <p className={subLabel}>실용성</p>
          <MeanSdTable rows={s.uxQuality.usability} />
          <p className={`mt-3 ${subLabel}`}>즐거움</p>
          <MeanSdTable rows={s.uxQuality.fun} />
        </Section>

        <Section numeral="Ⅷ" title="종합만족도 · NPS">
          <ul className="space-y-1 text-sm">
            <li>{oneLineMeanSd("전반적 만족도", s.overallSatisfaction)}</li>
            <li>
              NPS: {s.nps.npsScore} (추천 {s.nps.promoterPct}% · 중립 {s.nps.passivePct}% · 비추천{" "}
              {s.nps.detractorPct}%, n={s.nps.n})
            </li>
          </ul>
        </Section>

        <Section numeral="Ⅶ" title="교차분석">
          <p className={subLabel}>연령대별 (기능별 만족도 평균)</p>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>구간(n)</th>
                  {s.crossAnalysis.byAgeGroup[0]?.featureSatisfaction.map((f) => (
                    <th key={f.name} className={th}>
                      {f.name}
                    </th>
                  ))}
                  <th className={th}>기능적</th>
                  <th className={th}>심미적</th>
                  <th className={th}>경제적</th>
                  <th className={th}>사회·공공</th>
                </tr>
              </thead>
              <tbody>
                {s.crossAnalysis.byAgeGroup.map((g) => (
                  <tr key={g.group}>
                    <td className={td}>
                      {g.group} ({g.n})
                    </td>
                    {g.featureSatisfaction.map((f) => (
                      <td key={f.name} className={td}>
                        {f.mean}
                      </td>
                    ))}
                    <td className={td}>{g.fourValues.functional}</td>
                    <td className={td}>{g.fourValues.aesthetic}</td>
                    <td className={td}>{g.fourValues.economic}</td>
                    <td className={td}>{g.fourValues.social}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`mt-3 ${subLabel}`}>성별 (기능별 만족도 평균)</p>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>성별(n)</th>
                  {s.crossAnalysis.byGender[0]?.featureSatisfaction.map((f) => (
                    <th key={f.name} className={th}>
                      {f.name}
                    </th>
                  ))}
                  <th className={th}>기능적</th>
                  <th className={th}>심미적</th>
                  <th className={th}>경제적</th>
                  <th className={th}>사회·공공</th>
                </tr>
              </thead>
              <tbody>
                {s.crossAnalysis.byGender.map((g) => (
                  <tr key={g.group}>
                    <td className={td}>
                      {g.group} ({g.n})
                    </td>
                    {g.featureSatisfaction.map((f) => (
                      <td key={f.name} className={td}>
                        {f.mean}
                      </td>
                    ))}
                    <td className={td}>{g.fourValues.functional}</td>
                    <td className={td}>{g.fourValues.aesthetic}</td>
                    <td className={td}>{g.fourValues.economic}</td>
                    <td className={td}>{g.fourValues.social}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
