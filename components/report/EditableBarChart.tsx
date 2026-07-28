"use client";

/**
 * 웹 작업공간에서 쓰는 유일한 막대그래프 컴포넌트. 이전엔 `FeatureSatisfactionChart.tsx`
 * (기능별 만족도 전용, SVG)와 `ReportWebDocument.tsx` 안의 임시 `BarChart`+`downloadBarChart`
 * (flexbox div로 그리고, PNG 내보내기는 SVG 문자열을 별도로 다시 만듦)가 서로 독립적으로
 * 존재해서 로직이 어긋나기 쉬웠다 — 이 컴포넌트 하나로 통합한다(2026-07-25 재구성).
 *
 * 값 편집, 색상, Y축 범위(min/max)를 웹에서 바로 바꿀 수 있다 — **이 편집은 화면 표시/PNG
 * 내보내기에만 적용되는 로컬 오버라이드이며, DB의 quant_stats나 PDF 재계산에는 영향을 주지
 * 않는다**(PRD 3.3, 2026-07-25 확정). raw data 기반 정량 계산은 여전히 유일한 진실 원천이다.
 */
import { useRef } from "react";
import type { ReportChartBlock } from "@/lib/report/sections";
import { downloadSvgAsPng } from "@/lib/report/exportImage";

function formatAxisTick(value: number) {
  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

// 아래 세 상수 + placeBarLabel()은 lib/pdf/charts.tsx의 VerticalBarChartWithAverage가 쓰는
// 알고리즘을 웹 SVG 좌표계로 그대로 옮긴 것이다(2026-07-26, "원래 렌더링 조건에는 숫자가 다
// 막대 안에 들어가 있다"는 지적 — 실제 PDF는 값 라벨을 막대 밖 위쪽이 아니라 막대 "안" 위쪽에
// 두고, 평균과 너무 가까워 겹칠 위험이 있으면 막대 안에서 선을 피해 위/아래로 슬라이드시킨다).
// 폰트 크기가 PDF(6.5pt)보다 웹(11px)에서 더 커서 상수를 그만큼 넉넉하게 키웠다.
const MIN_BAR_HEIGHT_FOR_INSIDE_LABEL = 20;
const LABEL_LINE_CLEARANCE = 16;
const BAR_LABEL_HEIGHT = 14;

/** barHeight/avgPx는 모두 "차트 바닥(baseline)에서부터의 거리"(px, 위로 갈수록 커짐) 기준이다.
 * 반환값도 같은 기준의 거리 — 호출부에서 baseline - 반환값으로 실제 SVG y좌표를 구한다. */
function placeBarLabel(barHeight: number, avgPx: number): number {
  if (barHeight < MIN_BAR_HEIGHT_FOR_INSIDE_LABEL) {
    return barHeight + 10; // 막대 밖(바로 위) — 라벨 자체가 안 들어갈 만큼 작은 막대만 해당
  }
  const minBottom = 4;
  const maxBottom = barHeight - 4 - BAR_LABEL_HEIGHT;
  const defaultBottom = maxBottom; // 기본 위치: 막대 맨 위 바로 안쪽
  const center = defaultBottom + BAR_LABEL_HEIGHT / 2;
  if (Math.abs(center - avgPx) >= LABEL_LINE_CLEARANCE) return defaultBottom;
  // 평균선과 겹친다 — 선 위/아래 중 막대 안에 들어가는 후보를 찾아 기본 위치에 더 가까운 쪽을 쓴다.
  const below = avgPx - LABEL_LINE_CLEARANCE - BAR_LABEL_HEIGHT / 2;
  const above = avgPx + LABEL_LINE_CLEARANCE - BAR_LABEL_HEIGHT / 2;
  const candidates = [above, below].filter((b) => b >= minBottom && b <= maxBottom);
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (Math.abs(a - defaultBottom) < Math.abs(b - defaultBottom) ? a : b));
  }
  return Math.max(barHeight, avgPx) + 12; // 최후 수단 — 막대 안 어디에도 안 겹치는 자리가 없음
}

