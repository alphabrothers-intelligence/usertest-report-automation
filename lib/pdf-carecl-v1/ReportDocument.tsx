import path from "node:path";
import type { ReactNode } from "react";
import { Document, Page, Text, View, Image, Svg, Path, Rect, Circle, Line as SvgLine } from "@react-pdf/renderer";
import { colors, styles } from "@/lib/pdf-rivalabs-v3/theme";
import type { CareclQuantStats, DistributionItem, ScoreMetric } from "./quant";

const PRODUCT = {
  company: "주식회사 케어클",
  name: "케어클 테크핏(CareCL Techfit)",
  date: "2025.10.28",
  homepage: "https://carecl.co.kr",
};

function Footer() {
  return (
    <View fixed style={styles.footerRow}>
      <Text style={styles.footerSide}>2025 by Alphabrothers</Text>
      <Text style={styles.footerCenter} render={({ pageNumber }) => `- ${pageNumber} -`} />
      <Text style={{ ...styles.footerSide, textAlign: "right" }}>ALPHA BROTHERS</Text>
    </View>
  );
}

function SectionHeader({ numeral, title }: { numeral: string; title: string }) {
  return (
    <View style={styles.sectionHeader} minPresenceAhead={120}>
      <Text style={styles.sectionHeaderBadge}>{numeral}</Text>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
    </View>
  );
}

function Subsection({ number, title }: { number: number; title: string }) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: "#6685dd", marginTop: 8, marginBottom: 14 }} minPresenceAhead={80}>
      <Text style={{ width: 37, textAlign: "center", paddingVertical: 6, backgroundColor: "#dce5f7", fontSize: 13.5 }}>{number}</Text>
      <Text style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 12, fontSize: 14.5, fontWeight: 700 }}>{title}</Text>
    </View>
  );
}

function Band({ children }: { children: ReactNode }) {
  return <View style={{ backgroundColor: colors.chartBannerBg, borderTopWidth: 2, borderTopColor: colors.qUnderline, paddingVertical: 5, alignItems: "center" }}><Text style={{ fontSize: 12, fontWeight: 700 }}>{children}</Text></View>;
}

function Cell({ children, width, strong = false, fill }: { children: ReactNode; width?: number | string; strong?: boolean; fill?: string }) {
  return <View style={{ width, flexGrow: width ? 0 : 1, borderRightWidth: 0.6, borderRightColor: colors.border, backgroundColor: fill, padding: 5, justifyContent: "center" }}><Text style={{ fontSize: 9.5, lineHeight: 1.35, textAlign: "center", fontWeight: strong ? 700 : "normal" }}>{children}</Text></View>;
}

function GridTable({ rows, widths }: { rows: ReactNode[][]; widths?: (number | string)[] }) {
  return <View style={{ borderWidth: 0.8, borderColor: colors.border }}>{rows.map((row, index) => <View key={index} style={{ flexDirection: "row", borderBottomWidth: index === rows.length - 1 ? 0 : 0.6, borderBottomColor: colors.border, minHeight: 25 }}>{row.map((item, cell) => <Cell key={cell} width={widths?.[cell]}>{item}</Cell>)}</View>)}</View>;
}

// 케어클 원본 보고서의 응답 막대는 리바랩스(민트그린)와 달리 진한 파란색이다(원본 6~8·30~33쪽
// 실측). 축 눈금·격자·값 라벨 색도 원본 대조로 맞췄다.
const CARECL_BLUE = "#2f77bd";

// 인적사항 막대는 원본이 응답 수 내림차순이 아니라 설문지 선택지 순서로 나열한다. 라벨을
// 공백 제거 후 부분 일치로 정렬해 라벨 표기가 조금 달라도 안전하게 맞춘다.
function orderItems(items: DistributionItem[], order: string[]): DistributionItem[] {
  const rank = (label: string) => {
    const key = label.replace(/\s+/g, "");
    const i = order.findIndex((o) => key.includes(o.replace(/\s+/g, "")));
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => rank(a.label) - rank(b.label));
}
const AGE_ORDER = ["20대", "30대", "40대", "50대"];
const SKIN_ORDER = ["건성", "지성", "복합성", "민감성", "해당"];
const GENDER_ORDER = ["여성", "남성"];
const USAGE_ORDER = ["사용하지 않음", "주 1-2회", "주 3-4회", "주 5일 이상"];
const LASER_ORDER = ["받아본 적 없음", "받아본 적은 있으나", "가끔", "정기적으로"];
const CYCLE_ORDER = ["주 1회", "주 2회", "주 3회", "주 4회", "주 5회 이상"];
const DURATION_ORDER = ["5분 이상", "10분 이상", "20분 이상", "30분 이상"];
const YESNO_ORDER = ["있어요", "네", "아니요", "없"];

// y축 눈금을 "보기 좋은" 간격으로 잡는다(원본은 나이 0~10(2칸), 성별 0~30, 피부 0~12 등).
function niceStep(max: number): number {
  const rough = Math.max(max, 1) / 5;
  const mag = 10 ** Math.floor(Math.log10(rough || 1));
  const n = rough / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
function niceTop(max: number): { top: number; step: number } {
  const step = niceStep(max);
  let top = Math.ceil(max / step) * step;
  if (top <= max) top += step; // 막대 꼭대기가 축 상단에 붙지 않도록 여유 한 칸
  return { top, step };
}

/**
 * 세로 막대그래프 — 원본 케어클 "[ 응답 결과 ]" 형식(파란 막대 + 왼쪽 y축 눈금 + 격자선 +
 * 막대 위 값 라벨 + x축 카테고리). `mode="count"`면 응답자 수를, `mode="percent"`면 비율을
 * 막대 높이·라벨로 쓴다(인적사항은 원본이 응답자 수 기준).
 */
function VBarChart({ items, mode = "count", plotH = 150 }: { items: DistributionItem[]; mode?: "count" | "percent"; plotH?: number }) {
  const valueOf = (it: DistributionItem) => (mode === "count" ? it.count : it.percent);
  const dataMax = Math.max(...items.map(valueOf), 1);
  const { top, step } = niceTop(dataMax);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(Math.round(v * 10) / 10);
  return (
    <View style={{ flexDirection: "row", paddingTop: 4 }}>
      <View style={{ width: 22, height: plotH, justifyContent: "space-between" }}>
        {ticks.slice().reverse().map((v) => <Text key={v} style={{ fontSize: 6.5, color: colors.subtext, textAlign: "right", paddingRight: 3 }}>{v}</Text>)}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ height: plotH, position: "relative", borderBottomWidth: 0.7, borderColor: "#9ca3af" }}>
          {ticks.map((v) => <View key={v} style={{ position: "absolute", left: 0, right: 0, bottom: (v / top) * plotH, height: 0.4, backgroundColor: "#e5e7eb" }} />)}
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end" }}>
            {items.map((it) => {
              const val = valueOf(it);
              return (
                <View key={it.label} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: plotH }}>
                  <Text style={{ fontSize: 7.5, marginBottom: 2 }}>{mode === "count" ? it.count : `${it.percent}%`}</Text>
                  <View style={{ width: "44%", height: Math.max(1, (val / top) * plotH), backgroundColor: CARECL_BLUE }} />
                </View>
              );
            })}
          </View>
        </View>
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          {items.map((it) => <Text key={it.label} style={{ flex: 1, fontSize: 6.8, textAlign: "center" }}>{it.label}</Text>)}
        </View>
      </View>
    </View>
  );
}

