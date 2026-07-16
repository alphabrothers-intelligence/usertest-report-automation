// 리바랩스 골든 테스트셋(raw data)으로 validateInput + computeQuantStats 로직을 직접 검증하는 스크립트.
// 사용법: npm run check:golden
//
// 기대값 출처: 실제 리바랩스에 발행된 사용성테스트 결과보고서
// (data/[알파브라더스] 리바랩스_사용성테스트_결과보고서_0904_상연.pdf, 2025.09.05)를
// 2026-07-16에 페이지별로 직접 대조해 확정했다. 딱 하나(즐거움1 표준편차)는 raw data로
// 재계산한 결과 보고서 쪽 오타로 판명되어(옆 문항 실용성2의 SD와 값이 같음), 여기서는
// 보고서 숫자가 아니라 우리가 raw data로 독립 재검증한 값을 기대값으로 쓴다 — 이 스크립트는
// "보고서와 토씨 하나까지 일치"가 목적이 아니라 "우리 계산이 raw data 기준으로 정확한가"가
// 목적이다(정성적 내용은 사람이 다듬는 게 이 프로젝트의 설계 의도, CLAUDE.md 참고).
import { readFileSync } from "node:fs";
import { extractFeatureNames, validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats, type QuantStats } from "../lib/quant/compute";

const path = new URL(
  "../data/[리바랩스]사용성테스트 raw data.xlsx",
  import.meta.url,
);
const buffer = readFileSync(path);
const arrayBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength,
) as ArrayBuffer;

const parsed = parseWallaWorkbook(arrayBuffer);
const validation = validateWallaHeaderRow(parsed.headerRow);

console.log("=== validateInput ===");
console.log("valid:", validation.valid);
console.log("columnCount:", validation.columnCount);
console.log("respondentCount:", parsed.dataRows.length);
console.log("errors:", JSON.stringify(validation.errors, null, 2));
console.log("featureNames:", extractFeatureNames(parsed.headerRow));

