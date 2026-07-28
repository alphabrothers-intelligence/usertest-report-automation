// PRD 8장: "그래프는 react-pdf가 직접 그리지 못하므로 PNG로 먼저 생성" 이라고 가정했지만,
// 실측 결과 @react-pdf/renderer는 View의 flexbox 레이아웃만으로 막대그래프를 충분히 그릴 수
// 있다(외부 캔버스 라이브러리·PNG 래스터화 불필요 — Vercel 서버리스에 native 바이너리 의존성이
// 없어 오히려 더 안전하다). CLAUDE.md 참고. Svg/Polygon/Line/Circle도 네이티브로 지원해서
// 방사형(레이더) 차트도 같은 원칙으로 그릴 수 있다(2026-07-21, 실제 발행 보고서 양식 대조).
import type { ReactNode } from "react";
import { View, Text, Svg, Polygon, Line, Circle, Rect, Image } from "@react-pdf/renderer";
import { colors, styles } from "./theme";
import { renderQuadrantChart, renderPriorityReferenceDiagram } from "@/lib/charts/canvasCharts";

const TRACK_HEIGHT = 8;

// 레이더 차트 축 라벨 폰트 크기 — RadarChart/RadarChartOverlay가 공유한다(2026-07-22, 실제
// 발행 보고서 39페이지 대조로 6.5→5.5pt로 축소).
export const RADAR_AXIS_LABEL_FONT_SIZE = 5.5;

/** 한글(완성형/자모)·한자는 폰트 크기의 약 0.98배, 그 외(영문·숫자·공백·기호)는 약 0.55배
 * 폭을 차지한다고 가정한 대략적인 텍스트 너비 추정 — react-pdf/SVG는 실제 렌더링 전에 텍스트
 * 폭을 알려주는 API가 없어서(Canvas의 measureText 같은 게 없음), 라벨 여백을 안전하게 계산하려면
 * 이런 근사치가 필요하다. 살짝 과대추정해도(여백이 필요보다 조금 커도) 안전한 쪽이라 문제
 *없지만, 과소추정하면 라벨이 잘린다(2026-07-21 실측 버그 — 고정 30pt/65pt 여백을 하드코딩했다가
 * 라벨이 길어질 때마다 다시 잘리는 문제가 반복됐다). */
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    const isWide = /[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch);
    width += fontSize * (isWide ? 0.98 : 0.55);
  }
  return width;
}

/**
 * 레이더 차트의 라벨 여백(캔버스를 그리드보다 얼마나 더 키울지)을 실제 축 라벨 내용과 폰트
 * 크기, 그리드 크기(size)로부터 계산한다(2026-07-22, 가로/세로 분리는 2026-07-23). 예전엔
 * 30pt→65pt로 고정값을 계속 키워가며 대응했는데(라벨이 길어질 때마다 다시 잘리는 문제가
 * 반복됨, CLAUDE.md 참고), 그 방식은 "이번에 확인한 라벨 길이"에만 안전하지 "다른 raw
 * data가 들어와도" 안전하다는 보장이 없다 — 라벨 텍스트로부터 직접 필요한 여백을 역산하면
 * 어떤 축 이름이 오든 항상 안 잘리는 만큼만 정확히 여백을 잡는다.
 *
 * **가로/세로를 하나의 스칼라로 합쳐서 캔버스를 정사각형으로 키우던 방식(예전 버전)의 버그**:
 * 위/아래 축(예: 실용성/즐거움처럼 4축이 정확히 상하좌우인 경우)은 라벨이 짧아 세로 여백이
 * 조금만 있으면 되는데, 좌우 축의 긴 라벨(예: "게임 진행 자연스러움") 폭을 세로 여백에도
 * 그대로 적용해버려서 위/아래에 필요 이상으로 큰 빈 공간이 생겼다(2026-07-23 실측: "그래프
 * 여백이 너무 크다"). 축마다 실제 각도(angleFor)에 따라 라벨이 캔버스 밖으로 뻗어나가는
 * x/y 방향이 다르므로, 축별로 필요한 x여백·y여백을 각각 계산해 그 중 최댓값만 쓴다 — 상하
 * 축은 y만, 좌우 축은 x만 크게 요구하고 서로의 방향에는 영향을 주지 않는다.
 */
/** 레이더 축 라벨을 최대 2줄로 줄바꿈한다(2026-07-22) — "게임 진행 자연스러움" 같은 긴
 * 좌우 축 라벨이 한 줄이면 가로로 크게 튀어나와(mx가 커져) 레이더 자체가 작아진다. 공백에서
 * 가운데에 가장 가까운 지점을 골라 두 줄로 나누면 라벨 폭이 절반이 되어 레이더를 훨씬 크게
 * 그릴 수 있다. 짧은 라벨(8자 이하)이나 공백 없는 라벨은 그대로 한 줄로 둔다. */
export function wrapRadarLabel(label: string): string[] {
  if ([...label].length <= 8) return [label];
  const spaces: number[] = [];
  for (let i = 0; i < label.length; i++) if (label[i] === " ") spaces.push(i);
  if (spaces.length === 0) return [label];
  const mid = label.length / 2;
  const best = spaces.reduce((a, b) => (Math.abs(a - mid) <= Math.abs(b - mid) ? a : b));
  return [label.slice(0, best), label.slice(best + 1)];
}

// 레이더 축 라벨 한 줄 높이(줄바꿈된 라벨의 줄 간격).
const RADAR_LABEL_LINE_HEIGHT = RADAR_AXIS_LABEL_FONT_SIZE + 1.5;

export function computeRadarLabelMargins(
  labels: string[],
  size: number,
  fontSize: number = RADAR_AXIS_LABEL_FONT_SIZE,
): { mx: number; my: number } {
  const n = labels.length;
  if (n < 3) return { mx: 10, my: 10 };
  const radius = size / 2 - 8;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const lx = radius * 1.22 * Math.cos(angle);
    const ly = radius * 1.22 * Math.sin(angle);
    const lines = wrapRadarLabel(labels[i] ?? "");
    // 줄바꿈된 라벨의 가장 긴 줄 폭으로 가로 여백을 계산 — 2줄로 나뉘면 폭이 절반이 되어
    // 레이더가 커진다. 세로 여백은 줄 수만큼 높이를 더한다.
    const width = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
    const isMiddle = Math.abs(lx) < 4;
    const xExtent = Math.abs(lx) + (isMiddle ? width / 2 : width);
    const yExtent = Math.abs(ly) + lines.length * RADAR_LABEL_LINE_HEIGHT;
    mx = Math.max(mx, xExtent - size / 2);
    my = Math.max(my, yExtent - size / 2);
  }
  return { mx: Math.max(10, Math.ceil(mx) + 4), my: Math.max(10, Math.ceil(my) + 4) };
}

/** 같은 행에 나란히 놓이는 여러 레이더 차트(그룹마다 축 개수·라벨이 다를 수 있음)의 캔버스
 * 크기를 맞추기 위해, 그룹별로 각자 계산한 여백들을 방향별로 병합(최댓값)한다 — 두 그룹의
 * 라벨을 하나의 배열로 합쳐서 계산하면 축 개수(n)와 각도가 실제와 달라져 기하 계산이
 * 틀어지므로, 반드시 그룹별로 따로 계산한 뒤 이 함수로 병합해야 한다. */
export function mergeRadarLabelMargins(
  ...margins: { mx: number; my: number }[]
): { mx: number; my: number } {
  return {
    mx: Math.max(10, ...margins.map((m) => m.mx)),
    my: Math.max(10, ...margins.map((m) => m.my)),
  };
}

/**
 * 같은 행에 나란히 놓이는 레이더 차트 여러 개를 각 열(column) 폭 안에 캔버스가 그대로
 * 들어가도록 하는 최대 size를 역산한다(2026-07-23). **실측 버그**: Ⅵ/Ⅶ장의 실용성·즐거움
 * 레이더를 크게 키우면서(105→150, 115→160), 오른쪽으로 뻗는 긴 라벨("게임 진행
 * 자연스러움")의 캔버스가 그 열의 실제 폭보다 커져 옆 열로 넘어가 반대쪽 레이더의 왼쪽
 * 라벨과 텍스트가 겹치는 문제가 실측 확인됐다("게임 진행 자연스러움차별성·독창성"처럼 붙어
 * 보임) — 이 캔버스 크기는 라벨 폭에서 역산되므로, 열 폭을 넘지 않는 한도 안에서만 키워야
 * 한다. size가 커질수록 canvasWidth(size + margins.mx*2)도 커지므로 이분 탐색으로 열 폭을
 * 넘지 않는 가장 큰 size를 찾는다 — 다른 raw data에서 축 라벨이 더 길어지거나 짧아져도
 * 항상 실제 사용 가능한 폭에 맞는 크기로 자동 조정된다(고정 size를 손으로 다시 낮추는 방식은
 * "이번 라벨 길이"에만 안전해 반복적으로 재발했던 문제라 피한다).
 */
export function maxRadarSizeForColumn(
  labels: string[],
  columnWidth: number,
  fontSize: number = RADAR_AXIS_LABEL_FONT_SIZE,
  maxSize = 260,
): number {
  let lo = 40;
  let hi = maxSize;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    const { mx } = computeRadarLabelMargins(labels, mid, fontSize);
    const canvasWidth = mid + mx * 2;
    if (canvasWidth <= columnWidth) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}

