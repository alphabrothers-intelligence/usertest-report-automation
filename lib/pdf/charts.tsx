// PRD 8장: "그래프는 react-pdf가 직접 그리지 못하므로 PNG로 먼저 생성" 이라고 가정했지만,
// 실측 결과 @react-pdf/renderer는 View의 flexbox 레이아웃만으로 막대그래프를 충분히 그릴 수
// 있다(외부 캔버스 라이브러리·PNG 래스터화 불필요 — Vercel 서버리스에 native 바이너리 의존성이
// 없어 오히려 더 안전하다). CLAUDE.md 참고.
import { View, Text } from "@react-pdf/renderer";
import { colors } from "./theme";

const TRACK_HEIGHT = 8;

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
