// 역할 기반 정량 계산(`lib/agent/quant.ts`, 4단계)이 옛 고정 경로를 정확히 대체하는지 본다.
// `npm run check:role-quant`. **API 키가 필요 없고 과금도 없다** — 역할 판정은 LLM을 부르지 않고
// `scripts/roleAnswerKey.ts`의 정답 라벨을 그대로 쓴다. 판정 정확도는 `check:role-classify`가
// 따로 재고 있으므로, 여기서는 **판정이 맞다고 치고 계산이 맞는지만** 본다(층을 나눠야 틀렸을 때
// 어디가 원인인지 하나로 좁혀진다).
//
// 보는 것은 둘이다.
//  ① **안전망** — 리바랩스를 새 경로로 통과시켰을 때 `check:golden`의 기대값(실제 발행 보고서
//     대조로 확정한 숫자)이 그대로 나오는가. 하나만 어긋나도 새 경로가 옛 경로를 대체하지
//     못한다는 뜻이다(가이드 "4·5·6단계 > 안전망").
//  ② **범용성** — 나머지 3종(케어클·이젠오토·정리습관)이 **에러 없이, 빈 그릇이 아닌 값으로**
//     계산되는가. 옛 경로는 이 셋에서 아예 못 돌았다(컬럼 위치가 리바랩스 고정).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns, type ColumnProfile } from "../lib/agent/profile";
import type { RoleClassification } from "../lib/agent/classify";
import { computeRoleQuantStats, type RoleQuantStats } from "../lib/agent/quant";
import { toQuantStats } from "../lib/agent/toQuantStats";
import { defaultRole, loadStageAnswerKey, type StageCode } from "./stageAnswerKey";

