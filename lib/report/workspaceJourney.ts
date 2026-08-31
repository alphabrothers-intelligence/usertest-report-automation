import type { QuantStats } from "@/lib/quant/compute";
import { genericOf } from "@/lib/report/genericStats";
import {
  headingBlock,
  journeyLineBlock,
  tableBlock,
  waterfallBlock,
  type ReportBlock,
} from "@/lib/report/sections";

/**
 * 섹션 Ⅳ: 고객 여정 기반 경험 평가 (레이아웃 L13 · L13a, 케어클 원본 34쪽).
 *
 * **시점 문항이 3개 이상일 때만 생기는 조건부 장이다**(`sectionPlan.ts`). 리바랩스는 시점
 * 문항이 0개라 이 장이 아예 없고, 케어클은 5개라 생긴다 — 즉 이 빌더는 리바랩스 결과를
 * 바꾸지 않는다.
 *
 * **시점 순서는 정렬하지 않는다.** 첫인상 → 개봉 → 1주 후처럼 raw data 컬럼 순서 자체가
 * 시간 순서다. 값으로 정렬하면 여정이 뒤섞인다.
 */
export function buildJourneySection(stats: QuantStats): ReportBlock[] {
  const journey = genericOf(stats).journey;
  if (journey.length === 0) return [];

  const points = journey.map((item) => ({ label: item.name, value: item.mean }));
  const scaleMax = journey[0]?.scaleMax ?? 10;

  return [
    headingBlock({ id: "journey-result-heading", variant: "numbered", number: "1", text: "고객 여정 기반 경험 평가 결과" }),
    journeyLineBlock({ id: "journey-line", title: "시점별 만족도 추이", points, scaleMax }),
    // 증감은 위 꺾은선의 시점 목록에서 계산된다(waterfallBlock 안에서) — 두 그래프가 어긋날 수 없다.
    waterfallBlock({ id: "journey-waterfall", title: "구간별 만족도 변화", points }),
    tableBlock({
      id: "journey-table",
      title: "시점별 만족도",
      headers: ["시점", "평균", "표준편차", "증감"],
      rows: journey.map((item, index) => {
        const previous = journey[index - 1];
        // 원본은 첫 시점과 "변화 없음" 구간을 똑같이 `(-)`로 적는다(케어클 34쪽 실측).
        const delta = previous ? Math.round((item.mean - previous.mean) * 100) / 100 : null;
        return [item.name, item.mean, item.sd, delta === null || delta === 0 ? "(-)" : delta > 0 ? `+${delta}` : `${delta}`];
      }),
    }),
  ];
}