// 원본 유지용 얇은 래퍼(기존 호출부 호환) — 인적사항·핵심요인 등에서 mode만 바꿔 쓴다.
function DistributionChart({ items, mode = "count" }: { items: DistributionItem[]; mode?: "count" | "percent" }) {
  return <VBarChart items={items} mode={mode} />;
}

// 표 공통 색(원본 실측): 헤더 라벤더 / 1위 연파랑 하이라이트 / 최하 연주황 하이라이트.
const T_HEADER = "#dce5f7";
const T_HL_TOP = "#dbeafe";
const T_HL_LOW = "#fde4d0";
const T_BORDER = "#b9c4d6";

/** NPS 요약표 — 원본 42쪽·리바랩스 NpsSummaryTable 형식: 라벤더 헤더 + 값 2행, "NPS 지수"와
 * "추천 고객" 사이(입력값 2칸 ↔ 비율 3칸)에 굵은 세로 구분선. */
function NpsSummaryTable({ nps }: { nps: CareclQuantStats["nps"] }) {
  const cells = [
    { label: "평균 추천 의향", value: nps.average.toFixed(2) },
    { label: "NPS 지수", value: String(nps.score) },
    { label: "추천 고객\n(PROMOTERS)", value: `${nps.promoters}%` },
    { label: "중립 고객\n(PASSIVES)", value: `${nps.passives}%` },
    { label: "비추천 고객\n(DETRACTORS)", value: `${nps.detractors}%` },
  ];
  const rb = (i: number) => ({ borderRightWidth: i === 1 ? 2.5 : i < cells.length - 1 ? 1 : 0, borderRightColor: i === 1 ? colors.navy : T_BORDER });
  return <View style={{ borderWidth: 1, borderColor: T_BORDER }}>
    <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: T_BORDER }}>
      {cells.map((c, i) => <View key={c.label} style={{ flex: 1, backgroundColor: T_HL_TOP, justifyContent: "center", padding: 6, ...rb(i) }}><Text style={{ fontSize: 8, fontWeight: 700, textAlign: "center", lineHeight: 1.3 }}>{c.label}</Text></View>)}
    </View>
    <View style={{ flexDirection: "row" }}>
      {cells.map((c, i) => <View key={c.label} style={{ flex: 1, justifyContent: "center", padding: 8, ...rb(i) }}><Text style={{ fontSize: 11, fontWeight: 700, textAlign: "center" }}>{c.value}</Text></View>)}
    </View>
  </View>;
}

/** 항목을 열로, 지표를 행으로 배치하는 전치 순위표 — 원본 "기능별 만족도 순위 종합" 형식
 * (라벤더 배너 제목 + 순위/기능/값 3행, 1위 열 연파랑·최하 열 연주황 하이라이트, 리바랩스
 * TransposedRankTable과 동일 패턴). items는 값 내림차순 정렬해서 넘긴다. */
function RankSummaryTable({ title, rowLabel, valueLabel, items }: { title: string; rowLabel: string; valueLabel: string; items: { name: string; value: number }[] }) {
  const maxV = Math.max(...items.map((it) => it.value));
  const minV = Math.min(...items.map((it) => it.value));
  const labelCell = { width: 60, backgroundColor: T_HEADER, borderRightWidth: 0.8, borderRightColor: T_BORDER, justifyContent: "center" as const, padding: 5 };
  const dataCell = (v: number | null, i: number) => ({ flex: 1, borderRightWidth: i === items.length - 1 ? 0 : 0.8, borderRightColor: T_BORDER, backgroundColor: v === null ? undefined : v === maxV ? T_HL_TOP : v === minV ? T_HL_LOW : undefined, justifyContent: "center" as const, padding: 5 });
  const th = { fontSize: 8, fontWeight: 700 as const, textAlign: "center" as const };
  return <View style={{ borderWidth: 1, borderColor: T_BORDER, marginTop: 10 }}>
    <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: T_BORDER }}><Text style={{ fontSize: 9.5, fontWeight: 700, textAlign: "center", color: colors.navy }}>{title}</Text></View>
    <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: T_BORDER }}>
      <View style={labelCell}><Text style={th}>순위</Text></View>
      {items.map((it, i) => <View key={it.name} style={dataCell(null, i)}><Text style={th}>{i + 1}위</Text></View>)}
    </View>
    <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: T_BORDER }}>
      <View style={labelCell}><Text style={th}>{rowLabel}</Text></View>
      {items.map((it, i) => <View key={it.name} style={dataCell(it.value, i)}><Text style={{ fontSize: 7.5, textAlign: "center", lineHeight: 1.25 }}>{it.name}</Text></View>)}
    </View>
    <View style={{ flexDirection: "row" }}>
      <View style={labelCell}><Text style={th}>{valueLabel}</Text></View>
      {items.map((it, i) => <View key={it.name} style={dataCell(it.value, i)}><Text style={{ fontSize: 8.5, textAlign: "center" }}>{it.value.toFixed(2)}</Text></View>)}
    </View>
  </View>;
}

