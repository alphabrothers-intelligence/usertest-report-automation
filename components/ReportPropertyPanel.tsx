"use client";

/** 선택한 표·차트의 데이터 계약을 오른쪽 패널에서 편집한다.
 * 본문 차트 아래에는 편집용 값 목록을 두지 않는다. 항목명을 바꾸는 경우 연결된 행 데이터의
 * 키까지 함께 바꿔, 범례·막대·PNG 다운로드가 항상 같은 이름을 사용하도록 한다. */
import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type {
  ReportBlock,
  ReportGroupedBarBlock,
  ReportJourneyLineBlock,
  ReportWaterfallBlock,
  ReportRankCompositionBlock,
  ReportRichStaticBlock,
  ReportStackedBarBlock,
  ReportTableBlock,
} from "@/lib/report/sections";
import { donutSvg, satisfactionHistogramSvg, type PolarityKey } from "@/lib/report/chartSvg";

type Props = { block: ReportBlock | null; onChange: (next: ReportBlock) => void };

/** 블록 종류의 사람 이름. 패널 머리말과 순서 목록이 **같은 이름을 쓴다**. */
const BLOCK_KIND_LABELS: Partial<Record<ReportBlock["kind"], string>> = {
  chart: "막대 차트",
  table: "표",
  heading: "제목",
  quadrant: "사분면 차트",
  radar: "방사형 차트",
  "journey-line": "시점별 추이 차트",
  waterfall: "구간별 증감 차트",
  nps: "NPS 차트",
  polarity: "감정 분석 도넛",
  "row-group": "항목·주요 의견 표",
};

/**
 * 선택한 블록의 쪽 배치 속성(Word의 표 속성·단락 속성). 자동 규칙(`lib/report/paginate.ts`·
 * `splitBlock.ts`)은 그대로 두고 **예외만 여기서 지정**한다. 고른 블록 종류에 맞는 것만 보인다
 * — 체크박스를 한꺼번에 펼쳐두던 첫 판은 "최악"이라는 지적을 받았다(2026-09-30).
 */
