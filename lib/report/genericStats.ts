/**
 * 렌더러가 읽는 **배열 그릇** 한 갈래.
 *
 * Ⅱ·Ⅴ·Ⅵ장은 지금까지 `QuantStats`의 고정 칸(걷기 앱 문항 3개 · 가치 축 4개 · UX 계열 2개)을
 * 이름까지 박아 읽었다. 가치 축이 3개인 raw data는 담을 칸이 없어 그 장이 통째로 어긋난다.
 *
 * **왜 함수 하나인가**: 렌더러마다 "새 경로면 배열, 옛 경로면 고정 칸"으로 갈래를 두면 같은
 * 화면을 두 벌 유지하게 된다(PRD 2.2.2절이 기각한 "고정·범용 영구 병행"과 같은 함정). 대신
 * 옛 경로의 고정 칸을 **여기서 한 번만** 배열로 되돌려, 렌더러는 항상 배열만 본다.
 *
 * ponytail: 옛 경로(`computeQuantStats`)가 지워지면 이 폴백도 같이 지운다 — 그때는
 * `toQuantStats()`가 항상 `generic`을 채워 보낸다.
 */
import type { QuantStats } from "@/lib/quant/compute";
import type { GenericStats } from "@/lib/agent/toQuantStats";

/** 옛 경로의 4대 가치 칸 순서 ↔ 이름. 리바랩스 보고서 문구 그대로다. */
const LEGACY_VALUE_LABELS = ["기능적 가치", "심미적 가치", "경제적 가치", "사회·공공적 가치"] as const;

export function genericOf(stats: QuantStats & Partial<{ generic: GenericStats }>): GenericStats {
  if (stats.generic) return stats.generic;

  // ── 옛 경로 폴백 — 고정 칸을 배열로 되돌린다 ──────────────────────────────────
  // 문항 문구는 **raw data 헤더에서 온 `surveyQuestions`를 먼저 쓴다**(전체 문항을 넣은 raw
  // data는 그 문장이 그대로 나와야 한다 — PRD 5.1절). 없을 때만 아래 라벨로 떨어진다.
  const demographics = stats.demographics;
  const askedAt = (index: number, fallback: string) => stats.surveyQuestions[index]?.question || fallback;
  const legacyChoices: GenericStats["choices"] = [
    { role: "demographic" as const, question: askedAt(1, "성별"), distribution: demographics.gender },
    { role: "demographic" as const, question: askedAt(2, "운영체제"), distribution: demographics.os },
    { role: "context" as const, question: askedAt(3, "하루 평균 걷는 시간"), distribution: demographics.avgWalkTime },
    { role: "context" as const, question: askedAt(4, "일주일 기준 산책 빈도"), distribution: demographics.walkFrequencyPerWeek },
  ].filter((choice) => choice.distribution.length > 0);

  // n=0인 축은 애초에 그 문항이 없었다는 뜻이다 — 빈 막대를 그리지 않는다.
  const valueAxes = LEGACY_VALUE_LABELS.map((label, i) => {
    const value = [
      stats.fourValues.functional,
      stats.fourValues.aesthetic,
      stats.fourValues.economic,
      stats.fourValues.social,
    ][i];
    return { name: label, mean: value.mean, sd: value.sd, n: value.n };
  }).filter((axis) => axis.n > 0);

  const uxGroups = [
    { groupKey: "실용성", items: stats.uxQuality.usability },
    { groupKey: "즐거움", items: stats.uxQuality.fun },
  ]
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      groupKey: group.groupKey,
      items: group.items.map((item) => ({
        name: item.name,
        mean: item.mean,
        sd: item.sd,
        n: item.n,
        distribution: item.scoreDistribution,
      })),
    }));

  return {
    choices: legacyChoices,
    featureRole: stats.featureSatisfaction.length > 0 ? "feature" : null,
    valueAxes,
    uxGroups,
    journey: [],
    purchaseFactorSatisfaction: [],
  };
}

// "N대 가치"를 세어서 만드는 헬퍼가 여기 있었는데 지웠다 — **"4대 가치"는 조사 방법론의
// 이름이지 데이터에서 세는 값이 아니다**(담당자 확인 2026-08-28). 제목은 `표준목차` 시트의
// 리터럴을 쓴다. 이 파일이 데이터에서 만드는 것은 **축 이름**뿐이다.