export function EditableBarChart({ block }: { block: ReportChartBlock }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 620;
  // height/top: 밴드(26)와 플롯 사이에 범례 행(18) 공간을 더 확보했다(2026-07-26) — 평균값
  // 텍스트를 선 옆에 띄우지 않고 이 범례 행 하나로만 보여준다(아래 참고).
  const height = 316;
  const left = 56;
  const top = 58;
  const plotHeight = 200;
  const plotWidth = 540;
  const range = block.axisMax - block.axisMin || 1;
  const gridCount = 5;
  const grid = Array.from({ length: gridCount + 1 }, (_, i) => block.axisMin + (range / gridCount) * i);
  const average = block.items.length ? block.items.reduce((sum, item) => sum + item.value, 0) / block.items.length : 0;
  const averageY = top + plotHeight - ((average - block.axisMin) / range) * plotHeight;

  async function handleDownload() {
    if (!svgRef.current) return;
    await downloadSvgAsPng(svgRef.current, `${block.title || block.id}.png`);
  }

  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleDownload()} className="rounded border border-[#315c9c] px-2 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">
          PNG 다운로드
        </button>
      </div>
      {/* data-report-export: "이 섹션 전체 다운로드" ZIP 훑기 대상(lib/report/exportImage.ts).
          svg를 감싼 바깥 div에 붙여 표(EditableTable)와 같은 방식으로 다룬다. */}
      <div data-report-export="chart" data-report-export-name={block.title || block.id}>
        <svg ref={svgRef} data-export-crop-top="27" viewBox={`0 0 ${width} ${height}`} className="block w-full bg-white" aria-label={block.title}>
          {/* PDF의 차트 제목 밴드(lib/pdf/charts.tsx VerticalBarChart)는 연보라 밴드 위에
              4px 시안색 강조선이 딱 붙어있다(borderTopWidth:4, borderTopColor:"#4fc8e8") —
              2026-07-25 웹에도 같은 디테일을 추가해 PDF와 서식을 맞췄다. */}
          <g data-export-exclude><rect x="0" y="0" width={width} height="4" fill="#4fc8e8" />
          <rect x="0" y="4" width={width} height="22" fill="#c0cdef" />
          {/* 참고 이미지(FGI Transcript Studio)의 "< ... >" 밴드처럼 테두리로 감싸 박스
              느낌을 더했다(2026-07-26) — 채움색·상단 강조선은 실측 PDF 값이라 그대로 두고
              테두리만 추가. */}
          <rect x="0.5" y="0.5" width={width - 1} height="25" fill="none" stroke="#315c9c" strokeWidth="1" />
          <text x={width / 2} y="20" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">[ {block.title} ]</text></g>
          {/* 실제 PDF(VerticalBarChartWithAverage)는 평균값을 그래프 위 범례 한 줄로만 보여주고
              선 옆에 떠다니는 텍스트를 따로 두지 않는다 — 2026-07-26 "빨간선에 전체 평균
              텍스트가 겹쳐 보인다"는 지적의 근본 원인이 이 구조 차이였다. 선 옆 플로팅 텍스트를
              없애고 범례로 옮기면 애초에 겹칠 대상이 사라진다. PNG 내보내기는 이 svg 전체를
              그대로 래스터화하므로(exportImage.ts) 범례도 SVG 안에 있어야 내보내기에 포함된다. */}
          {block.items.length > 1 && (
            <g>
              <rect x={width / 2 - 90} y="34" width="11" height="11" fill={block.color} />
              <text x={width / 2 - 75} y="43" fontSize="10" fill="#334155">값</text>
              <line x1={width / 2 + 10} x2={width / 2 + 32} y1="39.5" y2="39.5" stroke="#ef7268" strokeWidth="2" />
              <text x={width / 2 + 38} y="43" fontSize="10" fill="#cf4f48">
                전체 평균 {average.toFixed(2)}{block.unit}
              </text>
            </g>
          )}
          {grid.map((value) => {
            const y = top + plotHeight - ((value - block.axisMin) / range) * plotHeight;
            return (
              <g key={value}>
                <line x1={left} x2={left + plotWidth} y1={y} y2={y} stroke="#d9dfe9" strokeWidth="1" />
                <text x={left - 9} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{formatAxisTick(value)}{block.unit}</text>
              </g>
            );
          })}
          <line x1={left} x2={left} y1={top} y2={top + plotHeight} stroke="#7b8798" />
          <line x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} stroke="#7b8798" />
          {/* 막대만 먼저 그린다(값 라벨은 아래에서 평균선보다도 나중에, 맨 위 레이어로 그림). */}
          {block.items.map((item, index) => {
            const slot = plotWidth / block.items.length;
            const barWidth = Math.min(48, slot * 0.62);
            const barHeight = Math.max(0, ((item.value - block.axisMin) / range) * plotHeight);
            const x = left + index * slot + (slot - barWidth) / 2;
            const y = top + plotHeight - barHeight;
            return (
              <g key={item.id}>
                <rect x={x} y={y} width={barWidth} height={barHeight} fill={block.color} />
                <text x={x + barWidth / 2} y={top + plotHeight + 18} textAnchor="middle" fontSize="9" fill="#334155">
                  {item.label.split("\n").map((line, lineIndex) => (
                    <tspan key={line} x={x + barWidth / 2} dy={lineIndex === 0 ? 0 : 10}>{line}</tspan>
                  ))}
                </text>
              </g>
            );
          })}
          {/* 평균선 — 막대보다 나중에(=위에) 그려야 막대에 가려지지 않는다(CLAUDE.md에 이미
              기록된 PDF 쪽 동일 원칙: "평균선은 막대 View보다 나중에 그려야 항상 또렷하게
              보인다"). */}
          {block.items.length > 1 && (
            <line x1={left} x2={left + plotWidth} y1={averageY} y2={averageY} stroke="#ef7268" strokeWidth="2" />
          )}
          {/* 값 라벨 — 평균선보다도 나중에(최상단 레이어) 그리고, 막대 밖이 아니라 "안"에 둔다.
              평균과 너무 가까워 겹칠 위험이 있으면 placeBarLabel()이 막대 안에서 위/아래로
              슬라이드시킨다(2026-07-26, "원래 렌더링 조건에는 숫자가 다 막대 안에 들어가
              있다"는 지적 — PDF의 VerticalBarChartWithAverage와 동일한 알고리즘). */}
          {block.items.map((item, index) => {
            const slot = plotWidth / block.items.length;
            const barWidth = Math.min(48, slot * 0.62);
            const barHeight = Math.max(0, ((item.value - block.axisMin) / range) * plotHeight);
            const x = left + index * slot + (slot - barWidth) / 2;
            const avgPx = ((average - block.axisMin) / range) * plotHeight;
            const labelBottom = placeBarLabel(barHeight, avgPx);
            const labelY = top + plotHeight - labelBottom;
            return (
              <text key={item.id} x={x + barWidth / 2} y={labelY} textAnchor="middle" fontSize="11" fontWeight="700" fill="#172033">
                {item.value}{block.unit}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