/** 핵심구매요소 순위 표(원본 36쪽) — 라벤더 헤더 + 1위 행 연회색 하이라이트, 비율은 소수 1자리. */
function RankedFactorTable({ items }: { items: CareclQuantStats["coreFactors"] }) {
  const th = { fontSize: 9, fontWeight: 700 as const, textAlign: "center" as const };
  const td = { fontSize: 9.5, textAlign: "center" as const };
  return <View style={{ borderWidth: 1, borderColor: T_BORDER }}>
    <View style={{ flexDirection: "row", backgroundColor: T_HEADER, borderBottomWidth: 1, borderBottomColor: T_BORDER }}>
      <View style={{ width: 90, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 6, justifyContent: "center" }}><Text style={th}>순위</Text></View>
      <View style={{ flex: 1, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 6, justifyContent: "center" }}><Text style={th}>핵심 구매 요소</Text></View>
      <View style={{ width: 90, padding: 6, justifyContent: "center" }}><Text style={th}>비율</Text></View>
    </View>
    {items.map((it, idx) => {
      const hl = it.rank === 1 ? colors.bgAlt : undefined;
      return <View key={it.name} style={{ flexDirection: "row", borderBottomWidth: idx === items.length - 1 ? 0 : 0.6, borderBottomColor: T_BORDER, backgroundColor: hl }}>
        <View style={{ width: 90, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 7, justifyContent: "center" }}><Text style={{ ...td, fontWeight: it.rank === 1 ? 700 : "normal" }}>{it.rank}위</Text></View>
        <View style={{ flex: 1, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 7, justifyContent: "center" }}><Text style={{ ...td, fontWeight: it.rank === 1 ? 700 : "normal" }}>{it.name}</Text></View>
        <View style={{ width: 90, padding: 7, justifyContent: "center" }}><Text style={{ ...td, fontWeight: it.rank === 1 ? 700 : "normal" }}>{it.percent.toFixed(1)}%</Text></View>
      </View>;
    })}
  </View>;
}

/** 고객 여정 단계별 평균 만족도 표(원본 34쪽) — 값 아래 직전 단계 대비 변화율(증가 파랑/감소 빨강). */
function JourneyTable({ flow }: { flow: { label: string; value: number }[] }) {
  const labelCell = { width: 70, backgroundColor: T_HEADER, borderRightWidth: 0.8, borderRightColor: T_BORDER, justifyContent: "center" as const, padding: 5 };
  const change = (i: number) => {
    if (i === 0) return null;
    const diff = ((flow[i].value - flow[i - 1].value) / flow[i - 1].value) * 100;
    if (Math.abs(diff) < 0.005) return { text: "(-)", color: colors.subtext };
    return { text: `(${diff > 0 ? "+" : ""}${diff.toFixed(2)}%)`, color: diff > 0 ? "#2f6fd0" : "#d9534f" };
  };
  return <View style={{ borderWidth: 1, borderColor: T_BORDER }}>
    <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: T_BORDER }}>
      <View style={labelCell}><Text style={{ fontSize: 8.5, fontWeight: 700, textAlign: "center" }}>단계</Text></View>
      {flow.map((s, i) => <View key={s.label} style={{ flex: 1, borderRightWidth: i === flow.length - 1 ? 0 : 0.8, borderRightColor: T_BORDER, justifyContent: "center", padding: 5 }}><Text style={{ fontSize: 8, fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>{s.label}</Text></View>)}
    </View>
    <View style={{ flexDirection: "row" }}>
      <View style={labelCell}><Text style={{ fontSize: 8.5, fontWeight: 700, textAlign: "center" }}>평균 만족도</Text></View>
      {flow.map((s, i) => { const c = change(i); return <View key={s.label} style={{ flex: 1, borderRightWidth: i === flow.length - 1 ? 0 : 0.8, borderRightColor: T_BORDER, alignItems: "center", padding: 6 }}><Text style={{ fontSize: 9.5, fontWeight: 700 }}>{s.value.toFixed(2)}</Text>{c && <Text style={{ fontSize: 7, color: c.color, marginTop: 2 }}>{c.text}</Text>}</View>; })}
    </View>
  </View>;
}

// 문항별 0~10점 응답 분포 히스토그램(원본은 기능별 문항마다 이 분포도가 있다).
function ScoreChart({ metric, max = 10 }: { metric: ScoreMetric; max?: number }) {
  const distribution = Array.from({ length: max + 1 }, (_, score) => {
    const found = metric.distribution.find((item) => Number(item.label) === score);
    return { label: `${score}점`, count: found?.count ?? 0, percent: found?.percent ?? 0 };
  });
  return <VBarChart items={distribution} mode="count" plotH={140} />;
}

// 여러 지표의 평균을 한 축에 나란히 + 전체 평균선(원본 기능별/가치 종합 차트 형식). 값이
// 몰려 있어도(6~8점대) 차이가 보이도록 축을 min~10이 아니라 데이터 스프레드에 맞춘다.
function MeanBarChart({ metrics, average, min = 0 }: { metrics: ScoreMetric[]; average?: number; min?: number }) {
  const plotH = 190;
  const all = [...metrics.map((m) => m.mean), ...(average !== undefined ? [average] : [])];
  const lo = min || Math.max(0, Math.floor(Math.min(...all)) - 1);
  const hi = Math.min(10, Math.floor(Math.max(...all)) + 1);
  const range = hi - lo || 1;
  const step = niceStep(range);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-6; v += step) ticks.push(Math.round(v * 10) / 10);
  return (
    <View style={{ flexDirection: "row", paddingTop: 4 }}>
      <View style={{ width: 22, height: plotH, justifyContent: "space-between" }}>
        {ticks.slice().reverse().map((v) => <Text key={v} style={{ fontSize: 6.5, color: colors.subtext, textAlign: "right", paddingRight: 3 }}>{v}</Text>)}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ height: plotH, position: "relative", borderBottomWidth: 0.7, borderColor: "#9ca3af" }}>
          {ticks.map((v) => <View key={v} style={{ position: "absolute", left: 0, right: 0, bottom: ((v - lo) / range) * plotH, height: 0.4, backgroundColor: "#e5e7eb" }} />)}
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end" }}>
            {metrics.map((metric) => (
              <View key={metric.name} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: plotH }}>
                <Text style={{ fontSize: 7.5, fontWeight: 700, marginBottom: 2 }}>{metric.mean.toFixed(2)}</Text>
                <View style={{ width: "50%", height: Math.max(1, ((metric.mean - lo) / range) * plotH), backgroundColor: CARECL_BLUE }} />
              </View>
            ))}
          </View>
          {average !== undefined && <View style={{ position: "absolute", left: 0, right: 0, bottom: ((average - lo) / range) * plotH, height: 1.2, backgroundColor: "#e8792b" }} />}
        </View>
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          {metrics.map((metric) => <Text key={metric.name} style={{ flex: 1, fontSize: 6.8, textAlign: "center" }}>{metric.name}</Text>)}
        </View>
      </View>
    </View>
  );
}

