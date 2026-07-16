// PRD 9.2절: "원문 대조 가능한 문장 표본에 대해, 실제 보고서 배치 극성과 생성 결과 극성이
// 일치하는 비율"을 실측한다. 아래 ground truth는 실제 리바랩스 발행 보고서(2025.09.05,
// data/[알파브라더스] 리바랩스_사용성테스트_결과보고서_0904_상연.pdf)의 각 문항 긍정/부정/중립
// 대표 인용문을 그대로 옮긴 것이다(2026-07-16 수집). 문항별 점수는 극성에 영향을 주지 않도록
// 임의의 중립값(5)으로 고정한다 — 6.2절 프롬프트가 "텍스트가 명확하면 점수와 무관하게 텍스트
// 기준으로 판정"하도록 지시하므로, 점수를 실제 응답자 점수와 맞출 필요가 없다.
// 사용법: npm run check:qualitative-fidelity (ANTHROPIC_API_KEY 필요, 실제 과금 발생 — 약 6회 호출)
import { runStage1 } from "../lib/pipeline/stage1";

interface GroundTruthItem {
  questionLabel: string;
  quote: string;
  expectedPolarity: "positive" | "negative" | "neutral";
}

const groundTruth: GroundTruthItem[] = [
  // 펫과의 산책 (Q6, 보고서 8~10p) — 긍정 26.6% · 부정 70.4% · 중립 3.0%
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "뭔가 보상이 있다는 점에서 걷는 것에 동기 부여가 되어 좋았다.", expectedPolarity: "positive" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "평소에 걷기에 흥미가 없었는데 이런 앱을 알고나서 더 자주 걷는거같다", expectedPolarity: "positive" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "gps기능이 잘 작동해서 현재 위치가 정확하게 잡힌다", expectedPolarity: "positive" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "gps가 부정확해서 걸은 길이나 걸음수가 제대로 체크 되지 않아요.", expectedPolarity: "negative" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "경로가 지도상 도로를 따라 찍히지 않고 건물을 뚫고 찍히거나 가끔 아예 다른 길로 표시되어 아쉬웠다.", expectedPolarity: "negative" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "실제로 하루 만보 이상 걸었을때도 500보 정도로 카운팅 되어 있었음", expectedPolarity: "negative" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "제한 속도가 어느정도인진 모르겠으나, 타겜에 비해 좀 느슨한 편인 거 같다.", expectedPolarity: "neutral" },
  { questionLabel: "'펫과의 산책' 기능 만족도", quote: "버스나 지하철을 타고 가면서도 보상 획득이 가능합니다.", expectedPolarity: "neutral" },

  // 펫 성장 시스템 (Q7, 11~13p) — 긍정 42.4% · 부정 53.4% · 중립 4.2%
  { questionLabel: "'펫 성장 시스템' 기능 만족도", quote: "특히 알에서 부화하고 레벨이 올라가는 과정을 보는 재미가 있어 몰입도가 높았습니다.", expectedPolarity: "positive" },
  { questionLabel: "'펫 성장 시스템' 기능 만족도", quote: "다마고치 키우는거 처럼 펫을 관리해주고 성장시키는 재미가 있어서 좋았다.", expectedPolarity: "positive" },
  { questionLabel: "'펫 성장 시스템' 기능 만족도", quote: "펫이 성장하거나 부화하는 과정에서 경험치가 어떤 방식으로 올라가는지 구체적인 설명이 부족해 혼란스러웠습니다.", expectedPolarity: "negative" },
  { questionLabel: "'펫 성장 시스템' 기능 만족도", quote: "알부화가 느리고 레벨업이 너무 느려서 흥미를 못느끼겠습니다", expectedPolarity: "negative" },

  // 펫 꾸미기 (Q8, 14~16p) — 긍정 33.3% · 부정 41.2% · 중립 25.4%
  { questionLabel: "'펫 꾸미기' 기능 만족도", quote: "여러 꾸미기 아이템이 있고 개성을 살릴 수 있어서 좋다고 생각한다.", expectedPolarity: "positive" },
  { questionLabel: "'펫 꾸미기' 기능 만족도", quote: "한번 구매하면 모든 펫이 쓸수 있는게 아닌, 한 마리만 쓸 수 있어서 여러 옷을 구매해야한다.", expectedPolarity: "negative" },
  { questionLabel: "'펫 꾸미기' 기능 만족도", quote: "상자, 퀘스트에서 벌리는 골드는 100에서 500 골드 정도임에도 불구하고 가장 싼 옷의 가격이 5천골드, 대부분의 옷이 5만 골드인 점은 조금 아쉽습니다.", expectedPolarity: "negative" },

  // 실시간 거점형 (Q9, 17~18p) — 긍정 26.0% · 부정 54.5% · 중립 19.5%
  { questionLabel: "'실시간 거점형' 기능 만족도", quote: "동네를 돌아다니며 거점을 획득하는것은 걷기를 의도하고 몬가 개임을 하는것 같아 흥미롭다.", expectedPolarity: "positive" },
  { questionLabel: "'실시간 거점형' 기능 만족도", quote: "거점을 점령 함으로써 얻을 수 있는 메리트가 생각보다 좋지 않습니다.", expectedPolarity: "negative" },
  { questionLabel: "'실시간 거점형' 기능 만족도", quote: "영역을 차지했을 때의 이득이 와닿지 않는다.", expectedPolarity: "negative" },

  // 펫 교배 (Q10, 21~23p) — 긍정 25.2% · 부정 64.5% · 중립 10.3%
  { questionLabel: "'펫 교배' 기능 만족도", quote: "가장 흥미로운 컨텐츠이다. 일정 걸음 수를 통해 조건을 충족시키는 것과, 부모를 통해 랜덤하게 외형과 스킬이 유전된다는 점에서 흥미를 유발한다", expectedPolarity: "positive" },
  { questionLabel: "'펫 교배' 기능 만족도", quote: "교배 시스템 진행이 안됩니다. 펫을 넣으면 갑자기 화면이 멈춘 것처럼 되고, +버튼을 다시 눌러도 먹통입니다", expectedPolarity: "negative" },

  // 펫 레이싱 (Q11, 24~26p) — 긍정 28.5% · 부정 68.0% · 중립 3.5%
  { questionLabel: "'펫 레이싱' 기능 만족도", quote: "레이스 종류 중에서 가장 재밌었던 레이스 입니다.", expectedPolarity: "positive" },
  { questionLabel: "'펫 레이싱' 기능 만족도", quote: "말 그대로 디펜스 느낌이라 뚫리지 않게 계속 생각해서 소환하고 스킬을 쓰는 재미가 있었다.", expectedPolarity: "positive" },
  { questionLabel: "'펫 레이싱' 기능 만족도", quote: "일반 레이스를 플레이 해야하는 이유를 못 찾겠습니다", expectedPolarity: "negative" },
  { questionLabel: "'펫 레이싱' 기능 만족도", quote: "이건 진짜 필요가 없는 컨텐츠라고 생각합니다.", expectedPolarity: "negative" },
];