const DATA = path.join(process.cwd(), "data");

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`  FAIL ${label} — 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
}

/**
 * 시트의 단계코드를 2단계 출력 형태로 옮긴다. **모델을 부르지 않는다.**
 *
 * 모델이 채우던 `itemName`은 여기서 비워둔다 — 계산 쪽이 헤더(따옴표 안 이름·계열 접두)에서
 * 스스로 뽑을 수 있어야 이 검사가 성립하기 때문이다. `groupKey`·`scaleMax`는 원래부터
 * 프로파일러가 정하는 코드 판정값이라 그대로 가져온다.
 */
function classificationFromSheet(
  profiles: ColumnProfile[],
  stages: Record<number, StageCode>,
): RoleClassification {
  return {
    questions: profiles
      .filter((profile) => stages[profile.index] !== undefined)
      .map((profile) => ({
        columnIndex: profile.index,
        role: defaultRole(stages[profile.index], profile),
        header: profile.header,
        type: profile.type,
        confidence: 1,
        ...(profile.scaleMax !== undefined ? { scaleMax: profile.scaleMax } : {}),
        ...(profile.groupPrefix ? { groupKey: profile.groupPrefix } : {}),
      })),
    unassigned: [],
    rejected: null,
  };
}

const DATASETS = loadStageAnswerKey();

function statsFor(dataset: (typeof DATASETS)[number]): RoleQuantStats {
  const buffer = readFileSync(path.join(DATA, dataset.file));
  const { headerRow, dataRows } = parseWallaWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const profiles = profileColumns(headerRow, dataRows);
  return computeRoleQuantStats(classificationFromSheet(profiles, dataset.stages), profiles, dataRows);
}

const datasetOf = (name: string) => DATASETS.find((d) => d.name === name)!;

// ── ① 안전망: 리바랩스 = check:golden 기대값 ────────────────────────────────────
// 아래 숫자는 `scripts/check-golden-sample.ts`와 **같은 출처**(실제 발행 보고서 대조 + raw data
// 재검증)다. 옛 경로의 결과를 베낀 게 아니라 같은 정답을 각자 맞히는지 보는 것이다.
console.log("=== ① 안전망 — 리바랩스가 골든 기대값과 같은가 ===");
const riva = statsFor(datasetOf("리바랩스"));

check("응답자 수", riva.respondentCount, 100);
check("3장 성격", riva.featureRole, "feature");

const expectedAgeBrackets: Record<string, number> = { "10대": 17, "20대": 35, "30대": 38, "40대 이상": 10 };
for (const bracket of riva.age?.brackets ?? []) {
  check(`나이대 ${bracket.label}`, bracket.percentage, expectedAgeBrackets[bracket.label]);
}

const expectedFeature: Record<string, number> = {
  "펫과의 산책": 6.35,
  "펫 성장 시스템": 6.81,
  "펫 꾸미기": 7.2,
  "실시간 위치 기반 거점형 콘텐츠": 6.35,
  "펫 교배": 5.85,
  "펫 레이싱": 6.04,
};
for (const feature of riva.features) check(`기능 ${feature.name}`, feature.mean, expectedFeature[feature.name]);

const expectedImportance: Record<string, number> = {
  "펫과의 산책": 2.96,
  "펫 성장 시스템": 1.38,
  "실시간 위치 기반 거점형 콘텐츠": 0.26,
  "펫 꾸미기": 0.23,
  "펫 레이싱": -2.25,
  "펫 교배": -2.58,
};
for (const item of riva.purchaseFactor.relativeImportance) {
  check(`상대중요도 ${item.name}`, item.score, expectedImportance[item.name]);
}

const expectedKeyFactor: Record<string, number> = {
  "성취 및 보상 요소 (걸음 수 보상, 미션 보상 등)": 34,
  "시각적 디자인 (UI/그래픽, 캐릭터, 화면 구성 등)": 25,
  "앱 안정성 (버그, 오류, 실행 속도 등)": 18,
  "사용 편의성 (조작 방식, UI 흐름 등)": 12,
  "개인화 요소 (내 펫 꾸미기, 공간 배경 변경 등)": 10,
  "무료/유료 콘텐츠 (결제 유도, 무료 혜택 등)": 1,
};
const keyFactorChoice = riva.choices.find((choice) => choice.role === "purchase_factor");
check("핵심요인 선택형 문항 존재", !!keyFactorChoice, true);
for (const item of keyFactorChoice?.distribution ?? []) {
  check(`핵심요인 ${item.label}`, item.percentage, expectedKeyFactor[item.label]);
}

// 가치 축은 이름이 아니라 **컬럼 순서**로 확인한다 — 이 경로는 축 이름을 고정하지 않기 때문이다.
const expectedValues: [string, number, number][] = [
  ["기능적", 6.7, 2.39],
  ["심미적", 6.52, 2.62],
  ["경제적", 5.4, 2.71],
  ["사회·공공적", 5.97, 2.91],
];
check("가치 축 개수", riva.values.length, expectedValues.length);
riva.values.forEach((value, i) => {
  check(`${expectedValues[i][0]} 가치 평균`, value.mean, expectedValues[i][1]);
  check(`${expectedValues[i][0]} 가치 SD`, value.sd, expectedValues[i][2]);
});

const expectedUx: Record<string, [number[], number[]]> = {
  // [평균, 표준편차] — 즐거움1 SD는 보고서 오타(3.12)가 아니라 raw data 재계산값(2.96)이다.
  실용성: [[4.88, 5.53, 6.16, 5.87], [2.84, 3.12, 2.63, 2.98]],
  즐거움: [[5.61, 5.25, 5.5, 5.24], [2.96, 2.98, 3.29, 3.06]],
};
check("UX 계열 개수", riva.uxQuality.length, 2);
for (const group of riva.uxQuality) {
  const [means, sds] = expectedUx[group.groupKey];
  group.items.forEach((item, i) => {
    check(`${group.groupKey}${i + 1} 평균`, item.mean, means[i]);
    check(`${group.groupKey}${i + 1} SD`, item.sd, sds[i]);
  });
}

console.log("  Ⅶ 교차분석(연령대별)");
const expectedByAge: Record<string, Record<string, number>> = {
  "10대": { "펫과의 산책": 7.82, "펫 성장 시스템": 7.53, "펫 꾸미기": 8.29, "실시간 위치 기반 거점형 콘텐츠": 7.18, "펫 교배": 7, "펫 레이싱": 7.41 },
  "20대": { "펫과의 산책": 6.23, "펫 성장 시스템": 7.46, "펫 꾸미기": 7.29, "실시간 위치 기반 거점형 콘텐츠": 6.71, "펫 교배": 5.97, "펫 레이싱": 6.29 },
  "30대": { "펫과의 산책": 5.76, "펫 성장 시스템": 5.95, "펫 꾸미기": 7.05, "실시간 위치 기반 거점형 콘텐츠": 5.68, "펫 교배": 5.18, "펫 레이싱": 5.34 },
  "40대 이상": { "펫과의 산책": 6.5, "펫 성장 시스템": 6.6, "펫 꾸미기": 5.6, "실시간 위치 기반 거점형 콘텐츠": 6.2, "펫 교배": 6, "펫 레이싱": 5.5 },
};
const expectedValuesByAge: Record<string, number[]> = {
  "10대": [7.76, 7.65, 6.53, 7.24],
  "20대": [7.26, 6.71, 6, 6.23],
  "30대": [6.03, 6, 4.34, 5.26],
  "40대 이상": [5.5, 5.9, 5.4, 5.6],
};
const ageAxis = riva.crossAnalysis.find((axis) => axis.columnIndex === riva.age?.columnIndex);
check("연령 축 존재", !!ageAxis, true);
for (const group of ageAxis?.groups ?? []) {
  for (const feature of group.features) {
    check(`[${group.group}] ${feature.name}`, feature.mean, expectedByAge[group.group][feature.name]);
  }
  group.values.forEach((value, i) => check(`[${group.group}] 가치${i + 1}`, value.mean, expectedValuesByAge[group.group][i]));
}

check("전반적 만족도 평균", riva.overall?.mean, 5.79);
check("전반적 만족도 SD", riva.overall?.sd, 2.57);
check("NPS rawMean", riva.nps?.rawMean, 5.13);
check("NPS score", riva.nps?.npsScore, -41);
check("NPS promoterPct", riva.nps?.promoterPct, 12);
check("NPS passivePct", riva.nps?.passivePct, 35);
check("NPS detractorPct", riva.nps?.detractorPct, 53);

// ── ② 범용성: 나머지 3종이 빈 그릇이 아닌가 ──────────────────────────────────────
// 값 하나하나의 정답은 없다(원본 보고서 대조는 별도 작업). 여기서 막는 것은 **조용한 실패** —
// 에러 없이 전부 0·빈 배열로 나와서 "됐다"고 착각하는 경우다.
console.log("\n=== ② 범용성 — 나머지 3종이 값으로 채워지는가 ===");
for (const dataset of DATASETS.filter((d) => d.name !== "리바랩스")) {
  const stats = statsFor(dataset);
  const scales = [
    ...stats.features,
    ...stats.journey,
    ...stats.values,
    ...stats.uxQuality.flatMap((group) => group.items),
    ...stats.purchaseFactor.satisfaction,
  ];
  console.log(
    `  ${dataset.name} — 응답자 ${stats.respondentCount}명 · 3장 ${stats.featureRole ?? "없음"}(${stats.features.length}) ·` +
      ` 여정 ${stats.journey.length} · 가치 ${stats.values.length} · UX계열 ${stats.uxQuality.length} ·` +
      ` 순위항목 ${stats.purchaseFactor.relativeImportance.length} · 선택형 ${stats.choices.length} ·` +
      ` 교차축 ${stats.crossAnalysis.length}`,
  );
  check(`${dataset.name} 응답자 수 > 0`, stats.respondentCount > 0, true);
  check(`${dataset.name} 척도 문항이 계산됨`, scales.length > 0, true);
  check(`${dataset.name} 모든 척도에 응답이 있음`, scales.every((s) => s.n > 0), true);
  check(`${dataset.name} 종합 만족도 있음`, (stats.overall?.n ?? 0) > 0, true);
  check(`${dataset.name} NPS 있음`, (stats.nps?.n ?? 0) > 0, true);
}

// ── ③ 어댑터: 렌더러가 읽는 모양으로 옮겨도 값이 그대로인가 ─────────────────────────
// 렌더러 15개 파일이 `QuantStats`의 고정 칸을 읽으므로, 새 경로는 `toQuantStats()`로 모양을
// 맞춰 넘긴다. 여기서 막는 것은 **옮기다 흘리는 것** — 계산은 맞는데 어댑터가 엉뚱한 칸에
// 넣거나 빠뜨리면 화면에서만 틀린다(계산 검사로는 안 잡힌다).
console.log("\n=== ③ 어댑터 — RoleQuantStats → QuantStats 옮기기 ===");
const adapted = toQuantStats(riva);

check("어댑터 응답자 수", adapted.respondentCount, riva.respondentCount);
check("어댑터 기능 개수", adapted.featureSatisfaction.length, riva.features.length);
for (const feature of adapted.featureSatisfaction) {
  check(`어댑터 기능 ${feature.name}`, feature.mean, expectedFeature[feature.name]);
}
check("어댑터 나이 평균", adapted.demographics.age.mean, riva.age?.mean);
check("어댑터 연령대 분포", adapted.demographics.ageDistribution, riva.age?.brackets);
check("어댑터 성별 분포가 비어있지 않음", adapted.demographics.gender.length > 0, true);
check("어댑터 상대중요도", adapted.relativeImportance, riva.purchaseFactor.relativeImportance);
check("어댑터 핵심요인 분포", adapted.keyFactorDistribution, keyFactorChoice?.distribution);
check("어댑터 종합 만족도", adapted.overallSatisfaction.mean, 5.79);
check("어댑터 NPS", adapted.nps.npsScore, -41);

// 리바랩스는 축 4개·계열 2개라 고정 칸에 그대로 들어간다(옛 경로 호환 확인).
check("어댑터 기능적 가치", adapted.fourValues.functional.mean, 6.7);
check("어댑터 사회·공공적 가치", adapted.fourValues.social.mean, 5.97);
check("어댑터 실용성 개수", adapted.uxQuality.usability.length, 4);
check("어댑터 즐거움 개수", adapted.uxQuality.fun.length, 4);

// **핵심** — 고정 칸에 안 들어가는 값은 generic에 배열 그대로 실려야 한다.
check("generic 가치 축", adapted.generic.valueAxes.length, riva.values.length);
check("generic UX 계열", adapted.generic.uxGroups.length, riva.uxQuality.length);
check("generic 선택형 문항", adapted.generic.choices.length, riva.choices.length);
check("generic 3장 성격", adapted.generic.featureRole, "feature");

// 축이 4개가 아닌 데이터셋에서 **고정 칸은 못 담고 generic은 담는다**는 것이 어댑터의 존재 이유다.
for (const dataset of DATASETS.filter((d) => d.name !== "리바랩스")) {
  const stats = statsFor(dataset);
  const out = toQuantStats(stats);
  check(`${dataset.name} generic 가치 축 = 원본 개수`, out.generic.valueAxes.length, stats.values.length);
  check(`${dataset.name} generic UX 계열 = 원본 개수`, out.generic.uxGroups.length, stats.uxQuality.length);
  check(`${dataset.name} generic 선택형 = 원본 개수`, out.generic.choices.length, stats.choices.length);
  if (stats.values.length > 4) {
    check(`${dataset.name} 고정 칸은 4개까지만 담김(그래서 generic이 필요)`, out.generic.valueAxes.length > 4, true);
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);