// 8개 핵심요인 고정 색 팔레트(범례·누적막대가 coreFactorOrder 순서로 공유).
const RANK_PALETTE = ["#e15759", "#4e79a7", "#76b7b2", "#b07aa1", "#59a14f", "#ff9da7", "#edc948", "#af7aa1"];

/** 순위 위치별(1위~8위) 요인 구성 가로 누적막대 — 원본 36쪽 "[ 핵심구매요소 조사 결과 ]". */
function RankCompositionChart({ composition, order }: { composition: CareclQuantStats["coreFactorRankComposition"]; order: string[] }) {
  const colorFor = (name: string) => RANK_PALETTE[Math.max(0, order.indexOf(name)) % RANK_PALETTE.length];
  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8, justifyContent: "center" }}>
        {order.map((name) => <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 7, height: 7, backgroundColor: colorFor(name) }} /><Text style={{ fontSize: 6.5 }}>{name}</Text></View>)}
      </View>
      {composition.map((row) => (
        <View key={row.rank} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ width: 26, fontSize: 7.5 }}>{row.rank}위</Text>
          <View style={{ flex: 1, flexDirection: "row", height: 13, backgroundColor: "#f4f4f5" }}>
            {row.segments.map((seg) => seg.count > 0 && <View key={seg.name} style={{ width: `${seg.percent}%`, backgroundColor: colorFor(seg.name) }} />)}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", marginLeft: 26, marginTop: 2 }}>
        {[0, 20, 40, 60, 80, 100].map((v) => <Text key={v} style={{ flex: 1, fontSize: 6, color: colors.subtext }}>{v}</Text>)}
      </View>
    </View>
  );
}

// Catmull-Rom 스플라인을 베지어로 변환해 부드러운 곡선 path를 만든다(원본 34쪽 꺾은선은
// 직선이 아니라 매끄러운 곡선이다).
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

// 고객 여정 평균 만족도 흐름 꺾은선(원본 34쪽) — 연한 배경 + 정수 격자 0~10 + 부드러운 곡선.
// SVG 텍스트는 한글 폰트 상속 문제가 있어(CLAUDE.md) 값·축·x라벨은 SVG 밖 <Text>로 겹쳐 그린다.
// 점을 좌우 끝에서 안쪽(padX)으로 들여, 첫 점 값 라벨이 y축 눈금과 겹치지 않게 한다.
function JourneyLineChart({ points }: { points: { label: string; value: number }[] }) {
  const W = 512, H = 196, ml = 28, mr = 14, mt = 16, mb = 26, padX = 30;
  const pw = W - ml - mr, ph = H - mt - mb, iw = pw - 2 * padX;
  const xAt = (i: number) => ml + padX + (points.length <= 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const yAt = (v: number) => mt + ph - (ph * v) / 10;
  const yTicks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const svgPts = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));
  return (
    <View style={{ position: "relative", width: W, height: H, alignSelf: "center" }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={ml} y={mt} width={pw} height={ph} fill="#eef2fb" />
        {yTicks.map((t) => <SvgLine key={t} x1={ml} y1={yAt(t)} x2={W - mr} y2={yAt(t)} stroke="#dce2ef" strokeWidth={0.5} />)}
        <Path d={smoothPath(svgPts)} fill="none" stroke={CARECL_BLUE} strokeWidth={1.8} />
        {svgPts.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={2.6} fill={CARECL_BLUE} />)}
      </Svg>
      {yTicks.map((t) => <Text key={t} style={{ position: "absolute", left: 0, top: yAt(t) - 4, width: ml - 6, fontSize: 6, color: colors.subtext, textAlign: "right" }}>{t}</Text>)}
      {points.map((p, i) => <Text key={`v${i}`} style={{ position: "absolute", left: xAt(i) - 22, top: yAt(p.value) - 14, width: 44, fontSize: 7.2, fontWeight: 700, textAlign: "center", color: colors.navy }}>{p.value.toFixed(2)}점</Text>)}
      {points.map((p, i) => <Text key={`x${i}`} style={{ position: "absolute", left: xAt(i) - 40, top: H - mb + 8, width: 80, fontSize: 6.3, textAlign: "center" }}>{p.label}</Text>)}
    </View>
  );
}