function groupByQuestion(items: GroundTruthItem[]): Map<string, GroundTruthItem[]> {
  const map = new Map<string, GroundTruthItem[]>();
  for (const item of items) {
    const arr = map.get(item.questionLabel) ?? [];
    arr.push(item);
    map.set(item.questionLabel, arr);
  }
  return map;
}

async function main() {
  const grouped = groupByQuestion(groundTruth);
  const rows: (GroundTruthItem & { actual: string | null })[] = [];

  for (const [label, items] of grouped) {
    const stage1 = await runStage1({
      questionLabel: label,
      inputs: items.map((item, i) => ({ respondent_id: i + 1, score: 5, reason: item.quote })),
    });

    items.forEach((item, i) => {
      const respondent = stage1.results.find((r) => r.respondent_id === i + 1);
      const actual = respondent?.clauses[0]?.polarity ?? null;
      rows.push({ ...item, actual });
    });
  }

  console.log("quote | expected | actual | match");
  for (const r of rows) {
    console.log(`"${r.quote.slice(0, 30)}..." | ${r.expectedPolarity} | ${r.actual} | ${r.actual === r.expectedPolarity ? "PASS" : "FAIL"}`);
  }

  // PRD 1.3절 기준 ①: 긍정 vs 나머지(부정+중립) 경계, 목표 90%+
  const positiveBoundaryCorrect = rows.filter((r) => {
    const expectedIsPositive = r.expectedPolarity === "positive";
    const actualIsPositive = r.actual === "positive";
    return expectedIsPositive === actualIsPositive;
  }).length;
  const positiveBoundaryRate = (positiveBoundaryCorrect / rows.length) * 100;

  // PRD 1.3절 기준 ②: 부정 vs 중립 경계(긍정 표본 제외), 목표 75%+
  const negNeutralRows = rows.filter((r) => r.expectedPolarity !== "positive");
  const negNeutralCorrect = negNeutralRows.filter((r) => r.actual === r.expectedPolarity).length;
  const negNeutralRate = negNeutralRows.length === 0 ? 0 : (negNeutralCorrect / negNeutralRows.length) * 100;

  console.log(`\n표본 수: ${rows.length}`);
  console.log(
    `긍정 vs 나머지 일치율: ${positiveBoundaryRate.toFixed(1)}% (목표 90%+) → ${positiveBoundaryRate >= 90 ? "PASS" : "FAIL"}`,
  );
  console.log(
    `부정 vs 중립 일치율(부정·중립 표본 ${negNeutralRows.length}건 중): ${negNeutralRate.toFixed(1)}% (목표 75%+) → ${negNeutralRate >= 75 ? "PASS" : "FAIL"}`,
  );

  if (positiveBoundaryRate < 90 || negNeutralRate < 75) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
