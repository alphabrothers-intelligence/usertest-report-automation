"use client";

/** 선택한 표·차트의 데이터 계약을 오른쪽 패널에서 편집한다.
 * 본문 차트 아래에는 편집용 값 목록을 두지 않는다. 항목명을 바꾸는 경우 연결된 행 데이터의
 * 키까지 함께 바꿔, 범례·막대·PNG 다운로드가 항상 같은 이름을 사용하도록 한다. */
import type { ChangeEvent, ReactNode } from "react";
import type {
  ReportBlock,
  ReportGroupedBarBlock,
  ReportRankCompositionBlock,
  ReportStackedBarBlock,
  ReportTableBlock,
} from "@/lib/report/sections";

type Props = { block: ReportBlock | null; onChange: (next: ReportBlock) => void };

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

export function ReportPropertyPanel({ block, onChange }: Props) {
  if (!block) return <div className="rounded-lg bg-[#f7f9fc] p-3 text-sm leading-6 text-zinc-500">본문의 차트, 표 또는 제목을 선택하면 기존 값이 채워진 편집칸이 여기에 표시됩니다.</div>;
  return <div className="space-y-3">
    <div><p className="text-xs text-zinc-500">선택한 요소</p><p className="mt-0.5 text-sm font-bold text-zinc-900">{block.kind === "chart" ? "막대 차트" : block.kind === "table" ? "표" : block.kind === "heading" ? "제목" : block.kind === "quadrant" ? "사분면 차트" : block.kind === "radar" ? "방사형 차트" : block.kind === "nps" ? "NPS 차트" : "보고서 블록"}</p></div>
    {block.kind === "heading" && <><TextField label="제목 문구" value={block.text} onChange={(text) => onChange({ ...block, text })} />{block.number !== undefined && <TextField label="번호" value={block.number} onChange={(number) => onChange({ ...block, number })} />}</>}
    {block.kind === "text" && <div className="rounded-lg bg-[#f7f9fc] p-3 text-sm leading-6 text-zinc-600">본문 문단을 클릭하면 그 자리에서 서식과 함께 수정할 수 있습니다.</div>}
    {block.kind === "table" && <TableFields block={block} onChange={onChange} />}
    {block.kind === "chart" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="Y축 최솟값" value={block.axisMin} onChange={(axisMin) => onChange({ ...block, axisMin })} /><NumberField label="Y축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} /></div><TextField label="단위" value={block.unit} onChange={(unit) => onChange({ ...block, unit })} /><ColorField label="막대 색상" value={block.color} onChange={(color) => onChange({ ...block, color })} /><PanelTitle>항목명 및 값</PanelTitle>{block.items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_76px] gap-2"><TextField label="항목명" value={item.label} onChange={(label) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, label } : v) })} /><NumberField label="값" value={item.value} onChange={(value) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, value } : v) })} /></div>)}</>}
    {block.kind === "rank-composition" && <RankCompositionFields block={block} onChange={onChange} />}
    {block.kind === "stacked-bar" && <StackedBarFields block={block} onChange={onChange} />}
    {block.kind === "grouped-bar" && <GroupedBarFields block={block} onChange={onChange} />}
    {block.kind === "radar" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="축 최솟값" value={block.axisMin} onChange={(axisMin) => onChange({ ...block, axisMin })} /><NumberField label="축 최댓값" value={block.axisMax} onChange={(axisMax) => onChange({ ...block, axisMax })} /></div><PanelTitle>항목명</PanelTitle>{block.indicators.map((indicator, index) => <TextField key={index} label={`${index + 1}번 항목`} value={indicator} onChange={(name) => onChange({ ...block, indicators: block.indicators.map((v, i) => i === index ? name : v) })} />)}<PanelTitle>시리즈별 점수</PanelTitle>{block.series.map((series, si) => <div key={si} className="rounded border border-[#e7eaf0] p-2"><TextField label="시리즈명" value={series.name} onChange={(name) => onChange({ ...block, series: block.series.map((v, i) => i === si ? { ...v, name } : v) })} /><ColorField label="색상" value={series.color} onChange={(color) => onChange({ ...block, series: block.series.map((v, i) => i === si ? { ...v, color } : v) })} /><div className="mt-2 grid grid-cols-2 gap-2">{block.indicators.map((indicator, index) => <NumberField key={index} label={indicator} value={series.values[index] ?? 0} onChange={(value) => onChange({ ...block, series: block.series.map((v, i) => i === si ? { ...v, values: v.values.map((score, vi) => vi === index ? value : score) } : v) })} />)}</div></div>)}</>}
    {block.kind === "quadrant" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="X 최소" value={block.xMin} onChange={(xMin) => onChange({ ...block, xMin })} /><NumberField label="X 최대" value={block.xMax} onChange={(xMax) => onChange({ ...block, xMax })} /><NumberField label="Y 최소" value={block.yMin} onChange={(yMin) => onChange({ ...block, yMin })} /><NumberField label="Y 최대" value={block.yMax} onChange={(yMax) => onChange({ ...block, yMax })} /></div><TextField label="X축 제목" value={block.xLabel} onChange={(xLabel) => onChange({ ...block, xLabel })} /><TextField label="Y축 제목" value={block.yLabel} onChange={(yLabel) => onChange({ ...block, yLabel })} /><PanelTitle>기능명 및 좌표</PanelTitle>{block.items.map((item) => <div key={item.id} className="rounded border border-[#e7eaf0] p-2"><TextField label="항목명" value={item.name} onChange={(name) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, name } : v) })} /><div className="mt-2 grid grid-cols-2 gap-2"><NumberField label="상대 중요도" value={item.importance} onChange={(importance) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, importance } : v) })} /><NumberField label="만족도" value={item.satisfaction} onChange={(satisfaction) => onChange({ ...block, items: block.items.map((v) => v.id === item.id ? { ...v, satisfaction } : v) })} /></div></div>)}<PanelTitle>격자 칸 문구</PanelTitle><p className="text-xs leading-5 text-zinc-500">그래프의 원하는 칸을 클릭하면 해당 칸의 문구를 직접 입력할 수 있습니다.</p></>}
    {block.kind === "nps" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-2 gap-2"><NumberField label="평균 구매 의향" value={block.mean} onChange={(mean) => onChange({ ...block, mean })} /><NumberField label="NPS 지수" value={block.npsScore} onChange={(npsScore) => onChange({ ...block, npsScore })} /><NumberField label="추천 고객(%)" value={block.promoterPct} onChange={(promoterPct) => onChange({ ...block, promoterPct })} /><NumberField label="중립 고객(%)" value={block.passivePct} onChange={(passivePct) => onChange({ ...block, passivePct })} /><NumberField label="비추천 고객(%)" value={block.detractorPct} onChange={(detractorPct) => onChange({ ...block, detractorPct })} /></div></>}
    {block.kind === "polarity" && <><TextField label="차트 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><div className="grid grid-cols-3 gap-2"><NumberField label="긍정(%)" value={block.positive} onChange={(positive) => onChange({ ...block, positive })} /><NumberField label="부정(%)" value={block.negative} onChange={(negative) => onChange({ ...block, negative })} /><NumberField label="중립(%)" value={block.neutral} onChange={(neutral) => onChange({ ...block, neutral })} /></div></>}
    {block.kind === "priority-reference" && <><TextField label="도표 제목" value={block.title} onChange={(title) => onChange({ ...block, title })} /><p className="rounded bg-[#f7f9fc] p-3 text-xs leading-5 text-zinc-600">이 도표는 사분면 해석 기준입니다. 기능 좌표는 사분면 차트를 선택해 수정할 수 있습니다.</p></>}
  </div>;
}