// 단계 간 평균 만족도 변화 발산 막대(원본 34쪽) — y축 눈금 + 0선 + 막대 색(증가 초록 / 최대
// 감소 빨강 / 그 외 감소 주황). 값 라벨은 막대 끝 바깥(증가 위·감소 아래), x라벨엔 변화값 병기.
function ChangeBarChart({ items }: { items: { label: string; delta: number }[] }) {
  const W = 512, ml = 34, mr = 12, mt = 14, mb = 30, H = 200;
  const pw = W - ml - mr, ph = H - mt - mb;
  const deltas = items.map((it) => it.delta);
  const minDelta = Math.min(...deltas);
  const step = niceStep(Math.max(Math.max(...deltas, 0) - Math.min(...deltas, 0), 0.5));
  const yMax = Math.max(0.5, Math.ceil(Math.max(...deltas, 0) / step) * step);
  const yMin = Math.min(0, Math.floor(Math.min(...deltas, 0) / step) * step);
  const yAt = (v: number) => mt + ph - (ph * (v - yMin)) / (yMax - yMin);
  const zeroY = yAt(0);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-6; v += step) yTicks.push(Math.round(v * 100) / 100);
  const colW = pw / items.length;
  const barW = colW * 0.42;
  const colorFor = (d: number) => (d >= 0 ? "#5aa469" : d === minDelta ? "#d9534f" : "#e8973a");
  return (
    <View style={{ position: "relative", width: W, height: H + 16, alignSelf: "center" }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {yTicks.map((t) => <SvgLine key={t} x1={ml} y1={yAt(t)} x2={W - mr} y2={yAt(t)} stroke="#e5e7eb" strokeWidth={0.5} />)}
        <SvgLine x1={ml} y1={zeroY} x2={W - mr} y2={zeroY} stroke="#9ca3af" strokeWidth={0.9} />
        {items.map((it, i) => {
          const cx = ml + colW * (i + 0.5);
          const yv = yAt(it.delta);
          return <Rect key={it.label} x={cx - barW / 2} y={Math.min(zeroY, yv)} width={barW} height={Math.max(1, Math.abs(yv - zeroY))} fill={colorFor(it.delta)} />;
        })}
      </Svg>
      {yTicks.map((t) => <Text key={t} style={{ position: "absolute", left: 0, top: yAt(t) - 4, width: ml - 5, fontSize: 6, color: colors.subtext, textAlign: "right" }}>{t > 0 ? "+" : ""}{t.toFixed(1)}점</Text>)}
      {items.map((it, i) => {
        const cx = ml + colW * (i + 0.5), yv = yAt(it.delta), pos = it.delta >= 0;
        return <Text key={`v${it.label}`} style={{ position: "absolute", left: cx - 30, top: pos ? yv - 13 : yv + 2, width: 60, fontSize: 7.5, fontWeight: 700, textAlign: "center", color: colorFor(it.delta) }}>{pos ? "+" : ""}{it.delta.toFixed(2)}점</Text>;
      })}
      {items.map((it, i) => <Text key={`x${it.label}`} style={{ position: "absolute", left: ml + colW * i, top: H + 2, width: colW, fontSize: 6.3, textAlign: "center" }}>{it.label} ({it.delta > 0 ? "+" : ""}{it.delta.toFixed(2)})</Text>)}
    </View>
  );
}

function Question({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <View wrap={false} style={{ marginBottom: 16 }}>
    <View style={{ flexDirection: "row", marginBottom: 5 }}><Text style={{ fontSize: 12.2, width: 28 }}>Q{number}.</Text><Text style={{ fontSize: 12.2, lineHeight: 1.35, flex: 1 }}>{title}</Text></View>
    <Band>[ 응답 결과 ]</Band>
    <View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 9 }}>{children}</View>
  </View>;
}

function Cover() {
  return <Page size="A4" style={styles.page}><View style={{ height: 748, justifyContent: "space-between" }}>
    <View><Text style={{ fontSize: 10, color: "#5a76aa", letterSpacing: 1.5, marginTop: 15 }}>USABILITY TEST REPORT</Text><View style={{ width: 38, borderTopWidth: 4, borderTopColor: "#4fc6de", marginTop: 18 }} />
      <Text style={{ fontSize: 34, fontWeight: 700, color: "#1f5d9f", lineHeight: 1.32, marginTop: 125 }}>사용성 테스트{"\n"}결과보고서</Text>
      <Text style={{ fontSize: 25, color: "#5072bd", fontWeight: 700, marginTop: 32 }}>케어클</Text>
      <Text style={{ fontSize: 12, color: colors.subtext, marginTop: 12 }}>Usability Test Report for ‘테크핏’</Text><Text style={{ fontSize: 11, color: colors.subtext, marginTop: 34 }}>{PRODUCT.date}</Text>
    </View><Text style={{ fontSize: 12, fontWeight: 700, textAlign: "center" }}>ALPHA BROTHERS</Text>
  </View></Page>;
}

function Overview() {
  return <><SectionHeader numeral="I" title="개요" /><Subsection number={1} title="제품 소개" />
    <Band>기업 개요</Band><GridTable rows={[["기업명", PRODUCT.company, "홈페이지", PRODUCT.homepage], ["대표자", "최형규", "업무 담당자", "노정화"]]} widths={[90, "30%", 90, "30%"]} />
    <View style={{ marginTop: 10 }}><Band>제품 및 서비스 개요</Band><GridTable rows={[["서비스 명", PRODUCT.name], ["서비스 요약", "피부 리프팅·탄력 개선을 위한 고주파 스탬핑 방식의 홈케어 뷰티 디바이스"], ["사업 영역", "B2C", "산업 분야", "미용·헬스케어"], ["운영 환경", "제품", "사업화 단계", "시장 검증 단계"]]} widths={[90, "30%", 90, "30%"]} /></View>
    <View style={{ marginTop: 12, flexDirection: "row", borderWidth: 0.8, borderColor: "#6685dd" }}><View style={{ width: 90, backgroundColor: "#dce5f7", justifyContent: "center" }}><Text style={{ textAlign: "center", fontWeight: 700 }}>주요 기능</Text></View><View style={{ flex: 1, padding: 10 }}><Text style={styles.body}>1. 고주파 스탬핑 기술 적용{"\n"}피부 깊숙이 정밀한 열 에너지를 전달하는 RF 스탬핑 방식으로 탄력 개선 효과를 높입니다.{"\n\n"}2. 3가지 모드(SHOT / EMS / GLOW)와 강도 조절{"\n"}피부 컨디션과 관리 목적에 맞춰 세밀한 홈케어 관리를 지원합니다.{"\n\n"}3. 전용 콜라겐 젤 및 그리드 마스크팩 연동{"\n"}고주파 전달 효율과 피부 자극 완화를 돕는 전용 액세서리와 연동됩니다.</Text></View></View>
  </>;
}