if (!validation.valid) {
  process.exitCode = 1;
} else {
  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const stats = computeQuantStats(records);
  console.log("\n=== computeQuantStats ===");
  console.log(JSON.stringify(stats, null, 2));

  let pass = 0;
  let fail = 0;
  function check(label: string, actual: number, expected: number) {
    const ok = actual === expected;
    if (ok) pass += 1;
    else fail += 1;
    console.log(`${label}: ${actual} (기대값 ${expected}) → ${ok ? "PASS" : "FAIL"}`);
  }

  console.log("\n=== 골든 체크: Ⅲ 기능별 만족도 ===");
  const expectedFeatureSatisfaction: Record<string, number> = {
    "펫과의 산책": 6.35,
    "펫 성장 시스템": 6.81,
    "펫 꾸미기": 7.2,
    "실시간 거점형": 6.35,
    "펫 교배": 5.85,
    "펫 레이싱": 6.04,
  };
  for (const f of stats.featureSatisfaction) {
    check(f.name, f.mean, expectedFeatureSatisfaction[f.name]);
  }

  console.log("\n=== 골든 체크: Ⅳ 핵심구매요소 상대중요도 (PRD 6.8절 raw data 역산값) ===");
  const expectedImportance: Record<string, number> = {
    "펫과의 산책": 2.96,
    "펫 성장 시스템": 1.38,
    "실시간 거점형": 0.26,
    "펫 꾸미기": 0.23,
    "펫 레이싱": -2.25,
    "펫 교배": -2.58,
  };
  for (const { name, score } of stats.relativeImportance) {
    check(`${name} 상대중요도`, score, expectedImportance[name]);
  }

  console.log("\n=== 골든 체크: Ⅳ 핵심구매요소 분포(%) ===");
  const expectedKeyFactorPct: Record<string, number> = {
    "성취 및 보상 요소 (걸음 수 보상, 미션 보상 등)": 34,
    "시각적 디자인 (UI/그래픽, 캐릭터, 화면 구성 등)": 25,
    "앱 안정성 (버그, 오류, 실행 속도 등)": 18,
    "사용 편의성 (조작 방식, UI 흐름 등)": 12,
    "개인화 요소 (내 펫 꾸미기, 공간 배경 변경 등)": 10,
    "무료/유료 콘텐츠 (결제 유도, 무료 혜택 등)": 1,
  };
  for (const { label, percentage } of stats.keyFactorDistribution) {
    check(label, percentage, expectedKeyFactorPct[label]);
  }

  console.log("\n=== 골든 체크: Ⅴ 4대가치 만족도 (평균/SD) ===");
  const fourValueChecks: [string, keyof QuantStats["fourValues"], number, number][] = [
    ["기능적 가치", "functional", 6.7, 2.39],
    ["심미적 가치", "aesthetic", 6.52, 2.62],
    ["경제적 가치", "economic", 5.4, 2.71],
    ["사회·공공적 가치", "social", 5.97, 2.91],
  ];
  for (const [label, key, mean, sd] of fourValueChecks) {
    check(`${label} 평균`, stats.fourValues[key].mean, mean);
    check(`${label} SD`, stats.fourValues[key].sd, sd);
  }

  console.log("\n=== 골든 체크: Ⅵ UX품질 (평균/SD) ===");
  const expectedUsability = [4.88, 5.53, 6.16, 5.87];
  const expectedUsabilitySd = [2.84, 3.12, 2.63, 2.98];
  const expectedFun = [5.61, 5.25, 5.5, 5.24];
  // 즐거움1 SD: 보고서는 3.12로 적혀있으나 raw data(40번 컬럼) 직접 재계산 결과 2.96이 맞음
  // (실용성2의 SD 3.12가 잘못 복사된 것으로 추정, 2026-07-16 확인) — 보고서 숫자가 아니라
  // 우리가 검증한 값을 기대값으로 둔다.
  const expectedFunSd = [2.96, 2.98, 3.29, 3.06];
  stats.uxQuality.usability.forEach((u, i) => {
    check(u.name, u.mean, expectedUsability[i]);
    check(`${u.name} SD`, u.sd, expectedUsabilitySd[i]);
  });
  stats.uxQuality.fun.forEach((f, i) => {
    check(f.name, f.mean, expectedFun[i]);
    check(`${f.name} SD`, f.sd, expectedFunSd[i]);
  });

  console.log("\n=== 골든 체크: Ⅶ 교차분석 (연령대별) ===");
  const expectedByAge: Record<string, Record<string, number>> = {
    "10대": { "펫과의 산책": 7.82, "펫 성장 시스템": 7.53, "펫 꾸미기": 8.29, "실시간 거점형": 7.18, "펫 교배": 7, "펫 레이싱": 7.41 },
    "20대": { "펫과의 산책": 6.23, "펫 성장 시스템": 7.46, "펫 꾸미기": 7.29, "실시간 거점형": 6.71, "펫 교배": 5.97, "펫 레이싱": 6.29 },
    "30대": { "펫과의 산책": 5.76, "펫 성장 시스템": 5.95, "펫 꾸미기": 7.05, "실시간 거점형": 5.68, "펫 교배": 5.18, "펫 레이싱": 5.34 },
    "40대 이상": { "펫과의 산책": 6.5, "펫 성장 시스템": 6.6, "펫 꾸미기": 5.6, "실시간 거점형": 6.2, "펫 교배": 6, "펫 레이싱": 5.5 },
  };
  const expectedFourValuesByAge: Record<string, [number, number, number, number]> = {
    "10대": [7.76, 7.65, 6.53, 7.24],
    "20대": [7.26, 6.71, 6, 6.23],
    "30대": [6.03, 6, 4.34, 5.26],
    "40대 이상": [5.5, 5.9, 5.4, 5.6],
  };
  for (const g of stats.crossAnalysis.byAgeGroup) {
    for (const f of g.featureSatisfaction) {
      check(`[${g.group}] ${f.name}`, f.mean, expectedByAge[g.group][f.name]);
    }
    const [functional, aesthetic, economic, social] = expectedFourValuesByAge[g.group];
    check(`[${g.group}] 기능적 가치`, g.fourValues.functional, functional);
    check(`[${g.group}] 심미적 가치`, g.fourValues.aesthetic, aesthetic);
    check(`[${g.group}] 경제적 가치`, g.fourValues.economic, economic);
    check(`[${g.group}] 사회·공공적 가치`, g.fourValues.social, social);
  }

  console.log("\n=== 골든 체크: Ⅷ 종합만족도 · NPS ===");
  check("전반적 만족도 평균", stats.overallSatisfaction.mean, 5.79);
  check("전반적 만족도 SD", stats.overallSatisfaction.sd, 2.57);
  check("NPS rawMean", stats.nps.rawMean, 5.13);
  check("NPS score", stats.nps.npsScore, -41);
  check("NPS promoterPct", stats.nps.promoterPct, 12);
  check("NPS passivePct", stats.nps.passivePct, 35);
  check("NPS detractorPct", stats.nps.detractorPct, 53);

  console.log(`\n=== 요약: ${pass}/${pass + fail} PASS ===`);
  if (fail > 0) process.exitCode = 1;
}