export type BlockLayoutControls = {
  /** 표(행 단위로 넘어가는 블록)인지 — 표 속성/단락 속성 중 무엇을 보여줄지 정한다. */
  isTable: boolean;
  pageBreakBefore: boolean;
  keepTogether: boolean;
  keepWithNext: boolean;
  rowBreak: boolean;
  /** 지정했지만 지금 배치에서 지켜지지 않은 이유(없으면 null). */
  notice: string | null;
  onTogglePageBreakBefore: (on: boolean) => void;
  onToggleKeepTogether: (on: boolean) => void;
  onToggleKeepWithNext: (on: boolean) => void;
  onToggleRowBreak: (on: boolean) => void;
};

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-[#f7f9fc]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0066cc]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-900">{label}</span>
        <span className="block text-xs leading-5 text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}

export function BlockLayoutFields({ layout }: { layout: BlockLayoutControls }) {
  const [tab, setTab] = useState<"table" | "row">("table");
  const notice = layout.notice ? <p className="mt-2 rounded-md bg-[#fff6e5] px-2 py-1.5 text-xs leading-5 text-[#8a5300]">{layout.notice}</p> : null;
  if (!layout.isTable) {
    return (
      <div className="space-y-1">
        <Toggle label="이 블록 앞에서 쪽 나누기" hint="자리가 남아도 이 블록부터 새 쪽에서 시작합니다. (본문에서 Ctrl+Enter)" checked={layout.pageBreakBefore} onChange={layout.onTogglePageBreakBefore} />
        <Toggle label="다음 블록과 함께 두기" hint="쪽이 갈릴 때 바로 아래 블록과 떨어지지 않습니다." checked={layout.keepWithNext} onChange={layout.onToggleKeepWithNext} />
        {notice}
      </div>
    );
  }
  return (
    <div>
      <div role="tablist" className="mb-2 inline-flex rounded-lg bg-[#f0f0f2] p-0.5 text-sm">
        {(["table", "row"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-md px-4 py-1 ${tab === id ? "bg-[#0066cc] font-semibold text-white" : "text-zinc-700"}`}
          >
            {id === "table" ? "표" : "행"}
          </button>
        ))}
      </div>
      {tab === "table" ? (
        <div className="space-y-1">
          <Toggle label="다음 쪽으로 이어지게 허용" hint="끄면 표를 쪼개지 않고 통째로 한 쪽에 둡니다." checked={!layout.keepTogether} onChange={(on) => layout.onToggleKeepTogether(!on)} />
          <Toggle label="이 표 앞에서 쪽 나누기" hint="자리가 남아도 이 표부터 새 쪽에서 시작합니다." checked={layout.pageBreakBefore} onChange={layout.onTogglePageBreakBefore} />
        </div>
      ) : (
        <Toggle label="페이지 끝에서 행을 자동으로 나누기" hint="끄면 쪽 끝에 걸린 행을 반으로 자르지 않고 그 행부터 다음 쪽으로 넘깁니다." checked={layout.rowBreak} onChange={layout.onToggleRowBreak} />
      )}
      {notice}
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-medium text-zinc-700">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border border-[#d7dce8] bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#315c9c]" /></label>;
}

function NumberField({ label, value, onChange, step = "0.01" }: { label: string; value: number; onChange: (value: number) => void; step?: string }) {
  return <label className="block text-xs font-medium text-zinc-700">{label}<input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded border border-[#d7dce8] bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-[#315c9c]" /></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-700">{label}<input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[#d7dce8] bg-white p-0.5" /></label>;
}

function PanelTitle({ children }: { children: ReactNode }) {
  return <p className="border-b border-[#e7eaf0] pb-2 pt-1 text-xs font-bold text-[#315c9c]">{children}</p>;
}

/**
 * 항목 한 줄을 지우는 버튼. **가로축 항목은 언제든 지울 수 있어야 한다**(2026-09-11 담당자
 * 요청) — raw data에 잡힌 항목이 보고서에 그대로 나가면 안 되는 경우가 실제로 있다.
 * 마지막 한 줄은 남긴다(항목 0개짜리 차트는 그릴 것이 없다).
 */
function RemoveButton({ onRemove, disabled }: { onRemove: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      aria-label="이 항목 삭제"
      title={disabled ? "마지막 항목은 지울 수 없습니다" : "이 항목 삭제"}
      className="mt-[18px] h-[30px] w-7 shrink-0 rounded border border-[#e2c7c7] text-sm font-bold text-[#b4534b] hover:bg-[#fdf1f0] disabled:cursor-not-allowed disabled:opacity-40"
    >
      ×
    </button>
  );
}

function safeName(next: string, previous: string) {
  return next.trim() || previous;
}

function TableFields({ block, onChange }: { block: ReportTableBlock; onChange: (next: ReportTableBlock) => void }) {
  function changeCell(rowIndex: number, colIndex: number, event: ChangeEvent<HTMLInputElement>) {
    const original = block.rows[rowIndex][colIndex];
    const value = typeof original === "number" ? Number(event.target.value) : event.target.value;
    onChange({ ...block, rows: block.rows.map((row, ri) => ri === rowIndex ? row.map((cell, ci) => ci === colIndex ? value : cell) : row) });
  }
  return <>
    <TextField label="표 제목" value={block.title ?? ""} onChange={(title) => onChange({ ...block, title })} />
    <PanelTitle>열 제목</PanelTitle>
    {block.headers.map((header, index) => <TextField key={index} label={`${index + 1}열`} value={header} onChange={(value) => onChange({ ...block, headers: block.headers.map((item, i) => i === index ? value : item) })} />)}
    <PanelTitle>표 셀</PanelTitle>
    <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
      {block.rows.map((row, rowIndex) => <div key={rowIndex} className="grid grid-cols-2 gap-1">{row.map((cell, colIndex) => <input key={colIndex} type={typeof cell === "number" ? "number" : "text"} step="0.01" value={cell} onChange={(event) => changeCell(rowIndex, colIndex, event)} aria-label={`${rowIndex + 1}행 ${colIndex + 1}열`} className="min-w-0 rounded border border-[#d7dce8] px-1.5 py-1 text-xs outline-none focus:border-[#315c9c]" />)}</div>)}
    </div>
  </>;
}

function RankCompositionFields({ block, onChange }: { block: ReportRankCompositionBlock; onChange: (next: ReportRankCompositionBlock) => void }) {
  function renameCandidate(previous: string, typed: string) {
    const name = safeName(typed, previous);
    if (name !== previous && block.candidates.some((candidate) => candidate.name === name)) return;
    onChange({
      ...block,
      candidates: block.candidates.map((candidate) => candidate.name === previous ? { ...candidate, name } : candidate),
      rows: block.rows.map((row) => ({ ...row, segments: row.segments.map((segment) => segment.name === previous ? { ...segment, name } : segment) })),
    });
  }
  return <>
    <TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} />
    <PanelTitle>범례 항목·색상</PanelTitle>
    {block.candidates.map((candidate, index) => <div key={`${candidate.name}-${index}`} className="space-y-1 rounded border border-[#e7eaf0] p-2"><TextField label="항목명" value={candidate.name} onChange={(name) => renameCandidate(candidate.name, name)} /><ColorField label="색상" value={candidate.color} onChange={(color) => onChange({ ...block, candidates: block.candidates.map((v) => v.name === candidate.name ? { ...v, color } : v) })} /></div>)}
    <PanelTitle>순위별 구성 비율</PanelTitle>
    {block.rows.map((row, rowIndex) => {
      const total = row.segments.reduce((sum, segment) => sum + segment.percentage, 0);
      return <div key={row.rank} className="rounded border border-[#e7eaf0] p-2"><p className={`mb-2 text-xs font-bold ${Math.abs(total - 100) < 0.11 ? "text-zinc-600" : "text-[#c2410c]"}`}>{row.rank}위 · 합계 {total.toFixed(1)}%</p><div className="grid grid-cols-2 gap-2">{row.segments.map((segment) => <NumberField key={segment.name} label={segment.name} value={segment.percentage} onChange={(percentage) => onChange({ ...block, rows: block.rows.map((r, ri) => ri === rowIndex ? { ...r, segments: r.segments.map((s) => s.name === segment.name ? { ...s, percentage: Math.max(0, percentage) } : s) } : r) })} />)}</div></div>;
    })}
  </>;
}

function StackedBarFields({ block, onChange }: { block: ReportStackedBarBlock; onChange: (next: ReportStackedBarBlock) => void }) {
  function renameCategory(previous: string, typed: string) {
    const name = safeName(typed, previous);
    if (name !== previous && block.categories.some((category) => category.name === name)) return;
    onChange({ ...block, categories: block.categories.map((category) => category.name === previous ? { ...category, name } : category), rows: block.rows.map((row) => ({ ...row, segments: row.segments.map((segment) => segment.name === previous ? { ...segment, name } : segment) })) });
  }
  return <>
    <TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} />
    <div className="grid grid-cols-2 gap-2"><TextField label="단위" value={block.unit} onChange={(unit) => onChange({ ...block, unit })} /><NumberField label="X축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} /></div>
    <PanelTitle>범례 항목·색상</PanelTitle>
    {block.categories.map((category, index) => <div key={`${category.name}-${index}`} className="space-y-1 rounded border border-[#e7eaf0] p-2"><TextField label="항목명" value={category.name} onChange={(name) => renameCategory(category.name, name)} /><ColorField label="색상" value={category.color} onChange={(color) => onChange({ ...block, categories: block.categories.map((v) => v.name === category.name ? { ...v, color } : v) })} /></div>)}
    <PanelTitle>행별 값</PanelTitle>
    {block.rows.map((row, rowIndex) => <div key={rowIndex} className="rounded border border-[#e7eaf0] p-2"><TextField label="행 이름" value={row.label} onChange={(label) => onChange({ ...block, rows: block.rows.map((r, ri) => ri === rowIndex ? { ...r, label } : r) })} /><div className="mt-2 grid grid-cols-2 gap-2">{row.segments.map((segment) => <NumberField key={segment.name} label={segment.name} value={segment.value} onChange={(value) => onChange({ ...block, rows: block.rows.map((r, ri) => ri === rowIndex ? { ...r, segments: r.segments.map((s) => s.name === segment.name ? { ...s, value: Math.max(0, value) } : s) } : r) })} />)}</div></div>)}
  </>;
}

function GroupedBarFields({ block, onChange }: { block: ReportGroupedBarBlock; onChange: (next: ReportGroupedBarBlock) => void }) {
  function renameSeries(previous: string, typed: string) {
    const name = safeName(typed, previous);
    if (name !== previous && block.series.some((series) => series.name === name)) return;
    onChange({ ...block, series: block.series.map((series) => series.name === previous ? { ...series, name } : series), categories: block.categories.map((category) => ({ ...category, values: category.values.map((value) => value.series === previous ? { ...value, series: name } : value) })) });
  }
  return <>
    <TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} />
    <div className="grid grid-cols-2 gap-2"><NumberField label="Y축 최솟값" value={block.axisMin} onChange={(axisMin) => onChange({ ...block, axisMin })} /><NumberField label="Y축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} /></div><TextField label="단위" value={block.unit} onChange={(unit) => onChange({ ...block, unit })} />
    <PanelTitle>비교 집단·색상</PanelTitle>
    {block.series.map((series, index) => <div key={`${series.name}-${index}`} className="space-y-1 rounded border border-[#e7eaf0] p-2"><TextField label="집단명" value={series.name} onChange={(name) => renameSeries(series.name, name)} /><ColorField label="색상" value={series.color} onChange={(color) => onChange({ ...block, series: block.series.map((v) => v.name === series.name ? { ...v, color } : v) })} /></div>)}
    <PanelTitle>항목별 값</PanelTitle>
    {block.categories.map((category, ci) => <div key={ci} className="rounded border border-[#e7eaf0] p-2"><TextField label="항목명" value={category.label} onChange={(label) => onChange({ ...block, categories: block.categories.map((v, i) => i === ci ? { ...v, label } : v) })} /><div className="mt-2 grid grid-cols-2 gap-2">{category.values.map((entry) => <NumberField key={entry.series} label={entry.series} value={entry.value} onChange={(value) => onChange({ ...block, categories: block.categories.map((v, i) => i === ci ? { ...v, values: v.values.map((item) => item.series === entry.series ? { ...item, value } : item) } : v) })} />)}</div></div>)}
  </>;
}

type EmbeddedChart =
  | { kind: "histogram"; distribution: number[]; xLabel: string; yLabel: string; barColor: string; peakColor: string; yMax: number; tickCount: number }
  | { kind: "donut"; values: Record<PolarityKey, number>; labels: Record<PolarityKey, string>; colors: Record<PolarityKey, string> };

function embeddedChartFromHtml(html: string, blockId: string, chartIndex = 0): EmbeddedChart | null {
  const svg = Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll<SVGElement>("svg[data-report-chart], svg"))[chartIndex];
  if (!svg) return null;
  if (svg.dataset.reportChart === "satisfaction-histogram") {
    const distribution = (svg.dataset.distribution ?? "").split(",").map(Number).filter(Number.isFinite);
    return {
      kind: "histogram",
      distribution: distribution.length === 11 ? distribution : Array.from({ length: 11 }, () => 0),
      xLabel: svg.dataset.xLabel || "만족도 점수",
      yLabel: svg.dataset.yLabel || "응답자 수",
      barColor: svg.dataset.barColor || "#2ed6a4",
      peakColor: svg.dataset.peakColor || "#078c44",
      yMax: Math.max(1, Number(svg.dataset.yMax) || Math.max(5, ...distribution)),
      tickCount: Math.max(2, Math.min(10, Math.round(Number(svg.dataset.tickCount) || 5))),
    };
  }
  if (svg.dataset.reportChart === "polarity-donut") {
    const keys: PolarityKey[] = ["positive", "negative", "neutral"];
    return {
      kind: "donut",
      values: Object.fromEntries(keys.map((key) => [key, Math.max(0, Number(svg.dataset[key]) || 0)])) as Record<PolarityKey, number>,
      labels: Object.fromEntries(keys.map((key) => [key, svg.dataset[`${key}Label`] || ({ positive: "긍정", negative: "부정", neutral: "중립" }[key])])) as Record<PolarityKey, string>,
      colors: Object.fromEntries(keys.map((key) => [key, svg.dataset[`${key}Color`] || ({ positive: "#5b73c4", negative: "#e07a3f", neutral: "#b8b8b8" }[key])])) as Record<PolarityKey, string>,
    };
  }

  // 이전에 이미 생성되어 저장된 보고서도 새 문서를 다시 만들지 않고 편집할 수 있게 한다.
  // 예전 SVG에는 data-report-chart 메타데이터가 없으므로, 블록 ID와 SVG 안의 값 라벨을 이용해 복원한다.
  const legacyHistogram = /-scorebox$/.test(blockId) || html.includes("만족도 분포도");
  if (legacyHistogram) {
    const distribution = Array.from(svg.querySelectorAll<SVGTextElement>('text[font-weight="700"]'))
      .map((element) => Number(element.textContent?.trim()))
      .filter(Number.isFinite);
    return {
      kind: "histogram",
      distribution: distribution.length === 11 ? distribution : Array.from({ length: 11 }, () => 0),
      xLabel: "만족도 점수",
      yLabel: "응답자 수",
      barColor: "#2ed6a4",
      peakColor: "#078c44",
      yMax: Math.max(5, ...distribution),
      tickCount: 5,
    };
  }

  const legacyDonut = /-(emotionbox|chart)$/.test(blockId) || html.includes("주관식 응답 감정 분석");
  if (legacyDonut) {
    const keys: PolarityKey[] = ["positive", "negative", "neutral"];
    const defaults = { positive: "긍정", negative: "부정", neutral: "중립" } as const;
    const counts = Array.from(html.matchAll(/\((\d+)\s*건\)/g)).map((match) => Number(match[1]));
    const percentages = Array.from(svg.querySelectorAll("text"))
      .map((element) => Number((element.textContent ?? "").replace("%", "").trim()))
      .filter(Number.isFinite);
    const values = counts.length >= 3 ? counts.slice(0, 3) : percentages.slice(0, 3);
    return {
      kind: "donut",
      values: Object.fromEntries(keys.map((key, index) => [key, Math.max(0, values[index] ?? 0)])) as Record<PolarityKey, number>,
      labels: Object.fromEntries(keys.map((key) => [key, defaults[key]])) as Record<PolarityKey, string>,
      colors: { positive: "#5b73c4", negative: "#e07a3f", neutral: "#b8b8b8" },
    };
  }
  return null;
}

function updateEmbeddedChart(block: ReportRichStaticBlock, svgHtml: string, chartIndex: number): ReportRichStaticBlock {
  // 표·응답 요약 HTML은 그대로 두고 선택한 SVG만 교체한다. 예전 초안처럼 한 블록에
  // 두 개 이상의 그래프가 있어도 첫 번째 그래프가 덮어써지지 않는다.
  let index = -1;
  return {
    ...block,
    html: block.html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => {
      index += 1;
      return index === chartIndex ? svgHtml : svg;
    }),
  };
}

function EmbeddedChartFields({ block, onChange }: { block: ReportRichStaticBlock; onChange: (next: ReportRichStaticBlock) => void }) {
  const chartCount = (block.html.match(/<svg\b[\s>]/gi) ?? []).length;
  const [chartIndex, setChartIndex] = useState(0);
  const activeChartIndex = Math.min(chartIndex, Math.max(0, chartCount - 1));
  const chart = embeddedChartFromHtml(block.html, block.id, activeChartIndex);
  if (!chart) return <div className="rounded-lg bg-[#f7f9fc] p-3 text-xs leading-5 text-zinc-600">이 블록은 원본 서식 표 또는 텍스트입니다. 본문을 클릭해 직접 수정할 수 있습니다.</div>;

  const chartPicker = chartCount > 1 ? <><PanelTitle>편집할 차트</PanelTitle><div className="flex flex-wrap gap-1.5">{Array.from({ length: chartCount }, (_, index) => <button key={index} type="button" onClick={() => setChartIndex(index)} className={`rounded border px-2 py-1 text-xs font-semibold ${activeChartIndex === index ? "border-[#315c9c] bg-[#edf3fc] text-[#315c9c]" : "border-[#d7dce8] text-zinc-600 hover:bg-[#f7f9fc]"}`}>차트 {index + 1}</button>)}</div></> : null;

  if (chart.kind === "histogram") {
    const apply = (next: typeof chart) => onChange(updateEmbeddedChart(block, satisfactionHistogramSvg(next.distribution, {
      xLabel: next.xLabel, yLabel: next.yLabel, barColor: next.barColor, peakColor: next.peakColor,
      yMax: next.yMax, tickCount: next.tickCount,
    }), activeChartIndex));
    return <>
      {chartPicker}
      <PanelTitle>만족도 분포도 편집</PanelTitle>
      <div className="grid grid-cols-2 gap-2"><TextField label="X축 이름" value={chart.xLabel} onChange={(xLabel) => apply({ ...chart, xLabel })} /><TextField label="Y축 이름" value={chart.yLabel} onChange={(yLabel) => apply({ ...chart, yLabel })} /></div>
      <div className="grid grid-cols-2 gap-2"><NumberField label="Y축 최댓값" value={chart.yMax} step="1" onChange={(yMax) => apply({ ...chart, yMax: Math.max(Math.max(...chart.distribution), Math.round(yMax)) })} /><NumberField label="Y축 눈금 구간" value={chart.tickCount} step="1" onChange={(tickCount) => apply({ ...chart, tickCount: Math.max(2, Math.min(10, Math.round(tickCount))) })} /></div>
      <div className="grid grid-cols-2 gap-2"><ColorField label="기본 막대 색상" value={chart.barColor} onChange={(barColor) => apply({ ...chart, barColor })} /><ColorField label="최빈값 막대 색상" value={chart.peakColor} onChange={(peakColor) => apply({ ...chart, peakColor })} /></div>
      <PanelTitle>점수별 응답자 수</PanelTitle>
      <div className="grid grid-cols-2 gap-2">{chart.distribution.map((value, score) => <NumberField key={score} label={`${score}점`} value={value} step="1" onChange={(nextValue) => apply({ ...chart, distribution: chart.distribution.map((entry, index) => index === score ? Math.max(0, Math.round(nextValue)) : entry) })} />)}</div>
    </>;
  }

  const apply = (next: typeof chart) => onChange(updateEmbeddedChart(block, donutSvg(next.values, { labels: next.labels, colors: next.colors }), activeChartIndex));
  const names: Record<PolarityKey, string> = { positive: "긍정", negative: "부정", neutral: "중립" };
  return <>
    {chartPicker}
    <PanelTitle>주관식 응답 감정 분석 도넛 편집</PanelTitle>
    {(["positive", "negative", "neutral"] as PolarityKey[]).map((key) => <div key={key} className="space-y-2 rounded border border-[#e7eaf0] p-2">
      <TextField label={`${names[key]} 범례명`} value={chart.labels[key]} onChange={(label) => apply({ ...chart, labels: { ...chart.labels, [key]: safeName(label, names[key]) } })} />
      <div className="grid grid-cols-2 gap-2"><NumberField label="응답 건수" value={chart.values[key]} step="1" onChange={(value) => apply({ ...chart, values: { ...chart.values, [key]: Math.max(0, Math.round(value)) } })} /><ColorField label="색상" value={chart.colors[key]} onChange={(color) => apply({ ...chart, colors: { ...chart.colors, [key]: color } })} /></div>
    </div>)}
    <p className="text-xs leading-5 text-zinc-500">건수를 바꾸면 도넛 비율과 범례가 즉시 다시 계산됩니다.</p>
  </>;
}

/**
 * 고객 여정 꺾은선(L13)·구간 증감(L13a) 편집칸. **예전에는 이 두 종류만 편집칸이 아예
 * 없었다** — 그래서 x축 시점 이름이 raw data 헤더에서 잘린 채 나와도(케어클 "처음 받아보셨")
 * 담당자가 손댈 방법이 없었다(2026-09-11 지적). 다른 차트와 같은 규칙으로 이름·값·삭제를 준다.
 */
function JourneyLineFields({ block, onChange }: { block: ReportJourneyLineBlock; onChange: (next: ReportJourneyLineBlock) => void }) {
  return <>
    <TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} />
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="Y축 최솟값" value={block.axisMin} onChange={(axisMin) => onChange({ ...block, axisMin })} />
      <NumberField label="Y축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} />
    </div>
    <TextField label="단위" value={block.unit} onChange={(unit) => onChange({ ...block, unit })} />
    <PanelTitle>시점 이름 및 값</PanelTitle>
    {block.points.map((point, index) => <div key={index} className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-[1fr_76px] gap-2">
        <TextField label={`${index + 1}번 시점`} value={point.label} onChange={(label) => onChange({ ...block, points: block.points.map((v, i) => i === index ? { ...v, label } : v) })} />
        <NumberField label="값" value={point.value} onChange={(value) => onChange({ ...block, points: block.points.map((v, i) => i === index ? { ...v, value } : v) })} />
      </div>
      <RemoveButton disabled={block.points.length <= 1} onRemove={() => onChange({ ...block, points: block.points.filter((_, i) => i !== index) })} />
    </div>)}
  </>;
}

function WaterfallFields({ block, onChange }: { block: ReportWaterfallBlock; onChange: (next: ReportWaterfallBlock) => void }) {
  return <>
    <TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} />
    <TextField label="단위" value={block.unit} onChange={(unit) => onChange({ ...block, unit })} />
    <PanelTitle>구간 이름 및 증감</PanelTitle>
    {block.steps.map((step, index) => <div key={index} className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-[1fr_76px] gap-2">
        <TextField label={`${index + 1}번 구간`} value={step.label} onChange={(label) => onChange({ ...block, steps: block.steps.map((v, i) => i === index ? { ...v, label } : v) })} />
        <NumberField label="증감" value={step.delta} onChange={(delta) => onChange({ ...block, steps: block.steps.map((v, i) => i === index ? { ...v, delta } : v) })} />
      </div>
      <RemoveButton disabled={block.steps.length <= 1} onRemove={() => onChange({ ...block, steps: block.steps.filter((_, i) => i !== index) })} />
    </div>)}
  </>;
}

export function ReportPropertyPanel({ block, onChange }: Props) {
  if (!block) return <div className="rounded-lg bg-[#f7f9fc] p-3 text-sm leading-6 text-zinc-500">본문의 차트, 표 또는 제목을 선택하면 기존 값이 채워진 편집칸이 여기에 표시됩니다.</div>;
  const isEmbeddedChart = block.kind === "rich-static" && /<svg[\s>]/i.test(block.html);
  return <div className="space-y-3">
    <div><p className="text-xs text-zinc-500">선택한 요소</p><p className="mt-0.5 text-sm font-bold text-zinc-900">{BLOCK_KIND_LABELS[block.kind] ?? (isEmbeddedChart ? "내장 차트" : "보고서 블록")}</p></div>
    {block.kind === "heading" && <><TextField label="제목 문구" value={block.text} onChange={(text) => onChange({ ...block, text })} />{block.number !== undefined && <TextField label="번호" value={block.number} onChange={(number) => onChange({ ...block, number })} />}</>}
    {block.kind === "text" && <div className="rounded-lg bg-[#f7f9fc] p-3 text-sm leading-6 text-zinc-600">본문 문단을 클릭하면 그 자리에서 서식과 함께 수정할 수 있습니다.</div>}
    {block.kind === "table" && <TableFields block={block} onChange={onChange} />}
    {block.kind === "chart" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="Y축 최솟값" value={block.axisMin} onChange={(axisMin) => onChange({ ...block, axisMin })} /><NumberField label="Y축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} /></div><TextField label="단위" value={block.unit} onChange={(unit) => onChange({ ...block, unit })} /><ColorField label="기본 강조 색상" value={block.color} onChange={(color) => onChange({ ...block, color })} /><p className="rounded-md bg-[#f3faf7] px-2.5 py-2 text-xs leading-5 text-[#507064]">선택한 색상을 기준으로 가장 높은 값은 진하게, 2·3번째 값은 비슷한 계열로, 나머지는 회색으로 자동 표시됩니다.</p><PanelTitle>항목명 및 값</PanelTitle>{block.items.map((item) => <div key={item.id} className="flex items-start gap-2"><div className="grid min-w-0 flex-1 grid-cols-[1fr_76px] gap-2"><TextField label="항목명" value={item.label} onChange={(label) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, label } : v) })} /><NumberField label="값" value={item.value} onChange={(value) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, value } : v) })} /></div><RemoveButton disabled={block.items.length <= 1} onRemove={() => onChange({ ...block, items: block.items.filter((v) => v.id !== item.id) })} /></div>)}</>}
    {block.kind === "journey-line" && <JourneyLineFields block={block} onChange={onChange} />}
    {block.kind === "waterfall" && <WaterfallFields block={block} onChange={onChange} />}
    {block.kind === "rank-composition" && <RankCompositionFields block={block} onChange={onChange} />}
    {block.kind === "stacked-bar" && <StackedBarFields block={block} onChange={onChange} />}
    {block.kind === "grouped-bar" && <GroupedBarFields block={block} onChange={onChange} />}
    {block.kind === "radar" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="축 최솟값" value={block.axisMin} onChange={(axisMin) => onChange({ ...block, axisMin })} /><NumberField label="축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} /></div><PanelTitle>항목명</PanelTitle>{block.indicators.map((indicator, index) => <TextField key={index} label={`${index + 1}번 항목`} value={indicator} onChange={(name) => onChange({ ...block, indicators: block.indicators.map((v, i) => i === index ? name : v) })} />)}<PanelTitle>시리즈별 점수</PanelTitle>{block.series.map((series, si) => <div key={si} className="rounded border border-[#e7eaf0] p-2"><TextField label="시리즈명" value={series.name} onChange={(name) => onChange({ ...block, series: block.series.map((v, i) => i === si ? { ...v, name } : v) })} /><ColorField label="색상" value={series.color} onChange={(color) => onChange({ ...block, series: block.series.map((v, i) => i === si ? { ...v, color } : v) })} /><div className="mt-2 grid grid-cols-2 gap-2">{block.indicators.map((indicator, index) => <NumberField key={index} label={indicator} value={series.values[index] ?? 0} onChange={(value) => onChange({ ...block, series: block.series.map((v, i) => i === si ? { ...v, values: v.values.map((score, vi) => vi === index ? value : score) } : v) })} />)}</div></div>)}</>}
    {block.kind === "quadrant" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="X 최소" value={block.xMin} onChange={(xMin) => onChange({ ...block, xMin })} /><NumberField label="X 최대" value={block.xMax} onChange={(xMax) => onChange({ ...block, xMax })} /><NumberField label="Y 최소" value={block.yMin} onChange={(yMin) => onChange({ ...block, yMin })} /><NumberField label="Y 최대" value={block.yMax} onChange={(yMax) => onChange({ ...block, yMax })} /></div><TextField label="X축 제목" value={block.xLabel} onChange={(xLabel) => onChange({ ...block, xLabel })} /><TextField label="Y축 제목" value={block.yLabel} onChange={(yLabel) => onChange({ ...block, yLabel })} /><PanelTitle>기능명 및 좌표</PanelTitle>{block.items.map((item) => <div key={item.id} className="rounded border border-[#e7eaf0] p-2"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><TextField label="항목명" value={item.name} onChange={(name) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, name } : v) })} /></div><RemoveButton disabled={block.items.length <= 1} onRemove={() => onChange({ ...block, items: block.items.filter((v) => v.id !== item.id) })} /></div><div className="mt-2 grid grid-cols-2 gap-2"><NumberField label="상대 중요도" value={item.importance} onChange={(importance) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, importance } : v) })} /><NumberField label="만족도" value={item.satisfaction} onChange={(satisfaction) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, satisfaction } : v) })} /></div></div>)}<PanelTitle>우선순위 영역 색상</PanelTitle><p className="text-xs leading-5 text-zinc-500">원본의 3×3 해석 기준입니다. 색상은 실제 격자에 바로 반영되며, 세부 문구는 격자 칸을 눌러 직접 입력할 수 있습니다.</p>{block.zones.map((zone) => <div key={zone.id} className="rounded border border-[#e7eaf0] p-2"><TextField label="영역명" value={zone.title} onChange={(title) => onChange({ ...block, zones: block.zones.map((v) => v.id === zone.id ? { ...v, title } : v) })} /><div className="mt-2 grid grid-cols-2 gap-2"><ColorField label="영역 색상" value={zone.color} onChange={(color) => onChange({ ...block, zones: block.zones.map((v) => v.id === zone.id ? { ...v, color } : v) })} /><TextField label="해석 메모" value={zone.description} onChange={(description) => onChange({ ...block, zones: block.zones.map((v) => v.id === zone.id ? { ...v, description } : v) })} /></div></div>)}<PanelTitle>격자 칸 문구</PanelTitle><p className="text-xs leading-5 text-zinc-500">그래프의 원하는 칸을 클릭하면 해당 칸의 문구를 직접 입력할 수 있습니다.</p></>}
    {block.kind === "nps" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="평균 구매 의향" value={block.mean} onChange={(mean) => onChange({ ...block, mean })} /><NumberField label="NPS 지수" value={block.npsScore} onChange={(npsScore) => onChange({ ...block, npsScore })} /><NumberField label="추천 고객(%)" value={block.promoterPct} onChange={(promoterPct) => onChange({ ...block, promoterPct })} /><NumberField label="중립 고객(%)" value={block.passivePct} onChange={(passivePct) => onChange({ ...block, passivePct })} /><NumberField label="비추천 고객(%)" value={block.detractorPct} onChange={(detractorPct) => onChange({ ...block, detractorPct })} /></div></>}
    {block.kind === "rich-static" && <EmbeddedChartFields block={block} onChange={onChange} />}
    {block.kind === "polarity" && <>
      <TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <PanelTitle>도넛 항목·색상·비율</PanelTitle>
      {([
        ["positive", "긍정", "#8da4e8"],
        ["negative", "부정", "#ff9449"],
        ["neutral", "중립", "#c8c8c8"],
      ] as const).map(([key, defaultLabel, defaultColor]) => {
        const labelKey = `${key}Label` as const;
        const colorKey = `${key}Color` as const;
        const value = block[key];
        return <div key={key} className="space-y-2 rounded border border-[#e7eaf0] p-2">
          <TextField label="범례명" value={block[labelKey] || defaultLabel} onChange={(nextLabel) => onChange({ ...block, [labelKey]: safeName(nextLabel, defaultLabel) })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="비율(%)" value={value} onChange={(nextValue) => onChange({ ...block, [key]: Math.max(0, nextValue) })} />
            <ColorField label="색상" value={block[colorKey] || defaultColor} onChange={(nextColor) => onChange({ ...block, [colorKey]: nextColor })} />
          </div>
        </div>;
      })}
      <p className="text-xs leading-5 text-zinc-500">세 비율은 자동 정규화되어 도넛 전체(100%)로 표시됩니다.</p>
    </>}
    {block.kind === "priority-reference" && <><TextField label="도표 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><p className="rounded bg-[#f7f9fc] p-3 text-xs leading-5 text-zinc-600">이 도표는 사분면 해석 기준입니다. 기능 좌표는 사분면 차트를 선택해 수정할 수 있습니다.</p></>}
    {block.kind === "row-group" && <><PanelTitle>행 항목명</PanelTitle>{block.rows.map((row) => <TextField key={row.id} label={row.label || "항목"} value={row.label} onChange={(label) => onChange({ ...block, rows: block.rows.map((item) => item.id === row.id ? { ...item, label } : item) })} />)}<p className="rounded bg-[#f7f9fc] p-3 text-xs leading-5 text-zinc-600">표 안의 차트·표·문단은 본문에서 직접 클릭해 선택하면 각각 편집할 수 있습니다.</p></>}
  </div>;
}