function SurveyTable({ stats }: { stats: CareclQuantStats }) {
  // 설문 항목은 raw data CSV 헤더에서 도출한 stats.survey를 그대로 쓴다(하드코딩 금지). 같은
  // 단계가 연속되는 구간을 묶어 원본처럼 "단계" 열이 병합된 것처럼 보이게 한다.
  const groups: { stage: string; items: { q: number; question: string }[] }[] = [];
  stats.survey.forEach((row, i) => {
    const last = groups[groups.length - 1];
    if (last && last.stage === row.stage) last.items.push({ q: i + 1, question: row.question });
    else groups.push({ stage: row.stage, items: [{ q: i + 1, question: row.question }] });
  });
  return <><Subsection number={2} title="사용성 테스트 진행 일정" /><Text style={styles.body}>• 테스트 대상 : 피부과·에스테틱·홈케어 이용 경험자 (총 {stats.respondentCount}명){"\n"}• 테스트 기간 : 2025년 10월 3일 ~ 2025년 10월 17일{"\n"}• 담당자 : 송영민 팀장 / 김민지 파트장</Text><View break><Subsection number={3} title="사용성 테스트 설문 항목" />
    <View style={{ flexDirection: "row", borderWidth: 0.8, borderBottomWidth: 0, borderColor: T_BORDER, backgroundColor: T_HEADER }}><View style={{ width: 100, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 6, justifyContent: "center" }}><Text style={{ textAlign: "center", fontSize: 9.5, fontWeight: 700 }}>단계</Text></View><View style={{ flex: 1, padding: 6, justifyContent: "center" }}><Text style={{ textAlign: "center", fontSize: 9.5, fontWeight: 700 }}>주요 활동</Text></View></View>
    {groups.map((group) => <View key={group.stage} style={{ flexDirection: "row", borderLeftWidth: 0.8, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: T_BORDER }} wrap={false}><View style={{ width: 100, backgroundColor: T_HEADER, borderRightWidth: 0.8, borderRightColor: T_BORDER, justifyContent: "center", padding: 7 }}><Text style={{ textAlign: "center", fontSize: 9, fontWeight: 700, lineHeight: 1.3 }}>{group.stage}</Text></View><View style={{ flex: 1 }}>{group.items.map((it, idx) => <View key={it.q} style={{ flexDirection: "row", borderBottomWidth: idx === group.items.length - 1 ? 0 : 0.5, borderColor: T_BORDER, paddingVertical: 5, alignItems: "flex-start" }}><Text style={{ width: 34, paddingLeft: 7, fontSize: 9, fontWeight: 700 }}>Q{it.q}</Text><Text style={{ flex: 1, fontSize: 9, lineHeight: 1.3, paddingRight: 6 }}>{it.question}</Text></View>)}</View></View>)}</View>
  </>;
}

// Q6 경쟁재 경험 유무 — 원본 7쪽처럼 "구분 | (있음) | (없음)" 2열 응답자 수 표.
function YesNoTable({ items }: { items: DistributionItem[] }) {
  const cells = orderItems(items, YESNO_ORDER);
  return <View style={{ borderWidth: 1, borderColor: T_BORDER }}>
    <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: T_BORDER }}><Text style={{ fontSize: 9.5, fontWeight: 700, textAlign: "center", color: colors.navy }}>경쟁재 경험 조사</Text></View>
    <View style={{ flexDirection: "row", backgroundColor: T_HEADER, borderBottomWidth: 0.8, borderBottomColor: T_BORDER }}>
      <View style={{ width: 90, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 6, justifyContent: "center" }}><Text style={{ fontSize: 9, fontWeight: 700, textAlign: "center" }}>구분</Text></View>
      {cells.map((c, i) => <View key={c.label} style={{ flex: 1, borderRightWidth: i === cells.length - 1 ? 0 : 0.8, borderRightColor: T_BORDER, padding: 6, justifyContent: "center" }}><Text style={{ fontSize: 9, fontWeight: 700, textAlign: "center" }}>{c.label}</Text></View>)}
    </View>
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: 90, borderRightWidth: 0.8, borderRightColor: T_BORDER, padding: 7, justifyContent: "center" }}><Text style={{ fontSize: 9, fontWeight: 700, textAlign: "center" }}>응답자 수</Text></View>
      {cells.map((c, i) => <View key={c.label} style={{ flex: 1, borderRightWidth: i === cells.length - 1 ? 0 : 0.8, borderRightColor: T_BORDER, padding: 7, justifyContent: "center" }}><Text style={{ fontSize: 9.5, textAlign: "center" }}>{c.count}</Text></View>)}
    </View>
  </View>;
}

function Demographics({ stats }: { stats: CareclQuantStats }) {
  const q = (i: number) => stats.survey[i]?.question ?? "";
  return <><SectionHeader numeral="II" title="인적 사항 및 특성 · 경험 조사" />
    <Question number={1} title={q(0)}><DistributionChart items={orderItems(stats.age, AGE_ORDER)} /></Question>
    <Question number={2} title={q(1)}><DistributionChart items={orderItems(stats.gender, GENDER_ORDER)} /></Question>
    <Question number={3} title={q(2)}><DistributionChart items={orderItems(stats.skinType, SKIN_ORDER)} /></Question>
    <Question number={4} title={q(3)}><DistributionChart items={orderItems(stats.priorDeviceUsage, USAGE_ORDER)} /></Question>
    <Question number={5} title={q(4)}><DistributionChart items={orderItems(stats.laserExperience, LASER_ORDER)} /></Question>
    <View wrap={false} style={{ marginBottom: 16 }}><View style={{ flexDirection: "row", marginBottom: 5 }}><Text style={{ fontSize: 12.2, width: 28 }}>Q6.</Text><Text style={{ fontSize: 12.2, lineHeight: 1.35, flex: 1 }}>{q(5)}</Text></View><YesNoTable items={stats.competitorExperience} /></View>
    <Question number={7} title={q(6)}><DistributionChart items={stats.experiencedDevices} /></Question>
    <Question number={8} title={q(7)}><ScoreChart metric={stats.experiencedSatisfaction} /></Question>
  </>;
}