export function BarChart({
  items,
  max,
  unit = "",
}: {
  items: { label: string; value: number }[];
  max: number;
  unit?: string;
}) {
  return (
    <View>
      {items.map((item) => (
        <View key={item.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ width: 110, fontSize: 8 }}>{item.label}</Text>
          <View
            style={{
              flex: 1,
              height: TRACK_HEIGHT,
              backgroundColor: colors.bgAlt,
              borderRadius: 2,
            }}
          >
            <View
              style={{
                width: `${Math.max(0, Math.min(100, (item.value / max) * 100))}%`,
                height: TRACK_HEIGHT,
                backgroundColor: colors.teal,
                borderRadius: 2,
              }}
            />
          </View>
          <Text style={{ width: 34, fontSize: 8, textAlign: "right" }}>
            {item.value}
            {unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 상대중요도처럼 음수를 가질 수 있는 값을 0 기준 좌우로 뻗는 막대로 그린다. */
export function DivergingBarChart({
  items,
  maxAbs,
}: {
  items: { label: string; value: number }[];
  maxAbs: number;
}) {
  return (
    <View>
      {items.map((item) => {
        const pct = Math.min(100, (Math.abs(item.value) / maxAbs) * 50);
        const isPositive = item.value >= 0;
        return (
          <View key={item.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <Text style={{ width: 110, fontSize: 8 }}>{item.label}</Text>
            <View style={{ flex: 1, flexDirection: "row", height: TRACK_HEIGHT }}>
              <View style={{ width: "50%", flexDirection: "row", justifyContent: "flex-end" }}>
                {!isPositive && (
                  <View style={{ width: `${pct}%`, height: TRACK_HEIGHT, backgroundColor: colors.amber }} />
                )}
              </View>
              <View style={{ width: 1, height: TRACK_HEIGHT, backgroundColor: colors.border }} />
              <View style={{ width: "50%" }}>
                {isPositive && (
                  <View style={{ width: `${pct}%`, height: TRACK_HEIGHT, backgroundColor: colors.tealDark }} />
                )}
              </View>
            </View>
            <Text style={{ width: 34, fontSize: 8, textAlign: "right" }}>{item.value}</Text>
          </View>
        );
      })}
    </View>
  );
}

// 105pt로 확대(기존 80pt) — 값 라벨을 막대 안에 넣기로 하면서 가장 작은 막대도 라벨이
// 들어갈 최소 높이를 확보해야 하기 때문(2026-07-21, "세로 높이를 키워서 숫자를 넣어달라"
// 지적).
// 원본 Ⅱ장의 차트 플롯 높이는 A4 렌더(110dpi) 기준 약 225px = 150pt다.
// 이전 105pt는 Q1~Q3가 한 페이지에 몰리면서 원본보다 도표가 작고 페이지 수가 줄어드는
// 직접 원인이었다. 이 높이는 Ⅱ장 원본의 "Q1·Q2+교차표 / Q3~Q5" 페이지 구성을 재현한다.
const VBAR_CHART_HEIGHT = 150;
// 평균선이 있는 차트(VerticalBarChartWithAverage)는 축 여백을 데이터 스프레드에 비례해
// 좁게 잡기 때문에(아래 computeBarWithAverageRange 참고) 막대 하나하나가 VerticalBarChart
// 보다 커진다 — 그만큼 세로 해상도가 더 필요해서 105보다 크게 잡는다(2026-07-21).
const VBAR_AVG_CHART_HEIGHT = 160;
// 막대 픽셀 높이가 이 값보다 작으면 라벨이 막대 안에 안 들어간다 — 이때는 막대 위(바깥)로
// 뺀다. 작은 값(예: 3%) 막대까지 억지로 안에 우겨넣으면 바로 아래 x축 라벨과 겹친다.
const MIN_BAR_HEIGHT_FOR_INSIDE_LABEL = 11;
// 값 라벨(막대 위치)과 평균선의 픽셀 간격이 이보다 좁으면 숫자가 선에 붙어 보인다 —
// 6.5pt 폰트+상하 여백 기준 라벨 한 줄이 실제로 차지하는 높이보다 약간 넉넉하게 잡았다.
const LABEL_LINE_CLEARANCE = 11;
// 라벨 한 줄(6.5pt 폰트)이 실제로 차지하는 대략적인 세로 폭.
const BAR_LABEL_HEIGHT = 9;

/**
 * VerticalBarChartWithAverage 값 라벨의 막대 하단 기준 y좌표(bottom)를 계산한다. 기본은
 * 기존과 같이 막대 맨 위 바로 아래(3pt 여백)에 둔다. 값이 평균과 너무 가까워 그 위치가 평균선과
 * 겹칠 위험이 있으면(2026-07-21, "빨간선이 숫자를 침범하면 안 된다" 반복 지적), **막대 밖으로
 * 빼는 대신 막대 안에서 선을 피해 위/아래로 슬라이드**시킨다 — 막대는 라벨 하나 들어갈 공간은
 * 거의 항상 있으므로(값이 평균과 비슷하다는 건 그만큼 막대 자체도 어느 정도 높이가 있다는 뜻),
 * 굳이 막대 밖으로 뺄 필요가 없다는 재지적을 반영했다("막대 밖으로 나온 숫자만 다시 안으로
 * 넣어달라"). 막대가 라벨 하나조차 못 넣을 만큼 짧을 때만(예: 3% 같은 작은 값) 최후 수단으로
 * 막대 밖(위)에 둔다.
 */
function placeBarLabel(barHeight: number, avgPx: number): number {
  if (barHeight < MIN_BAR_HEIGHT_FOR_INSIDE_LABEL) {
    return barHeight + 2; // 막대 밖(바로 위) — 라벨 자체가 안 들어갈 만큼 작은 막대만 해당
  }
  const minBottom = 3;
  const maxBottom = barHeight - 3 - BAR_LABEL_HEIGHT;
  const defaultBottom = maxBottom; // 기존 위치: 막대 맨 위 바로 아래
  const center = defaultBottom + BAR_LABEL_HEIGHT / 2;
  if (Math.abs(center - avgPx) >= LABEL_LINE_CLEARANCE) {
    return defaultBottom;
  }
  // 선과 겹친다 — 선 위쪽/아래쪽 중 막대 안에 들어가는 후보를 찾아, 원래 위치(막대 상단)에
  // 더 가까운 쪽을 쓴다(값이 커 보이도록 가능한 한 위쪽을 우선).
  const below = avgPx - LABEL_LINE_CLEARANCE - BAR_LABEL_HEIGHT / 2;
  const above = avgPx + LABEL_LINE_CLEARANCE - BAR_LABEL_HEIGHT / 2;
  const candidates = [above, below].filter((b) => b >= minBottom && b <= maxBottom);
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (Math.abs(a - defaultBottom) < Math.abs(b - defaultBottom) ? a : b));
  }
  // 막대 안 어디에도 선과 안 겹치는 자리가 없을 만큼 막대가 짧다 — 최후 수단으로 밖으로.
  return Math.max(barHeight, avgPx) + 8;
}

/**
 * VerticalBarChartWithAverage에 넘길 min/max를 데이터 스프레드에 비례해 계산한다(2026-07-21,
 * "숫자에 흰 배경 넣지 말고, 최댓값에 맞게 축 범위를 잡아서 막대를 키우는 방식으로 풀어달라"는
 * 명시적 요청). 예전엔 Ⅲ장(기능별 만족도)·Ⅴ장(4대가치) 두 호출부가 각자 "데이터 최소/최대에서
 * ±1점"을 하드코딩했는데, 이 여백이 실제 데이터 스프레드보다 훨씬 커서(예: 값이 1.3점 안에
 * 몰려 있는데 위아래로 1점씩, 총 2점을 더 얹으면) 축이 필요 이상으로 넓어지고 그만큼 막대
 * 높이가 줄어 평균선과 라벨이 붙는 게 근본 원인이었다. 여백을 "데이터 스프레드의 25%(최소
 * 0.3점)"로 스프레드에 비례하게 계산해서, 값들이 몰려 있을수록 축도 자동으로 좁게 잡혀
 * 막대가 커진다 — 어떤 raw data가 들어오든 항상 같은 원리로 동작한다. 두 호출부가 각자
 * 계산식을 들고 있으면 새 raw data에 이 원칙이 일관되게 적용되는지 보장할 수 없어서(실제로
 * 지금까지 두 곳이 토씨 하나까지 같은 코드를 복붙해서 써왔다), 계산을 이 함수 하나로 모았다.
 */
export function computeBarWithAverageRange(values: number[], average: number): [number, number] {
  const all = [...values, average];
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  // **원본 보고서 양식(2026-07-23 사용자 결정: "원본과 동일하게 4~8점")**: 실제 발행 보고서의
  // 기능별 만족도·4대가치 차트는 데이터에 딱 맞춘 확대 축이 아니라, 정수 눈금(step 1)의 넉넉한
  // 축을 쓴다(예: 값이 5.85~7.20이면 y축을 4~8로). 최솟값 아래로 약 1점 여백을 두고 정수로
  // 내림, 최댓값 위로 약 1점 여백을 두고 정수로 올린다 — 그러면 그리드 눈금이 항상 4/5/6/7/8
  // 처럼 정수로 떨어지고, 어떤 raw data가 들어와도 같은 원리로 원본과 같은 양식이 나온다.
  // (예전엔 "값이 몰려 있으면 축을 좁혀 막대를 키우는" 확대 방식이었으나, 원본 재현을 위해
  //  이 정수 넉넉 축으로 되돌렸다.)
  const min = Math.max(0, Math.floor(dataMin) - 1);
  const max = Math.min(10, Math.floor(dataMax) + 1);
  return [min, max];
}

function niceStep(max: number): number {
  // 그리드라인 5개 안팎으로 떨어지는 "보기 좋은" 간격을 고른다(10/20/25/50 배수 등).
  const rough = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * 레이더 차트 min/max/gridLevels을 "예쁜" 간격으로 스냅한다(실제 발행 보고서 형식, 2026-07-21
 * 실측 대조 — 사용자가 "숫자값의 범위가 너무 과도하게 많다"고 지적). 기존엔 min/max를
 * 0.5 단위로만 반올림하고 gridLevels는 항상 6으로 고정해서, (max-min)이 6으로 안 나눠떨어지면
 * 4.08/4.67/5.25처럼 어중간한 숫자가 나왔다(예: range=2.5일 때 2.5/6≈0.417). niceStep()으로
 * "보기 좋은" 간격을 먼저 정하고, 그 간격의 배수로 min/max를 맞춰서 gridLevels도 정수로
 * 딱 떨어지게 한다.
 */
export function computeNiceRadarRange(values: number[]): { min: number; max: number; levels: number } {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const step = niceStep(Math.max(rawMax - rawMin, 0.1));
  let min = Math.floor(rawMin / step) * step - step;
  let max = Math.ceil(rawMax / step) * step + step;
  min = Math.max(0, Math.round(min * 100) / 100);
  max = Math.min(10, Math.round(max * 100) / 100);
  if (max <= min) max = min + step;
  const levels = Math.max(1, Math.round((max - min) / step));
  return { min, max, levels };
}

/**
 * 세로 막대그래프 — 실제 발행 보고서의 "[응답 결과]" 형식(질문 하나당 세로 막대 + 막대 위에
 * 값 라벨 + x축 카테고리 라벨 + y축 그리드라인, 2026-07-21 실측 대조). 기존 BarChart(가로
 * 막대, 표 안에 여러 항목 나열용)와는 쓰임이 다르다 — 이건 "설문 문항 하나의 응답 분포"를
 * 보여줄 때 쓴다.
 */
export function VerticalBarChart({
  items,
  max,
  yMax,
  unit = "",
  title = "[ 응답 결과 ]",
  footer,
}: {
  items: { label: string; value: number }[];
  max: number;
  /** 원본 양식에 고정된 축 상한. 지정하지 않으면 데이터에 맞춰 자동 확대한다. */
  yMax?: number;
  unit?: string;
  title?: string;
  /** 같은 "[응답 결과]" 박스 안(막대 아래)에 이어 붙일 추가 콘텐츠. 원본은 Q2 성별처럼
   * 세로 막대 + 성별×연령 교차표를 하나의 테두리 박스 안에 함께 넣는다(2026-07-23 대조). */
  footer?: ReactNode;
}) {
  // 항상 고정된 max(보통 100%)로 그리면 작은 값 막대들이 눌려서 라벨이 안에 안 들어간다 —
  // 실제 데이터 최댓값 기준으로 축을 좁히되, 넘겨받은 max를 상한으로 둔다(2026-07-21,
  // "퍼센테이지 범위를 낮춰달라" 지적).
  const dataMax = Math.max(...items.map((i) => i.value), 0);
  const zoomedMax = Math.min(max, dataMax > 0 ? dataMax : max);
  const step = niceStep(Math.max(zoomedMax, 0.1));
  const topGridValue = yMax ?? Math.min(max, Math.ceil(zoomedMax / step) * step + step);
  const gridFractions: number[] = [];
  for (let v = 0; v <= topGridValue + 1e-6; v += step) gridFractions.push(Math.min(1, v / topGridValue));

  return (
    <View
      style={{
        marginBottom: 14,
        borderWidth: 0.75,
        borderColor: "#aeb8c9",
        // 시안 실선은 배너 바로 위에 붙어야 한다(원본 형식, 2026-07-23 지적: "파란색 실선이
        // 표와 떨어져 떠 있으면 안 되고 배너에 붙어야 한다"). 예전엔 borderTop과 배너 사이에
        // paddingTop:9의 흰 여백이 있어 실선이 떠 보였다 — 여백을 없애 실선이 배너에 직접
        // 닿게 하고, 원본처럼 실선을 조금 더 굵게(4pt) 한다.
        borderTopWidth: 4,
        borderTopColor: "#4fc8e8",
      }}
      wrap={false}
    >
      <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4 }}>
        <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center", color: colors.navy }}>
          {title}
        </Text>
      </View>
      <View style={{ flexDirection: "row", marginTop: 8, paddingHorizontal: 8 }}>
        <View style={{ width: 22, height: VBAR_CHART_HEIGHT, justifyContent: "space-between" }}>
          {gridFractions
            .slice()
            .reverse()
            .map((f) => (
              <Text key={f} style={{ fontSize: 6, color: colors.subtext, textAlign: "right" }}>
                {Math.round(topGridValue * f)}
                {unit}
              </Text>
            ))}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ height: VBAR_CHART_HEIGHT, position: "relative" }}>
            {gridFractions.map((f) => (
              <View
                key={f}
                style={{
                  position: "absolute",
                  bottom: f * VBAR_CHART_HEIGHT,
                  left: 0,
                  right: 0,
                  height: 0.5,
                  backgroundColor: colors.border,
                }}
              />
            ))}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                top: 0,
                flexDirection: "row",
                alignItems: "flex-end",
              }}
            >
              {items.map((item) => {
                const barHeight =
                  topGridValue === 0 ? 0 : Math.max(0, Math.min(1, item.value / topGridValue)) * VBAR_CHART_HEIGHT;
                // 값 라벨은 원칙적으로 막대 안(위쪽)에 넣는다(2026-07-21, "수치 정보는 막대
                // 그래프 안에" 지적) — 단, 막대가 라벨 하나 들어갈 만큼도 안 크면(작은 %
                // 값) 안에 넣으면 바로 아래 x축 라벨과 겹치므로 그때만 막대 밖(위)으로 뺀다.
                const labelInside = barHeight >= MIN_BAR_HEIGHT_FOR_INSIDE_LABEL;
                return (
                  <View
                    key={item.label}
                    style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: VBAR_CHART_HEIGHT }}
                  >
                    {!labelInside && (
                      <Text style={{ fontSize: 6.5, fontWeight: "bold", marginBottom: 2 }}>
                        {item.value}
                        {unit}
                      </Text>
                    )}
                    <View
                      style={{
                        width: "55%",
                        height: Math.max(1, barHeight),
                        backgroundColor: colors.teal,
                        alignItems: "center",
                        paddingTop: labelInside ? 3 : 0,
                      }}
                    >
                      {labelInside && (
                        <Text style={{ fontSize: 6.5, fontWeight: "bold" }}>
                          {item.value}
                          {unit}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          <View style={{ flexDirection: "row", marginTop: 3 }}>
            {items.map((item) => (
              <Text key={item.label} style={{ flex: 1, fontSize: 6.5, textAlign: "center" }}>
                {item.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
      {footer && (
        <View style={{ paddingHorizontal: 8, paddingBottom: 8, marginTop: 10 }}>{footer}</View>
      )}
    </View>
  );
}

/**
 * VerticalBarChart에 전체 평균선을 겹쳐 그린다(실제 보고서의 "가치별/기능별 만족도 + 전체
 * 평균" 차트 형식). `min`을 0이 아닌 값으로 주면 값이 몰려있을 때 차이가 잘 보이는 확대된
 * 축을 쓸 수 있다(2026-07-21 — 기존엔 항상 0부터 그려서 6~7점대 값들이 다 비슷해 보인다는
 * 지적이 있었다). `yAxisTitle`을 주면 y축 왼쪽에 세로로 회전된 축 제목을 붙이고,
 * `legendBarLabel`/`legendAverageLabel`을 주면 막대 위에 색상 범례(막대색=개별 평균,
 * 빨간선=전체 평균+수치)를 그린다 — 기존엔 "평균 {값}" 텍스트 하나만 왼쪽에 작게 붙어있어서
 * 무엇을 뜻하는 색인지 안 보인다는 지적이 있었다.
 */
export function VerticalBarChartWithAverage({
  items,
  min = 0,
  max,
  unit = "",
  title,
  average,
  yAxisTitle,
  legendBarLabel,
  legendAverageLabel = "전체 평균",
}: {
  items: { label: string; value: number }[];
  min?: number;
  max: number;
  unit?: string;
  title?: string;
  average: number;
  yAxisTitle?: string;
  legendBarLabel?: string;
  legendAverageLabel?: string;
}) {
  const range = max - min || 1;
  const step = niceStep(range);
  const gridValues: number[] = [];
  for (let v = min; v <= max + 1e-6; v += step) gridValues.push(Math.round(v * 100) / 100);
  const avgFraction = Math.max(0, Math.min(1, (average - min) / range));
  // 실제 보고서는 항상 값 내림차순으로 막대를 나열한다(Ⅲ장 기능별 만족도 기준으로 이미
  // 확인된 패턴, 2026-07-21) — Ⅴ장 4대가치 차트는 raw data 카테고리 순서를 그대로 써서
  // 정렬이 안 돼 있었다는 지적을 받고 이 컴포넌트 레벨에서 통일했다. 호출부마다 따로
  // 정렬하지 않아도 항상 값이 큰 막대부터 나온다.
  const sortedItems = [...items].sort((a, b) => b.value - a.value);

  return (
    <View
      style={{
        marginBottom: 14,
        borderWidth: 0.75,
        borderColor: "#aeb8c9",
        // 시안 실선을 배너에 직접 붙인다(원본 형식, 2026-07-23) — VerticalBarChart와 동일.
        borderTopWidth: 4,
        borderTopColor: "#4fc8e8",
      }}
      wrap={false}
    >
      {title && (
        <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4 }}>
          <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center", color: colors.navy }}>
            {title}
          </Text>
        </View>
      )}
      {legendBarLabel && (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 8, height: 8, backgroundColor: colors.teal }} />
            <Text style={{ fontSize: 6.5 }}>{legendBarLabel}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 10, height: 1.5, backgroundColor: colors.red }} />
            <Text style={{ fontSize: 6.5 }}>
              {legendAverageLabel} {average.toFixed(2)}
              {unit}
            </Text>
          </View>
        </View>
      )}
      <View style={{ flexDirection: "row", marginTop: 8, alignItems: "flex-start", paddingHorizontal: 8 }}>
        {yAxisTitle && (
          <View style={{ width: 10, height: VBAR_AVG_CHART_HEIGHT, alignItems: "center", justifyContent: "center" }}>
            {/* react-pdf의 transform:rotate()가 flex 자식 폭 제약 안에서 텍스트를 줄바꿈한 뒤
                회전시켜 글자가 뭉개지는 문제가 실측 확인됐다(2026-07-21) — 세로쓰기는 글자를
                한 자씩 줄바꿈해 쌓는 방식이 훨씬 안정적이다. */}
            {yAxisTitle.split("").map((ch, i) => (
              <Text key={i} style={{ fontSize: 6, color: colors.subtext }}>
                {ch === " " ? "" : ch}
              </Text>
            ))}
          </View>
        )}
        <View style={{ width: 24, height: VBAR_AVG_CHART_HEIGHT, justifyContent: "space-between" }}>
          {gridValues
            .slice()
            .reverse()
            .map((v) => (
              <Text key={v} style={{ fontSize: 6, color: colors.subtext, textAlign: "right" }}>
                {v}
                {unit}
              </Text>
            ))}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ height: VBAR_AVG_CHART_HEIGHT, position: "relative" }}>
            {gridValues.map((v) => (
              <View
                key={v}
                style={{
                  position: "absolute",
                  bottom: ((v - min) / range) * VBAR_AVG_CHART_HEIGHT,
                  left: 0,
                  right: 0,
                  height: 0.5,
                  backgroundColor: colors.border,
                }}
              />
            ))}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                top: 0,
                flexDirection: "row",
                alignItems: "flex-end",
              }}
            >
              {sortedItems.map((item) => {
                const barHeight = Math.max(0, Math.min(1, (item.value - min) / range)) * VBAR_AVG_CHART_HEIGHT;
                return (
                  <View
                    key={item.label}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "flex-end",
                      height: VBAR_AVG_CHART_HEIGHT,
                    }}
                  >
                    <View style={{ width: "55%", height: Math.max(1, barHeight), backgroundColor: colors.teal }} />
                  </View>
                );
              })}
            </View>
            {/* 평균선은 막대보다 나중에(= 위에) 그려야 막대에 가려지지 않고 항상 또렷하게
                보인다(2026-07-21 지적: "빨간색 선은 그래프 위로 오게끔") — 막대 View 다음에
                두면 react-pdf/Yoga가 나중 형제를 위에 그린다. */}
            <View
              style={{
                position: "absolute",
                bottom: avgFraction * VBAR_AVG_CHART_HEIGHT,
                left: 0,
                right: 0,
                height: 1.2,
                backgroundColor: colors.red,
              }}
            />
            {/* 값 라벨은 평균선보다도 나중에(=가장 위 레이어) 그린다. 흰 배경으로 선을 가리는
                방식은 되돌렸다(2026-07-21, "숫자 뒤에 흰 배경 넣지 말고 축 범위를 데이터에
                맞게 좁혀서 막대를 키우는 방식으로 풀어달라"는 명시적 요청) — 대신
                computeBarWithAverageRange가 축 여백을 데이터 스프레드에 비례해 좁게 잡고
                VBAR_AVG_CHART_HEIGHT를 키워서, 대부분의 경우 막대 높이 자체가 라벨과 평균선을
                자연스럽게 떼어놓는다. 값이 평균과 아주 가까운 막대는(예: 0.1점 이내 차이)
                라벨을 막대 밖으로 빼서 해결했었는데, "막대 밖으로 나온 숫자만 다시 안으로
                넣어달라"는 재지적(2026-07-21, 같은 날) — 막대 자체는 충분히 크므로(라벨
                하나 들어갈 공간은 늘 있다) 막대 밖으로 뺄 필요 없이, 막대 안에서 선을 피해
                위/아래로 슬라이드시키는 것으로 바꿨다. 정말로 막대가 라벨 하나 들어갈 만큼도
                안 크면(너무 작은 값) 그때만 최후 수단으로 밖으로 뺀다. */}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                top: 0,
                flexDirection: "row",
                alignItems: "flex-end",
              }}
            >
              {sortedItems.map((item) => {
                const barHeight = Math.max(0, Math.min(1, (item.value - min) / range)) * VBAR_AVG_CHART_HEIGHT;
                const avgPx = avgFraction * VBAR_AVG_CHART_HEIGHT;
                const label = <Text style={{ fontSize: 6.5, fontWeight: "bold" }}>{item.value.toFixed(2)}</Text>;
                const labelBottom = placeBarLabel(barHeight, avgPx);
                return (
                  <View key={item.label} style={{ flex: 1, position: "relative", height: VBAR_AVG_CHART_HEIGHT }}>
                    <View
                      style={{ position: "absolute", left: 0, right: 0, bottom: labelBottom, alignItems: "center" }}
                    >
                      {label}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          <View style={{ flexDirection: "row", marginTop: 3 }}>
            {sortedItems.map((item) => (
              <Text key={item.label} style={{ flex: 1, fontSize: 6.5, textAlign: "center" }}>
                {item.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * 방사형(레이더) 차트 — 실제 발행 보고서의 "사용자 경험 품질 평가" 섹션 형식(2026-07-21).
 * min~max 구간을 N겹 동심 다각형 그리드로 그리고, 축마다 값에 비례한 꼭짓점을 이어 데이터
 * 다각형을 그린다. Svg/Polygon/Line은 @react-pdf/renderer가 네이티브로 지원한다(PNG 불필요).
 */
export function RadarChart({
  axes,
  min = 0,
  max,
  gridLevels = 6,
  size = 160,
  color,
  fillColor,
  labelMargin,
}: {
  axes: { label: string; value: number }[];
  min?: number;
  max: number;
  gridLevels?: number;
  size?: number;
  /** 데이터 폴리곤 선 색. 기본값(teal)은 [전체] 항목처럼 그룹 구분이 없는 경우용 —
   * 실용성/즐거움처럼 raw data가 여러 그룹으로 나뉘는 경우엔 호출부가 그룹마다 다른 색을
   * 넘긴다(2026-07-21, UX_GROUP_PALETTE 참고). */
  color?: string;
  fillColor?: string;
  /** 여백을 직접 지정한다(생략 시 이 차트의 축 라벨만으로 자동 계산). 실용성/즐거움처럼 같은
   * 행에 나란히 놓이는 여러 RadarChart는 그룹마다 축 라벨 길이가 달라 각자 계산하면 캔버스
   * 크기가 달라지고, 그러면 나란히 놓았을 때 그리드 높이가 서로 어긋나 보인다(2026-07-22
   * 실측 확인: "두 그래프의 높이가 안 맞아요"). 이럴 땐 호출부가 그룹별로 각자 계산한 여백을
   * mergeRadarLabelMargins로 합쳐 여기 넘겨서, 같은 행의 모든 차트가 정확히 같은 캔버스
   * 크기를 쓰도록 강제한다. */
  labelMargin?: { mx: number; my: number };
}) {
  const n = axes.length;
  if (n < 3) return null;
  // 라벨이 그리드 바깥으로 튀어나오는 만큼 캔버스 자체를 여백만큼 더 키운다 — 라벨을 그리드
  // 반경의 1.22배 지점에 그리기 때문에, 캔버스 폭이 그리드 지름과 같으면 좌우/상단 라벨
  // 텍스트가 SVG viewBox 밖으로 잘려나간다(2026-07-21 실측 확인: "실용성2"가 "실"만 남고
  // 잘림). **2026-07-23**: 가로/세로 여백을 하나의 스칼라로 합쳐 정사각형 캔버스를 키우던
  // 방식은 좌우 축의 긴 라벨 폭이 위/아래 여백에도 그대로 적용돼 불필요하게 큰 빈 공간을
  // 만들었다(실측: "그래프 여백이 너무 크다") — computeRadarLabelMargins가 축 각도별로
  // x/y 방향 여백을 따로 계산하도록 바꿔서, 상하 축은 세로만 좁게 좌우 축은 가로만 넓게
  // 정확히 필요한 만큼만 잡는다.
  const { mx, my } = labelMargin ?? computeRadarLabelMargins(
    axes.map((a) => a.label),
    size,
    RADAR_AXIS_LABEL_FONT_SIZE,
  );
  const canvasWidth = size + mx * 2;
  const canvasHeight = size + my * 2;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const radius = size / 2 - 8;

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pointFor = (i: number, fraction: number) => {
    const angle = angleFor(i);
    const r = radius * fraction;
    return { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle) };
  };

  const valueFraction = (value: number) => {
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  };

  const dataPoints = axes.map((a, i) => pointFor(i, valueFraction(a.value)));
  const dataPolygonPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  const gridPolygons = Array.from({ length: gridLevels }, (_, level) => {
    const fraction = (level + 1) / gridLevels;
    const pts = axes.map((_, i) => pointFor(i, fraction));
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  });

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
        {gridPolygons.map((pts, i) => (
          <Polygon key={i} points={pts} stroke={colors.border} strokeWidth={0.5} fill="none" />
        ))}
        {axes.map((_, i) => {
          const p = pointFor(i, 1);
          return <Line key={i} x1={centerX} y1={centerY} x2={p.x} y2={p.y} stroke={colors.border} strokeWidth={0.5} />;
        })}
        <Polygon
          points={dataPolygonPoints}
          stroke={color ?? colors.tealDark}
          strokeWidth={1.2}
          fill={fillColor ?? color ?? colors.teal}
          fillOpacity={0.35}
        />
        {dataPoints.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={1.6} fill={color ?? colors.tealDark} />
        ))}
        {axes.flatMap((a, i) => {
          const labelPoint = pointFor(i, 1.22);
          const lines = wrapRadarLabel(a.label);
          const anchor =
            Math.abs(labelPoint.x - centerX) < 4 ? "middle" : labelPoint.x > centerX ? "start" : "end";
          return lines.map((line, li) => (
            <Text
              key={`${i}-${li}`}
              x={labelPoint.x}
              y={labelPoint.y + (li - (lines.length - 1) / 2) * RADAR_LABEL_LINE_HEIGHT}
              style={{ fontSize: RADAR_AXIS_LABEL_FONT_SIZE, fontFamily: "Noto Sans KR" }}
              textAnchor={anchor}
            >
              {line}
            </Text>
          ));
        })}
        {Array.from({ length: gridLevels }, (_, level) => {
          const fraction = (level + 1) / gridLevels;
          const value = min + (max - min) * fraction;
          const p = pointFor(0, fraction);
          return (
            <Text
              key={`grid-value-${level}`}
              x={p.x}
              y={p.y - 1.5}
              style={{ fontSize: 4.5, fontFamily: "Noto Sans KR" }}
              textAnchor="middle"
            >
              {value.toFixed(2)}
            </Text>
          );
        })}
      </Svg>
    </View>
  );
}

export const GROUP_SERIES_PALETTE = ["#7fa6e0", "#f2b880", "#e8d97a", "#93cf8f", "#c99ee0", "#e88a9a"];

/** RadarChart(단일 시리즈)로 그리는 "그룹별" UX 품질 차트(실용성/즐거움 등)의 색 팔레트 —
 * 차트 폴리곤 색(chart)과 그 그룹의 UxScoreTable 헤더 셀 배경(header)을 한 쌍으로 묶어서,
 * 차트 색과 표 색이 항상 같이 바뀌도록 한다(2026-07-21, "표 컬럼 색도 그래프 색으로 맞춰라"
 * 요청). 실용성/즐거움은 WALLA 표준 스키마상 고정된 2개 그룹이지만(PRD 6.7절 8축 = 실용성4+
 * 즐거움4), 이 팔레트 자체는 그룹 이름이나 개수를 가정하지 않는다 — 호출부가 그룹 배열의
 * 인덱스로 순서대로 꺼내 쓰므로, 다른 raw data에서 그룹이 다른 이름이거나 개수가 다르더라도
 * (예: 3개 이상) 같은 방식으로 동작한다. header 앞 2개(실용성/즐거움)는 실제 발행 보고서
 * 39페이지를 200dpi로 렌더링해 픽셀 샘플링한 값(2026-07-22, "표 색상도 원본을 참고해서"
 * 요청) — 실용성 #e6eef7(연한 파랑), 즐거움 #faedd2(연한 황갈색, 기존에 쓰던 오렌지 계열
 * #fde4d0보다 더 노란 톤이었다).
 */
export const UX_GROUP_PALETTE: { chart: string; header: string }[] = [
  { chart: GROUP_SERIES_PALETTE[0], header: "#e6eef7" },
  { chart: GROUP_SERIES_PALETTE[1], header: "#faedd2" },
  { chart: GROUP_SERIES_PALETTE[2], header: "#fdf6d3" },
  { chart: GROUP_SERIES_PALETTE[3], header: "#dcf5dc" },
  { chart: GROUP_SERIES_PALETTE[4], header: "#ecdcf5" },
  { chart: GROUP_SERIES_PALETTE[5], header: "#fbdde3" },
];

/**
 * 여러 시리즈(연령대·성별 등)를 항목별로 나란히 비교하는 클러스터 세로 막대그래프(실제 발행
 * 보고서의 "연령대별/성별 차이" 형식, 2026-07-21). 값 범위가 좁게 몰려 있으면(예: 4~9점) 차이가
 * 안 보이므로 VerticalBarChart처럼 0부터 그리지 않고 호출부에서 확대한 min~max를 받는다.
 */
export function GroupedBarChart({
  categories,
  series,
  min = 0,
  max,
  unit = "",
  title,
}: {
  categories: string[];
  series: { name: string; color: string; values: number[] }[];
  min?: number;
  max: number;
  unit?: string;
  title?: string;
}) {
  const CHART_HEIGHT = 110;
  const range = max - min || 1;
  const step = niceStep(range);
  const gridValues: number[] = [];
  for (let v = min; v <= max + 1e-6; v += step) gridValues.push(Math.round(v * 100) / 100);

  return (
    <View style={{ marginBottom: 10 }} wrap={false}>
      {title && (
        <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4, marginBottom: 6 }}>
          <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center", color: colors.navy }}>{title}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6, gap: 10, justifyContent: "center" }}>
        {series.map((s) => (
          <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 7, height: 7, backgroundColor: s.color }} />
            <Text style={{ fontSize: 6.5 }}>{s.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 26, height: CHART_HEIGHT, justifyContent: "space-between" }}>
          {gridValues
            .slice()
            .reverse()
            .map((v) => (
              <Text key={v} style={{ fontSize: 6, color: colors.subtext, textAlign: "right" }}>
                {v.toFixed(2)}
                {unit}
              </Text>
            ))}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ height: CHART_HEIGHT, position: "relative" }}>
            {gridValues.map((v) => (
              <View
                key={v}
                style={{
                  position: "absolute",
                  bottom: ((v - min) / range) * CHART_HEIGHT,
                  left: 0,
                  right: 0,
                  height: 0.5,
                  backgroundColor: colors.border,
                }}
              />
            ))}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                top: 0,
                flexDirection: "row",
                alignItems: "flex-end",
              }}
            >
              {categories.map((cat, ci) => (
                <View
                  key={cat}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    height: CHART_HEIGHT,
                    // 그룹(항목) 사이의 간격 — 실제 보고서는 같은 그룹 안의 막대끼리는 거의
                    // 붙어있고 그룹 사이만 벌어져 있다(2026-07-21 실측 대조, 기존엔 막대
                    // 하나하나 사이에 똑같은 간격이 있어서 그룹 구분이 잘 안 됐다). 4pt로는
                    // 여전히 그룹끼리 거의 붙어 보인다는 재지적(2026-07-21, 같은 날) —
                    // 10pt로 넓혔다(그룹 내부 막대 간격 0.2pt는 그대로 둬서 그룹 안은 계속
                    // 붙어 보이고, 그룹 사이만 뚜렷이 벌어진다).
                    paddingHorizontal: 10,
                  }}
                >
                  {series.map((s) => {
                    const value = s.values[ci] ?? min;
                    const frac = Math.max(0, Math.min(1, (value - min) / range));
                    return (
                      <View
                        key={s.name}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          justifyContent: "flex-end",
                          height: CHART_HEIGHT,
                          marginHorizontal: 0.2,
                        }}
                      >
                        <Text style={{ fontSize: 5, fontWeight: "bold", marginBottom: 1 }}>{value.toFixed(2)}</Text>
                        <View style={{ width: "96%", height: Math.max(1, frac * CHART_HEIGHT), backgroundColor: s.color }} />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: "row", marginTop: 3 }}>
            {categories.map((cat) => (
              <Text key={cat} style={{ flex: 1, fontSize: 6, textAlign: "center" }}>
                {cat}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * 다중 시리즈(성별 등) 레이더 오버레이 — RadarChart(단일 시리즈)와 달리 여러 데이터 폴리곤을
 * 겹쳐 그리고 범례를 함께 보여준다(실제 발행 보고서의 "실용성/즐거움 남성 vs 여성" 형식,
 * 2026-07-21). 기하 계산은 RadarChart와 동일한 원리(그리드·라벨 캔버스 분리)를 따른다.
 */
export function RadarChartOverlay({
  axes,
  series,
  min = 0,
  max,
  gridLevels = 6,
  size = 150,
  labelMargin,
}: {
  axes: string[];
  series: { name: string; color: string; values: number[] }[];
  min?: number;
  max: number;
  gridLevels?: number;
  size?: number;
  /** RadarChart의 labelMargin과 같은 목적 — 같은 행에 나란히 놓이는 여러 RadarChartOverlay의
   * 캔버스 크기를 맞추기 위한 공통 여백 오버라이드(2026-07-22, 가로/세로 분리는 2026-07-23,
   * computeRadarLabelMargins 주석 참고). */
  labelMargin?: { mx: number; my: number };
}) {
  const n = axes.length;
  if (n < 3) return null;
  // RadarChart와 같은 이유로 실제 라벨 텍스트에서 필요한 여백을 역산한다(2026-07-22, 고정값을
  // 계속 손으로 맞추다 재발한 클리핑 버그를 근본적으로 없앤 방식). 가로/세로 분리 이유는
  // computeRadarLabelMargins 주석 참고 — 위/아래 축은 세로 여백만, 좌우 축은 가로 여백만
  // 필요한데 예전엔 스칼라 하나로 합쳐서 불필요하게 큰 빈 공간이 생겼다.
  const { mx, my } = labelMargin ?? computeRadarLabelMargins(axes, size, RADAR_AXIS_LABEL_FONT_SIZE);
  const canvasWidth = size + mx * 2;
  const canvasHeight = size + my * 2;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const radius = size / 2 - 8;

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pointFor = (i: number, fraction: number) => {
    const angle = angleFor(i);
    const r = radius * fraction;
    return { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle) };
  };
  const valueFraction = (value: number) => (max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min))));

  const gridPolygons = Array.from({ length: gridLevels }, (_, level) => {
    const fraction = (level + 1) / gridLevels;
    return axes
      .map((_, i) => pointFor(i, fraction))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");
  });

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
        {gridPolygons.map((pts, i) => (
          <Polygon key={i} points={pts} stroke={colors.border} strokeWidth={0.5} fill="none" />
        ))}
        {axes.map((_, i) => {
          const p = pointFor(i, 1);
          return <Line key={i} x1={centerX} y1={centerY} x2={p.x} y2={p.y} stroke={colors.border} strokeWidth={0.5} />;
        })}
        {series.map((s) => {
          const pts = axes
            .map((_, i) => pointFor(i, valueFraction(s.values[i] ?? min)))
            .map((p) => `${p.x},${p.y}`)
            .join(" ");
          return <Polygon key={s.name} points={pts} stroke={s.color} strokeWidth={1.2} fill={s.color} fillOpacity={0.15} />;
        })}
        {series.flatMap((s) =>
          axes.map((_, i) => {
            const p = pointFor(i, valueFraction(s.values[i] ?? min));
            return <Circle key={`${s.name}-${i}`} cx={p.x} cy={p.y} r={1.4} fill={s.color} />;
          }),
        )}
        {axes.flatMap((label, i) => {
          const labelPoint = pointFor(i, 1.22);
          const lines = wrapRadarLabel(label);
          const anchor =
            Math.abs(labelPoint.x - centerX) < 4 ? "middle" : labelPoint.x > centerX ? "start" : "end";
          return lines.map((line, li) => (
            <Text
              key={`${i}-${li}`}
              x={labelPoint.x}
              y={labelPoint.y + (li - (lines.length - 1) / 2) * RADAR_LABEL_LINE_HEIGHT}
              style={{ fontSize: RADAR_AXIS_LABEL_FONT_SIZE, fontFamily: "Noto Sans KR" }}
              textAnchor={anchor}
            >
              {line}
            </Text>
          ));
        })}
        {Array.from({ length: gridLevels }, (_, level) => {
          const fraction = (level + 1) / gridLevels;
          const value = min + (max - min) * fraction;
          const p = pointFor(0, fraction);
          return (
            <Text
              key={`grid-value-${level}`}
              x={p.x}
              y={p.y - 1.5}
              style={{ fontSize: 4.5, fontFamily: "Noto Sans KR" }}
              textAnchor="middle"
            >
              {value.toFixed(2)}
            </Text>
          );
        })}
      </Svg>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        {series.map((s) => (
          <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 7, height: 7, backgroundColor: s.color }} />
            <Text style={{ fontSize: 6.5 }}>{s.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const COMPOSITION_PALETTE = [
  "#ef4444",
  "#0d9488",
  "#3b82f6",
  "#84cc16",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#64748b",
];

/**
 * Q12(기능 중요도 순위 1~n위) 응답자 구성비를 순위별 가로 누적 막대그래프로 보여준다(실제
 * 발행 보고서 형식, 2026-07-21). relativeImportance의 DivergingBarChart와는 같은 원본 순위
 * 데이터를 다른 축(항목별 점수 vs 순위 위치별 구성비)으로 잘라 보여주는 것이라 정보가 겹치지
 * 않는다 — lib/quant/basic.ts의 rankPositionComposition 참고.
 */
export function RankCompositionChart({
  compositions,
  candidateNames,
}: {
  compositions: { rank: number; segments: { name: string; percentage: number }[] }[];
  candidateNames: string[];
}) {
  const colorFor = (name: string) =>
    COMPOSITION_PALETTE[candidateNames.indexOf(name) % COMPOSITION_PALETTE.length];
  return (
    <View style={{ marginBottom: 6 }} wrap={false}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6, gap: 8 }}>
        {candidateNames.map((name) => (
          <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 7, height: 7, backgroundColor: colorFor(name) }} />
            <Text style={{ fontSize: 6.5 }}>{name}</Text>
          </View>
        ))}
      </View>
      {compositions.map((comp) => (
        <View key={comp.rank} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
          <Text style={{ width: 22, fontSize: 7 }}>{comp.rank}위</Text>
          <View style={{ flex: 1, flexDirection: "row", height: 12, backgroundColor: colors.bgAlt }}>
            {comp.segments.map((seg) => (
              <View key={seg.name} style={{ width: `${seg.percentage}%`, backgroundColor: colorFor(seg.name) }} />
            ))}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", marginTop: 2, marginLeft: 22 }}>
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
          <Text key={v} style={{ flex: 1, fontSize: 5.5, color: colors.subtext }}>
            {v}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * 두 범주형 변수의 교차표를 가로 누적 막대그래프로 보여준다(실제 발행 보고서의 "성별×연령대"
 * 형식, 2026-07-21 실측 대조 — Ⅱ장 인적사항 Q2 성별 응답 바로 아래에 나온다). RankCompositionChart와
 * 비슷한 모양이지만, 그건 항목별 비율(%, 합계 100)을 보여주고 이건 실제 응답자 수(명)를
 * 그대로 보여준다는 점이 다르다 — 그래서 행마다 막대 길이가 다르다(응답자 수가 적은 행은
 * 짧게 끝난다).
 */
/** 실제 발행 보고서의 성별×연령대 교차막대 연령 구간 색상(원본 6페이지 픽셀 샘플링,
 * 2026-07-22). 연령 구간은 ageBracketLabel이 만드는 고정 어휘라 다른 raw data에도 그대로
 * 적용된다 — 여기 없는 카테고리는 CrossTabStackedBar가 COMPOSITION_PALETTE로 폴백한다. */
export const AGE_BRACKET_COLORS: Record<string, string> = {
  "10대": "#ffe59a",
  "20대": "#bfdfff",
  "30대": "#ffceb0",
  "40대 이상": "#d9d9d9",
};

export function CrossTabStackedBar({
  rows,
  categories,
  maxValue,
  unit = "명",
  colorMap,
  axisTitle,
  embedded = false,
}: {
  rows: { label: string; segments: { name: string; count: number }[] }[];
  categories: string[];
  maxValue: number;
  unit?: string;
  /** 카테고리명→색상 고정 맵(예: 연령 구간 파스텔). 없는 이름은 COMPOSITION_PALETTE로 폴백. */
  colorMap?: Record<string, string>;
  /** 가로축 제목(예: "응답자 수"). 원본은 교차표 아래 중앙에 붙인다(2026-07-23 대조). */
  axisTitle?: string;
  /** VerticalBarChart의 footer로 박스 안에 넣을 때 true — 자체 바깥 여백을 없앤다. */
  embedded?: boolean;
}) {
  const colorFor = (name: string) =>
    colorMap?.[name] ?? COMPOSITION_PALETTE[categories.indexOf(name) % COMPOSITION_PALETTE.length];
  const step = niceStep(maxValue);
  const axisTicks: number[] = [];
  for (let v = 0; v <= maxValue + 1e-6; v += step) axisTicks.push(Math.round(v));
  const LABEL_WIDTH = 30;

  return (
    <View style={{ marginBottom: embedded ? 0 : 6 }} wrap={false}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6, gap: 8 }}>
        {categories.map((name) => (
          <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 7, height: 7, backgroundColor: colorFor(name) }} />
            <Text style={{ fontSize: 6.5 }}>{name}</Text>
          </View>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <Text style={{ width: LABEL_WIDTH, fontSize: 7 }}>{row.label}</Text>
          <View style={{ flex: 1, flexDirection: "row", height: 20, backgroundColor: colors.bgAlt }}>
            {row.segments.map(
              (seg) =>
                seg.count > 0 && (
                  <View
                    key={seg.name}
                    style={{
                      width: `${(seg.count / maxValue) * 100}%`,
                      backgroundColor: colorFor(seg.name),
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {/* 원본은 파스텔 세그먼트 위에 어두운 글자로 건수를 쓴다(연한 배경에 흰
                        글자는 안 보임) — colors.text로 바꿨다(2026-07-22 실측 대조). */}
                    <Text style={{ fontSize: 6, color: colors.text }}>
                      {seg.count}
                      {unit}
                    </Text>
                  </View>
                ),
            )}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", marginTop: 2, marginLeft: LABEL_WIDTH }}>
        {axisTicks.map((v) => (
          <Text key={v} style={{ flex: 1, fontSize: 5.5, color: colors.subtext }}>
            {v}
          </Text>
        ))}
      </View>
      {axisTitle && (
        <Text
          style={{ fontSize: 6.5, color: colors.subtext, textAlign: "center", marginTop: 2, marginLeft: LABEL_WIDTH }}
        >
          {axisTitle}
        </Text>
      )}
    </View>
  );
}

/** 중요도×만족도 조합에 따른 5단계 개선우선순위(실제 보고서의 "영역별 참고 지표" 동일 원리 —
 * 중요도·만족도 둘 다 높으면 개선 불필요, 중요도 높고 만족도 낮으면 긴급 개선). 색상값은
 * data/의 실제 발행 PDF(리바랩스, 28페이지)를 200dpi로 래스터화한 뒤 grid 셀 중심을 직접
 * 픽셀 샘플링해서 뽑아낸 값이다(2026-07-21, "제발 이미지처럼 정확히 나와야 한다" 요청 —
 * 기존엔 스크린샷만으로 정확한 색상을 뽑을 방법이 없어 col+row-2 공식에 임의 5색을 썼는데,
 * 이번엔 원본 PDF를 직접 픽셀 단위로 읽어 5개 hex 전부와 경계 위치까지 정확히 확인했다). */
const PRIORITY_LEVELS = [
  { score: 2, label: "최상", desc: "긴급 개선", color: "#f8cbad" },
  { score: 1, label: "상", desc: "중요 개선", color: "#fce4d6" },
  { score: 0, label: "중", desc: "개선 권장 또는 제외 권장", color: "#ffffff" },
  { score: -1, label: "하", desc: "개선 권장 또는 필요성 낮음", color: "#d9e1f2" },
  { score: -2, label: "최하", desc: "필요성 적음", color: "#b4c6e7" },
] as const;

/** 기능명이 길면(예: "실시간 위치 기반 거점형 콘텐츠") 사분면 차트 한 줄에 다 안 들어가고
 * 옆 칸을 침범한다(2026-07-21 실측 확인) — 공백 근처에서 최대 2줄로 나눠 폭을 줄인다. */
// 셀 하나(1단위)의 실제 폭 근처로 잡은 안전 상한 — ImportanceSatisfactionChart 기본
// width=482 기준 plotWidth≈454pt, 10칸이니 칸 하나≈45.4pt. 라벨이 옆 칸을 침범하지 않도록
// 여유를 두고 40pt로 잡았다(2026-07-22, "텍스트 전부가 무조건 해당 칸 안에만" 요청).
const QUADRANT_LABEL_MAX_WIDTH = 34;

/** 기존엔 글자 수(8자)로만 판단해 딱 2줄로 반으로 쪼갰는데, "실시간 위치 기반 거점형
 * 콘텐츠"처럼 긴 라벨은 반으로 쪼개도 각 줄이 여전히 칸 폭보다 넓어서 옆 칸을 침범했다
 * (2026-07-22 실측: "다 삐져나오고 깨져요"). estimateTextWidth로 실제 폭을 계산해 필요한
 * 만큼(2줄이든 3줄이든) 단어 단위로 줄바꿈한다 — 특정 라벨 길이에 맞춰 손으로 조정한 값이
 * 아니라 텍스트 폭 자체로 판단하므로 다른 raw data의 기능명이 더 길어도 똑같이 안전하다. */
function wrapQuadrantLabel(name: string): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (estimateTextWidth(candidate, 6) > QUADRANT_LABEL_MAX_WIDTH) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * 기능별 상대중요도-만족도 사분면 그래프(실제 발행 보고서 형식, 2026-07-21). 처음엔 X·Y축을
 * 각각 균등 3등분(3.33/6.67 경계)해서 9개 셀을 만들었는데, 원본 PDF를 픽셀 샘플링해보니
 * 실제 경계는 균등 3등분이 아니라 **중요도는 -2/+2, 만족도는 6/8**의 고정 경계였다(2026-07-21,
 * "제발 이미지처럼 정확히" 요청으로 재대조 — data/ 실제 PDF 28페이지를 200dpi 래스터화 후
 * 셀 중심 픽셀을 직접 읽어 확인). 만족도 쪽은 특히 비대칭이 뚜렷하다 — [8,10] 구간과 [6,8]
 * 구간은 폭이 좁고(고만족만 "필요성 낮음"으로 인정), [0,6] 구간이 폭 6으로 넓다(그 아래는
 * 전부 "개선 필요" 취급). 대각선 방향(중요도 높음+만족도 낮음 = 우선순위 최상)으로 색을
 * 입히는 원리 자체는 동일하다.
 */
export function ImportanceSatisfactionChart({
  items,
  importanceRange = [-5, 5],
  satisfactionRange = [0, 10],
  width = 460,
  height = 220,
}: {
  items: { name: string; importance: number; satisfaction: number }[];
  importanceRange?: [number, number];
  satisfactionRange?: [number, number];
  width?: number;
  height?: number;
}) {
  const MARGIN_LEFT = 20;
  const MARGIN_BOTTOM = 14;
  const MARGIN_TOP = 6;
  const MARGIN_RIGHT = 8;
  const plotWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = height - MARGIN_TOP - MARGIN_BOTTOM;
  const [xMin, xMax] = importanceRange;
  const [yMin, yMax] = satisfactionRange;

  const xScale = (v: number) => MARGIN_LEFT + ((v - xMin) / (xMax - xMin)) * plotWidth;
  const yScale = (v: number) => MARGIN_TOP + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  const xTicks: number[] = [];
  for (let v = xMin; v <= xMax; v++) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v++) yTicks.push(v);

  // 원본 PDF 픽셀 샘플링으로 확인한 고정 경계(2026-07-21) — 중요도는 -2/+2, 만족도는 6/8에서
  // 끊긴다(균등 3등분 아님). importanceRange/satisfactionRange를 기본값([-5,5]/[0,10])과 다르게
  // 넘기는 호출부는 아직 없지만, 혹시 몰라 경계를 범위 안으로 clamp한다.
  const colBands = [
    { x0: xMin, x1: Math.min(-2, xMax), score: 0 },
    { x0: Math.max(xMin, Math.min(-2, xMax)), x1: Math.max(xMin, Math.min(2, xMax)), score: 1 },
    { x0: Math.max(xMin, Math.min(2, xMax)), x1: xMax, score: 2 },
  ];
  const rowBands = [
    { y0: Math.max(yMin, Math.min(8, yMax)), y1: yMax, score: 0 },
    { y0: Math.max(yMin, Math.min(6, yMax)), y1: Math.max(yMin, Math.min(8, yMax)), score: 1 },
    { y0: yMin, y1: Math.max(yMin, Math.min(6, yMax)), score: 2 },
  ];
  const cells = [];
  for (const col of colBands) {
    for (const row of rowBands) {
      const priorityScore = col.score + row.score - 2; // -2(최하,좌상) ~ 2(최상,우하)
      const level = PRIORITY_LEVELS.find((p) => p.score === priorityScore)!;
      cells.push({
        key: `${col.score}-${row.score}`,
        x: xScale(col.x0),
        y: yScale(row.y1),
        w: xScale(col.x1) - xScale(col.x0),
        h: yScale(row.y0) - yScale(row.y1),
        color: level.color,
      });
    }
  }

  return (
    // Y축("만족도")·X축("상대 중요도") 제목 추가(2026-07-22, "그래프의 세로에는 만족도
    // 텍스트가, 가로에는 상대 중요도 텍스트가 들어가야 합니다" 요청) — 세로쓰기는
    // VerticalBarChartWithAverage의 yAxisTitle과 같은 이유로 글자를 한 자씩 줄바꿈해 쌓는다
    // (react-pdf Text의 transform:rotate가 좁은 폭 안에서 줄바꿈된 뒤 회전되며 글자가
    // 뭉개지는 문제가 실측 확인됐던 것과 같은 안전한 패턴).
    <View style={{ flexDirection: "row" }}>
      <View
        style={{ width: 12, height: plotHeight, marginTop: MARGIN_TOP, alignItems: "center", justifyContent: "center" }}
      >
        {"만족도".split("").map((ch, i) => (
          <Text key={i} style={{ fontSize: 7, fontWeight: "bold", color: colors.subtext }}>
            {ch}
          </Text>
        ))}
      </View>
      <View>
      <Svg width={width} height={height}>
        {cells.map((c) => (
          <Rect key={c.key} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.color} />
        ))}
        {/* 실제 보고서는 셀 색이 3단계로만 바뀌어도 grid line은 축의 모든 정수 위치(1단위)마다
            가늘게 그어져 있다(원본 PDF 픽셀 샘플: 내부선 ~#7b7b7b, 외곽선 ~#272727) — 기존엔
            colors.white라 흰 배경 셀에서는 아예 안 보였다(2026-07-21 재대조로 회색으로 교체). */}
        {yTicks.map((v) => (
          <Line
            key={`gy${v}`}
            x1={MARGIN_LEFT}
            y1={yScale(v)}
            x2={width - MARGIN_RIGHT}
            y2={yScale(v)}
            stroke="#9a9a9a"
            strokeWidth={0.4}
          />
        ))}
        {xTicks.map((v) => (
          <Line
            key={`gx${v}`}
            x1={xScale(v)}
            y1={MARGIN_TOP}
            x2={xScale(v)}
            y2={height - MARGIN_BOTTOM}
            stroke="#9a9a9a"
            strokeWidth={0.4}
          />
        ))}
        <Rect
          x={MARGIN_LEFT}
          y={MARGIN_TOP}
          width={plotWidth}
          height={plotHeight}
          fill="none"
          stroke={colors.text}
          strokeWidth={1}
        />
        {yTicks.map((v) => (
          <Text
            key={`yl${v}`}
            x={MARGIN_LEFT - 3}
            y={yScale(v) + 2.5}
            style={{ fontSize: 5.5, fontFamily: "Noto Sans KR" }}
            textAnchor="end"
          >
            {v}
          </Text>
        ))}
        {xTicks.map((v) => (
          <Text
            key={`xl${v}`}
            x={xScale(v)}
            y={height - MARGIN_BOTTOM + 8}
            style={{ fontSize: 5.5, fontFamily: "Noto Sans KR" }}
            textAnchor="middle"
          >
            {v}
          </Text>
        ))}
        {/* 실제 발행 보고서(28페이지)를 다시 대조해보니 점 마커가 아예 없었다(2026-07-22,
            "칸 안에 점이 아니라 완전 텍스트로" 요청) — 항목명 텍스트가 해당 칸 안에 그대로
            적혀 있을 뿐, 옆에 점을 찍지 않는다. Circle을 없애고 라벨을 데이터 좌표에 바로
            (중심 정렬로) 그린다. */}
        {(() => {
          // 좌표가 가까우면 라벨끼리 겹친다(실측 확인, 2026-07-21: "펫 레이싱"/"펫 교배"가
          // 근접해 라벨이 뭉개짐). **2026-07-23 재수정**: 예전엔 고정 픽셀 거리(가로 26·세로
          // 14)로만 충돌을 판정했는데, 이 값은 짧은 한 줄 라벨 기준으로 정한 것이라 지금처럼
          // 긴 기능명이 2~3줄로 줄바꿈되면(라벨 폭이 최대 34pt까지 넓어짐) 실제로는 겹치는데도
          // "충돌 아님"으로 판정돼 그대로 겹쳐 그려지는 문제가 있었다(2026-07-23 실측:
          // "텍스트가 칸 밖으로 너무 많이 벗어난다"). 라벨마다 실제 줄바꿈된 텍스트 폭·줄
          // 수로부터 정확한 바운딩 박스를 구해 진짜 사각형 겹침 여부를 판정하도록 바꿨다 —
          // 어떤 raw data의 기능명이 길어지든(줄 수·폭이 달라지든) 항상 실제 렌더링 크기
          // 기준으로 충돌을 판정한다.
          const LINE_HEIGHT = 6.5;
          const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
          const boxesOverlap = (
            a: { x0: number; x1: number; y0: number; y1: number },
            b: { x0: number; x1: number; y0: number; y1: number },
          ) => a.x0 - 2 < b.x1 && a.x1 + 2 > b.x0 && a.y0 - 1 < b.y1 && a.y1 + 1 > b.y0;

          return items.flatMap((it) => {
            const px = xScale(it.importance);
            const py = yScale(it.satisfaction);
            const lines = wrapQuadrantLabel(it.name);
            const halfWidth = lines.length ? Math.max(...lines.map((l) => estimateTextWidth(l, 6))) / 2 : 0;
            const offsetsFor = (mode: "center" | "below") =>
              lines.map((_, li) => (mode === "below" ? 9 + li * LINE_HEIGHT : (li - (lines.length - 1) / 2) * LINE_HEIGHT));
            const bboxFor = (mode: "center" | "below") => {
              const offsets = offsetsFor(mode);
              return {
                x0: px - halfWidth,
                x1: px + halfWidth,
                y0: py + Math.min(...offsets) - LINE_HEIGHT / 2,
                y1: py + Math.max(...offsets) + LINE_HEIGHT / 2,
              };
            };
            // 정중앙 배치를 먼저 시도하고, 이미 배치된 라벨과 겹치면 아래쪽 배치로 바꾼다
            // (완벽한 전역 최적화는 아니지만, 소수 항목이 몰리는 사분면 산점도에서 실제로
            // 겹치는 경우를 없애기엔 충분하다 — 기존 3차 대조 때 확립된 패턴 재사용).
            let mode: "center" | "below" = "center";
            let box = bboxFor("center");
            if (placed.some((p) => boxesOverlap(box, p))) {
              mode = "below";
              box = bboxFor("below");
            }
            placed.push(box);
            const offsets = offsetsFor(mode);
            return lines.map((line, li) => (
              <Text
                key={`lb-${it.name}-${li}`}
                x={px}
                y={py + offsets[li]}
                style={{ fontSize: 6, fontWeight: "bold", fontFamily: "Noto Sans KR" }}
                textAnchor="middle"
              >
                {line}
              </Text>
            ));
          });
        })()}
      </Svg>
      <Text style={{ fontSize: 7.5, fontWeight: "bold", color: colors.subtext, textAlign: "center", marginTop: 3 }}>
        상대 중요도
      </Text>
      </View>
    </View>
  );
}

/**
 * 항목을 열로, 지표를 행으로 배치하는 전치(transposed) 순위표 — "1위/2위/... 열, 기능/값
 * 행" 형식(Ⅲ장 "기능별 만족도 순위 종합", Ⅳ장 "기능별 중요 순위 종합"에서 공유). **실측 버그
 * (2026-07-21)**: 예전엔 각 항목(열)을 독립된 세로 View 스택으로 만들어서, 긴 기능명이
 * 2줄로 줄바꿈되면 그 열 안에서 다음 텍스트(값)가 밀려 내려가지 않고 겹쳐 보이는 문제가
 * 있었다("실시간 위치 기반 거점형 콘텐츠"가 표를 깨뜨림) — 열이 서로 독립적이라 Yoga가 행
 * 높이를 맞춰줄 방법이 없었던 것으로 보인다. **해결**: 반대로 "행"을 flexDirection:"row"
 * 컨테이너로 만들고 그 안에 라벨 열)+항목별 셀들을 나란히 두는 진짜 표 구조로 바꿨다 —
 * 같은 행 안의 셀들은 표준 flexbox 행 높이 규칙에 따라 자동으로 키가 맞춰지므로(가장 큰
 * 셀 기준), 어떤 셀이 줄바꿈되든 그 행 전체가 같이 늘어나 겹침이 원천적으로 불가능하다.
 */
export function TransposedRankTable({
  rowLabel,
  valueLabel,
  items,
  title,
}: {
  rowLabel: string;
  valueLabel: string;
  items: { name: string; value: number | string }[];
  /** 표 상단에 붙는 라벤더 배너 제목(예: "기능별 만족도 순위 종합"). 원본 Ⅲ장은 이 표에
   * 배너 제목을 붙인다(2026-07-23 대조). 지정하지 않으면 배너 없이 표만 그린다. */
  title?: string;
}) {
  // 숫자 값은 원본처럼 항상 소수점 2자리로 표시한다(7.2 → "7.20"). 문자열 값은 그대로.
  const fmt = (v: number | string) => (typeof v === "number" ? v.toFixed(2) : v);
  const numericValues = items.map((it) => it.value).filter((v): v is number => typeof v === "number");
  const maxVal = numericValues.length ? Math.max(...numericValues) : undefined;
  const minVal = numericValues.length ? Math.min(...numericValues) : undefined;
  const cellBg = (i: number) => {
    const v = items[i].value;
    if (typeof v !== "number") return undefined;
    if (v === maxVal) return "#dbeafe";
    if (v === minVal) return "#fde4d0";
    return undefined;
  };
  const labelCol = { width: 62, backgroundColor: colors.bgAlt, fontWeight: "bold" as const };
  const dataCol = (i: number) => ({
    flex: 1,
    textAlign: "center" as const,
    backgroundColor: cellBg(i),
    borderRightWidth: i === items.length - 1 ? 0 : 1,
    borderRightColor: colors.border,
  });

  return (
    <View style={styles.table} wrap={false}>
      {title && (
        <View
          style={{
            backgroundColor: colors.chartBannerBg,
            paddingVertical: 4,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center", color: colors.navy }}>{title}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={[styles.tableHeaderCell, labelCol, { borderRightWidth: 1 }]}>순위</Text>
        {items.map((it, i) => (
          <Text key={it.name} style={[styles.tableHeaderCell, dataCol(i), { fontWeight: "bold" }]}>
            {i + 1}위
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={[styles.tableCell, labelCol, { borderRightWidth: 1 }]}>{rowLabel}</Text>
        {items.map((it, i) => (
          <Text key={it.name} style={[styles.tableCell, dataCol(i)]}>
            {it.name}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        <Text style={[styles.tableCell, labelCol, { borderRightWidth: 1 }]}>{valueLabel}</Text>
        {items.map((it, i) => (
          <Text key={it.name} style={[styles.tableCell, dataCol(i)]}>
            {fmt(it.value)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** ImportanceSatisfactionChart/CanvasQuadrantChart의 우선순위 판정 기준표("영역별 참고
 * 지표" 범례). */
export function PriorityLegendTable() {
  // marginTop을 컴포넌트 안에 박아두면 옆의 참고 이미지(quadrant-priority-reference.jpeg)와
  // 나란히(flexDirection:row) 놓을 때 둘의 윗변이 어긋난다(2026-07-21, Ⅳ장 페이지 전체
  // 재배치 중 발견) — 간격은 호출부의 gap으로 주도록 하고 컴포넌트 자체는 marginTop 없이
  // 시작한다.
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text
          style={{
            width: 55,
            fontSize: 6.5,
            fontWeight: "bold",
            padding: 2.5,
            backgroundColor: colors.bgAlt,
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          우선순위
        </Text>
        <Text style={{ flex: 1, fontSize: 6.5, fontWeight: "bold", padding: 2.5, backgroundColor: colors.bgAlt }}>
          개선 필요성
        </Text>
      </View>
      {PRIORITY_LEVELS.map((level, i) => (
        <View
          key={level.label}
          style={
            i < PRIORITY_LEVELS.length - 1
              ? { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }
              : { flexDirection: "row" }
          }
        >
          <View
            style={{
              width: 55,
              flexDirection: "row",
              alignItems: "center",
              padding: 2.5,
              borderRightWidth: 1,
              borderRightColor: colors.border,
            }}
          >
            <View style={{ width: 6, height: 6, backgroundColor: level.color, marginRight: 3 }} />
            <Text style={{ fontSize: 6.5 }}>{level.label}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 6.5, padding: 2.5 }}>{level.desc}</Text>
        </View>
      ))}
    </View>
  );
}

/** "영역별 참고 지표" 하단의 상세 판정 기준 문구(실제 발행 보고서 원문 그대로, 2026-07-21).
 * swatch는 PRIORITY_LEVELS.color를 그대로 참조한다 — 예전엔 hex를 여기 따로 하드코딩해뒀다가
 * 실측 색상으로 PRIORITY_LEVELS를 갱신할 때 이 배열은 안 고쳐서 값이 어긋날 뻔했다(2026-07-21).
 * 한 군데(PRIORITY_LEVELS)만 고치면 전부 같이 바뀌도록 참조로 바꿨다. */
function priorityColor(score: (typeof PRIORITY_LEVELS)[number]["score"]) {
  return PRIORITY_LEVELS.find((p) => p.score === score)!.color;
}
const PRIORITY_DETAIL_NOTES: { swatch: string; outline?: boolean; lines: string[] }[] = [
  { swatch: priorityColor(2), lines: ["중요도가 높으나 만족도가 낮으므로 긴급 개선 필요"] },
  {
    swatch: priorityColor(1),
    lines: [
      "중요도가 높으나 만족도가 보통이므로 중요 개선 필요",
      "중요도가 보통이나 만족도가 낮으므로 중요 개선 필요",
    ],
  },
  {
    swatch: priorityColor(0),
    outline: true,
    lines: [
      "중요도가 높으나 만족도가 높으므로 개선 필요성 낮음",
      "중요도가 보통이나 만족도가 낮으므로 개선 필요",
      "중요도가 낮으나 만족도가 낮으므로 제외 or 개선 권장",
    ],
  },
  {
    swatch: priorityColor(-1),
    lines: ["중요도가 보통이고 만족도가 높으므로 추후 고도화", "중요도가 낮으나 만족도가 보통이므로 개선 권장"],
  },
  { swatch: priorityColor(-2), lines: ["중요도가 낮으나 만족도가 높으므로 개선 필요성 낮음"] },
];

export function PriorityDetailNotes() {
  // wrap={false} 필수 — 메인 그래프를 실측 비율(482×453)로 키운 뒤로는 이 절 전체가 페이지
  // 한 장에 다 안 들어가는 경우가 생겼는데(2026-07-22), wrap 없이 두면 이 5줄짜리 목록이
  // 중간에서 반으로 잘려 다음 페이지로 넘어가는 보기 안 좋은 분할이 생겼다 — 통째로 다음
  // 페이지로 넘어가게 해서 최소한 목록 자체는 안 끊기게 한다.
  return (
    <View style={{ marginTop: 3 }} wrap={false}>
      {PRIORITY_DETAIL_NOTES.map((note, i) => (
        <View key={i} style={{ flexDirection: "row", marginTop: i === 0 ? 0 : 2 }}>
          <View
            style={{
              width: 8,
              height: 8,
              backgroundColor: note.swatch,
              borderWidth: note.outline ? 0.5 : 0,
              borderColor: colors.border,
              marginRight: 4,
              marginTop: 1,
            }}
          />
          <View style={{ flex: 1 }}>
            {note.lines.map((line, li) => (
              <Text key={li} style={{ fontSize: 6.5 }}>
                {line}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 긍정/부정/중립 비율을 하나의 가로 막대로 표시한다(원본 보고서의 게이지 차트를 단순화). */
export function PolarityStackedBar({
  positivePct,
  negativePct,
  neutralPct,
}: {
  positivePct: number;
  negativePct: number;
  neutralPct: number;
}) {
  return (
    <View>
      <View style={{ flexDirection: "row", height: 12, borderRadius: 2, overflow: "hidden" }}>
        {positivePct > 0 && (
          <View style={{ width: `${positivePct}%`, backgroundColor: colors.tealDark }} />
        )}
        {negativePct > 0 && (
          <View style={{ width: `${negativePct}%`, backgroundColor: colors.amber }} />
        )}
        {neutralPct > 0 && (
          <View style={{ width: `${neutralPct}%`, backgroundColor: colors.border }} />
        )}
      </View>
      <View style={{ flexDirection: "row", marginTop: 3, gap: 10 }}>
        <Text style={{ fontSize: 7.5, color: colors.tealDark }}>긍정 {positivePct}%</Text>
        <Text style={{ fontSize: 7.5, color: colors.amber }}>부정 {negativePct}%</Text>
        <Text style={{ fontSize: 7.5, color: colors.subtext }}>중립 {neutralPct}%</Text>
      </View>
    </View>
  );
}

/**
 * 사분면 그래프의 캔버스 렌더링 예시(2026-07-23, 사용자 요청 — "PDF도 캔버스 방식 예시를 보고
 * 채택 여부 결정"). 기존 ImportanceSatisfactionChart(SVG 기반, 이 파일 위쪽)는 라벨 폭을
 * estimateTextWidth()로 추측해야 했는데, lib/charts/canvasCharts.ts는 실제 캔버스 폰트로
 * ctx.measureText()를 불러 정확한 폭을 쓴다 — 그래서 라벨이 칸을 벗어나는 문제가 구조적으로
 * 없다. renderQuadrantChart()가 동기적으로 PNG 버퍼를 만들어주므로(캔버스는 async가 필요
 * 없다), 그 버퍼를 그대로 <Image>에 꽂기만 하면 된다 — DOCX와 완전히 같은 렌더링 결과물을
 * 공유한다는 것도 이 방식의 장점이다(SVG 버전은 PDF·DOCX가 각자 다른 방식으로 그렸다).
 * 아직 Ⅳ장에만 적용해봤고, 다른 차트(막대·레이더 등)와 Ⅸ장은 기존 SVG 기반 그대로다 —
 * 사용자가 이 예시를 보고 전면 채택 여부를 결정하면 그때 나머지도 옮긴다.
 */
export function CanvasQuadrantChart({
  items,
  width = 482,
  height = 453,
}: {
  items: { name: string; importance: number; satisfaction: number }[];
  width?: number;
  height?: number;
}) {
  const chart = renderQuadrantChart(items, width, height);
  return (
    <View style={{ alignItems: "center" }}>
      <Image src={chart.buffer} style={{ width: chart.width, height: chart.height }} />
    </View>
  );
}

/** "영역별 참고 지표" 9칸 우선순위 예시 다이어그램 — 저해상도 JPEG 대신 캔버스로 선명하게
 * 그린다(2026-07-23, "예시 사진이 깨진다"). renderPriorityReferenceDiagram이 사분면과 같은
 * 색·경계 공식을 재사용하므로 본 그래프와 항상 일관되고, 어떤 크기에서도 글자가 선명하다. */
export function CanvasPriorityReference({ size = 300 }: { size?: number }) {
  const chart = renderPriorityReferenceDiagram(size, size);
  return <Image src={chart.buffer} style={{ width: chart.width, height: chart.height }} />;
}