function LegendRow({ average }: { average: number }) {
  return <View style={{ flexDirection: "row", justifyContent: "center", gap: 14, marginBottom: 6 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 8, height: 8, backgroundColor: CARECL_BLUE }} /><Text style={{ fontSize: 7 }}>평균 만족도</Text></View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 11, height: 1.5, backgroundColor: "#e8792b" }} /><Text style={{ fontSize: 7 }}>전체 평균 {average.toFixed(2)}점</Text></View>
  </View>;
}

function FeatureSection({ stats }: { stats: CareclQuantStats }) {
  const featureAverage = Math.round((stats.features.reduce((sum, m) => sum + m.mean, 0) / stats.features.length) * 100) / 100;
  return <><SectionHeader numeral="III" title="기능별 고객 경험 평가" /><Subsection number={1} title="기능별 고객 경험 조사 결과" /><Band>[ 기능별 만족도 조사 결과 ]</Band><View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 9 }}><LegendRow average={featureAverage} /><MeanBarChart metrics={stats.features} average={featureAverage} /></View>
    <RankSummaryTable title="기능별 만족도 순위 종합" rowLabel="기능" valueLabel="평균 만족도" items={[...stats.features].sort((a, b) => b.mean - a.mean).map((m) => ({ name: m.name, value: m.mean }))} />
    {stats.features.map((metric, index) => <Question key={metric.name} number={10 + index} title={stats.survey[9 + index]?.question ?? `‘${metric.name}’ 기능의 만족도는 몇 점입니까?`}><View style={{ flexDirection: "row" }}><View style={{ flex: 1 }}><ScoreChart metric={metric} /></View><View style={{ width: 120, paddingLeft: 8 }}><Text style={{ fontSize: 10, fontWeight: 700 }}>정량 요약</Text><Text style={{ ...styles.body, fontSize: 9.5, marginTop: 5 }}>평균 {metric.mean.toFixed(2)}점{"\n"}표준편차 {metric.sd.toFixed(2)}{"\n\n"}정성 의견 요약은 Claude API 분석 결과를 연결한 뒤 이 영역에 삽입됩니다.</Text></View></View></Question>)}
  </>;
}

function JourneySection({ stats }: { stats: CareclQuantStats }) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // 여정 흐름: 5개 단계 + 최종 만족도(종합 만족도). 원본 34쪽 형식.
  const flow = [...stats.journey.map((m) => ({ label: m.name, value: m.mean })), { label: "최종 만족도", value: stats.overall.mean }];
  // 단계 간 변화(원본은 개봉→첫사용부터 표시).
  const transitions: [number, number, string][] = [[1, 2, "개봉→첫사용"], [2, 3, "첫사용→1주"], [3, 4, "1주→2주"], [4, 5, "2주→최종"]];
  const changes = transitions.map(([a, b, label]) => ({ label, delta: r2(flow[b].value - flow[a].value) }));
  const sq = (i: number) => stats.survey[i]?.question ?? "";
  return <><View break /><SectionHeader numeral="IV" title="고객 여정 기반 경험 평가" />
    <Subsection number={1} title="고객 여정 기반 경험 평가 조사 결과" />
    <Question number={18} title={sq(17)}><DistributionChart items={orderItems(stats.usageCycle, CYCLE_ORDER)} /></Question>
    <Question number={19} title={sq(18)}><DistributionChart items={orderItems(stats.usageDuration, DURATION_ORDER)} /></Question>
    {stats.journey.map((metric, index) => <Question key={metric.name} number={20 + index} title={sq(19 + index)}><ScoreChart metric={metric} /></Question>)}
    <View break /><Subsection number={2} title="고객 여정 기반 경험 평가 결과 분석" />
    <Band>고객 여정 만족도 평가</Band>
    <JourneyTable flow={flow} />
    <View style={{ marginTop: 14 }}><Band>[ 고객 여정 흐름 평균 만족도 결과 ]</Band><View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 12 }} wrap={false}><JourneyLineChart points={flow} /></View></View>
    <View style={{ marginTop: 14 }}><Band>[ 고객 여정 흐름 평균 만족도 변화 상세 분석 ]</Band><View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 12 }} wrap={false}><ChangeBarChart items={changes} /></View></View>
  </>;
}

function CoreFactors({ stats }: { stats: CareclQuantStats }) {
  const items = stats.coreFactors;
  return <><View break /><SectionHeader numeral="V" title="핵심 구매 요소" />
    <Question number={25} title="테크핏 제품 이용에 가장 영향을 미칠 수 있는 핵심 요인은 무엇입니까? 가장 중요하다고 생각되는 순위를 1위부터 8위까지 순서대로 작성해주세요."><RankCompositionChart composition={stats.coreFactorRankComposition} order={stats.coreFactorOrder} /></Question>
    <RankedFactorTable items={items} />
  </>;
}

function Values({ stats }: { stats: CareclQuantStats }) {
  const valueAverage = Math.round((stats.values.reduce((sum, m) => sum + m.mean, 0) / stats.values.length) * 100) / 100;
  return <><View break /><SectionHeader numeral="VI" title="4대 가치 만족도" /><Band>[ 4대 가치 만족도 종합 결과 ]</Band><View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 9 }}><LegendRow average={valueAverage} /><MeanBarChart metrics={stats.values} average={valueAverage} /></View><GridTable rows={[["가치", ...stats.values.map((metric) => metric.name)], ["만족도", ...stats.values.map((metric) => metric.mean.toFixed(2))], ["표준편차", ...stats.values.map((metric) => metric.sd.toFixed(2))]]} /><View style={{ marginTop: 15 }}><Band>4대 가치 만족도 종합 해석</Band><View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 12 }}><Text style={styles.body}>정성 분석 결과가 승인되면 가치 영역별 긍정·부정 의견, 대표 인용문, 개선 제언이 이 영역에 들어갑니다.</Text></View></View></>;
}

const NPS_SCALE = path.join(process.cwd(), "public", "images", "nps-scale.png");

function Nps({ stats }: { stats: CareclQuantStats }) {
  const nps = stats.nps;
  // 시장성 판단 문구 — 원본 42쪽 판단 로직만 재사용(회사명 비교 문구는 일반화 불가라 제외).
  const marketability = nps.score >= 0 ? "양호한 시장성" : "낮은 시장성";
  const urgency = nps.score >= 0 ? "우호적인 흐름을 유지할 필요가 있음" : "개선 전략의 수립이 시급하다고 사료됨";
  return <><View break /><SectionHeader numeral="VII" title="NPS 지수 및 종합 만족도" /><Subsection number={1} title="NPS 지수 및 종합 만족도" />
    <Band>NPS 지수 (Net Promoter Score : 순수 고객추천/구매 지수)</Band>
    <View style={{ borderWidth: 0.7, borderTopWidth: 0, borderColor: colors.border, padding: 12 }} wrap={false}>
      <Image src={NPS_SCALE} style={{ width: "88%", alignSelf: "center", objectFit: "contain" }} />
      <Text style={{ ...styles.body, fontSize: 9, marginTop: 10 }}>• 글로벌 자문 업체 Bain & Company가 실제 고객 충성도를 측정하기 위해 제시한 순수 고객추천/구매 지수 조사입니다.{"\n"}• 구매/추천 고객(PROMOTERS, 9~10점), 중립 고객(PASSIVES, 7~8점), 비구매/비추천 고객(DETRACTORS, 0~6점)으로 구분합니다.{"\n"}• 창업 초기 기업은 통상 NPS 지수가 0보다 크면 충성 고객을 확보해 시장성이 있는 제품으로 판단합니다.</Text>
    </View>
    <View style={{ marginTop: 12 }}><NpsSummaryTable nps={nps} /></View>
    <View style={{ marginTop: 14 }}><Text style={styles.body}>▶ 구매의향·추천의향을 NPS 지수로 환산했을 때 {nps.score}점으로 ‘{marketability}’ 수준으로 판단되어 {urgency}.{"\n"}▶ 비추천 고객 비율({nps.detractors}%)과 구매 고객 비율({nps.promoters}%)을 비교해 구매 전환 요소를 진단합니다.{"\n"}▶ 전체 기능 고도화 및 도출된 불편·개선 사항을 반영해 사용자 만족도를 높이는 방안이 필요합니다.</Text></View>
    <Text style={{ ...styles.body, fontSize: 8, color: colors.subtext, marginTop: 8 }}>* 추천 고객 9~10점, 중립 7~8점, 비추천 0~6점 기준. raw data의 NPS 응답을 규칙 기반으로 계산했으며 외부 AI 호출을 사용하지 않습니다.</Text>
    <View break /><Subsection number={2} title="종합 만족도" />
    <Question number={36} title="테크핏의 전반적인 만족도(종합 점수)는 몇 점입니까?"><ScoreChart metric={stats.overall} /></Question>
    {(() => {
      const n = Math.max(stats.respondentCount, 1);
      const band = (lo: number, hi: number) => stats.overall.distribution.filter((d) => Number(d.label) >= lo && Number(d.label) <= hi).reduce((a, d) => a + d.count, 0);
      const pct = (lo: number, hi: number) => Math.round((band(lo, hi) / n) * 100);
      return <>
        <GridTable rows={[["종합만족도 평가", "평균 만족도", "표준편차"], ["전체", stats.overall.mean.toFixed(2), stats.overall.sd.toFixed(2)]]} widths={[140, "30%", "30%"]} />
        <View style={{ marginTop: 12 }}><Text style={styles.body}>▶ 구간별 비율{"\n"}  · 0~6점 : {pct(0, 6)}%{"\n"}  · 7~8점 : {pct(7, 8)}%{"\n"}  · 9~10점 : {pct(9, 10)}%</Text></View>
        <View style={{ marginTop: 10 }}><Text style={styles.body}>▶ 전체 평균 만족도 점수는 {stats.overall.mean.toFixed(2)}점으로, 응답자 대부분이 중간 이상 수준의 평가를 보였습니다. 제품 개선을 통해 중립 고객을 긍정 고객으로 전환하면 만족도를 크게 개선할 수 있을 것으로 예상됩니다.</Text></View>
      </>;
    })()}</>;
}

function Conclusion({ stats }: { stats: CareclQuantStats }) {
  return <><View break /><SectionHeader numeral="VIII" title="종합 결과 및 제언" /><Subsection number={1} title="사용성테스트 결과 요약" /><GridTable rows={[["항목", "정량 결과", "정성 의견 / 제언"], ["기능별 고객 경험", `평균 ${ (stats.features.reduce((sum, metric) => sum + metric.mean, 0) / stats.features.length).toFixed(2)}점`, "정성 분석 결과 대기"], ["고객 여정", `최종 2주 만족도 ${stats.journey.at(-1)?.mean.toFixed(2)}점`, "정성 분석 결과 대기"], ["핵심구매요소", `${stats.coreFactors[0]?.name ?? "-"} ${stats.coreFactors[0]?.percent ?? 0}%`, "정성 분석 결과 대기"], ["4대 가치", `평균 ${(stats.values.reduce((sum, metric) => sum + metric.mean, 0) / stats.values.length).toFixed(2)}점`, "정성 분석 결과 대기"], ["NPS", String(stats.nps.score), "정성 분석 결과 대기"]]} widths={[110, 150, "45%"]} /><Subsection number={2} title="구매전환율 / 재구매율 개선 전략" /><View style={{ borderWidth: 0.7, borderColor: colors.border, padding: 14 }}><Text style={styles.body}>정성 분석을 실행하지 않은 상태이므로 제언 본문은 비워 둡니다. 분석 승인 후 고객여정, 핵심구매요소, 4대 가치, NPS 결과를 근거로 구매전환·재구매율 개선 제언을 자동 조립합니다.</Text></View></>;
}

export function CareclReportDocument({ stats }: { stats: CareclQuantStats }) {
  return <Document title="케어클_사용성테스트_정량검증"><Cover /><Page size="A4" style={styles.page} wrap><Footer /><Overview /><SurveyTable stats={stats} /></Page><Page size="A4" style={styles.page} wrap><Footer /><Demographics stats={stats} /><FeatureSection stats={stats} /><JourneySection stats={stats} /><CoreFactors stats={stats} /><Values stats={stats} /><Nps stats={stats} /><Conclusion stats={stats} /></Page></Document>;
}
