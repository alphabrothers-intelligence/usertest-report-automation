/**
 * **계산된 정량 데이터가 보고서 어딘가에 반드시 실리는지** 본다 — `npm run check:data-coverage`.
 * LLM·과금 없음. 로컬 dev 서버(:3000)와 `data/` 원본이 필요하다(check:empty-blocks와 같은 경로).
 *
 * 왜 필요한가: 케어클은 핵심구매요소 순위를 **계산까지 해두고도** 보고서에 안 실렸다. Ⅲ장이
 * 그 데이터를 무조건 가져가는 바람에 Ⅴ장에는 "1 핵심구매요소 조사 결과" 제목만 남았고, 담당자는
 * "왜 뽑히지도 않았나"라고 물었다(2026-09-11). `check:empty-blocks`는 이걸 못 잡는다 — 블록이
 * 비어 있던 게 아니라 **엉뚱한 장에 들어가 있었기** 때문이다.
 *
 * 그래서 여기서는 블록이 아니라 **데이터**를 기준으로 본다: "이 raw data에 X가 있으면, 보고서
 * 어딘가에 X의 값이 실려 있어야 한다." 새 정량 항목을 만들면 이 목록에 한 줄 추가할 것.
 */
import type { ReportBlock, ReportSectionContent } from "../lib/report/sections";
import type { QuantStats } from "../lib/quant/compute";
import { genericOf } from "../lib/report/genericStats";

const DATASETS = ["rivalabs", "carecl", "ezenauto", "cleanhabit", "twoblock"];
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

/** 보고서에 실린 모든 항목 이름·표 셀 문자열을 한 자루에 모은다. */
function collectLabels(blocks: ReportBlock[], bag: Set<string>): void {
  for (const block of blocks) {
    switch (block.kind) {
      case "chart": for (const item of block.items) bag.add(item.label); break;
      case "table": for (const row of block.rows) for (const cell of row) bag.add(String(cell)); break;
      case "rank-composition": for (const candidate of block.candidates) bag.add(candidate.name); break;
      case "stacked-bar": for (const category of block.categories) bag.add(category.name); break;
      case "grouped-bar": for (const category of block.categories) bag.add(category.label); break;
      case "radar": for (const indicator of block.indicators) bag.add(indicator); break;
      case "quadrant": for (const item of block.items) bag.add(item.name); break;
      case "journey-line": for (const point of block.points) bag.add(point.label); break;
      case "waterfall": for (const step of block.steps) bag.add(step.label); break;
      case "row-group":
        for (const row of block.rows) { bag.add(row.label); collectLabels(row.blocks, bag); }
        break;
      case "text":
      case "rich-static":
        // **줄글은 세지 않는다.** AI 해석 문단이 항목 이름을 스쳐 언급한 것만으로 "보고서에
        // 실렸다"고 치면, 도표가 통째로 빠져도 검사가 통과한다(2026-09-13 실측 — 케어클
        // 구매요소 도표를 일부러 꺼봤는데 PASS가 나왔다). 표의 칸만 값으로 인정한다.
        for (const cell of block.html.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
          bag.add(cell[1].replace(/<[^>]*>/g, " ").trim());
        }
        break;
      default: break;
    }
  }
}

/** 자루 안 어딘가에 이 이름이 들어 있는가(표 셀·문단 안에 묻혀 있어도 인정). */
function mentions(bag: Set<string>, name: string): boolean {
  const needle = name.trim();
  if (!needle) return true;
  for (const value of bag) if (value.includes(needle)) return true;
  return false;
}

/**
 * "데이터가 있으면 보고서에도 있어야 하는" 항목들.
 * 값이 비어 있는 raw data는 검사 대상이 아니다(없는 것을 만들라는 뜻이 아니므로).
 */
function requirements(stats: QuantStats): { what: string; names: string[] }[] {
  const generic = genericOf(stats);
  return [
    { what: "기능별 만족도", names: stats.featureSatisfaction.map((item) => item.name) },
    { what: "중요도 순위(기능 또는 핵심구매요소)", names: stats.relativeImportance.map((item) => item.name) },
    { what: "핵심구매요소 응답 분포", names: stats.keyFactorDistribution.map((item) => item.label) },
    { what: "가치 영역", names: generic.valueAxes.map((item) => item.name) },
    { what: "시점별 만족도", names: generic.journey.map((item) => item.name) },
    { what: "UX 품질", names: generic.uxGroups.flatMap((group) => group.items.map((item) => item.name)) },
  ];
}

/**
 * 내용이 하나도 없는 절 제목을 찾는다 — **다음 절 제목이 나올 때까지 제목 말고는 아무것도
 * 없는 절.** 문항 제목(Q6…)이 뒤따르는 것은 정상이므로, 바로 다음 블록만 보면 안 된다.
 */
function danglingHeadings(sections: ReportSectionContent[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    section.blocks.forEach((block, index) => {
      if (block.kind !== "heading" || block.variant !== "numbered") return;
      for (let cursor = index + 1; cursor < section.blocks.length; cursor += 1) {
        const next = section.blocks[cursor];
        if (next.kind === "heading" && next.variant === "numbered") break; // 다음 절 — 내용 없음
        if (next.kind !== "heading") return; // 내용이 있다
      }
      out.push(`${section.numeral}. ${block.text}`);
    });
  }
  return out;
}

async function main() {
  let failures = 0;
  for (const dataset of DATASETS) {
    const response = await fetch(`${BASE}/api/report-workspace/demo?dataset=${dataset}`);
    const payload = await response.json() as { ok?: boolean; error?: string; workspace?: { sections: ReportSectionContent[]; quantStats: QuantStats } };
    if (!response.ok || !payload.workspace) {
      console.error(`FAIL ${dataset}: 렌더 실패 — ${payload.error ?? response.status}`);
      failures += 1;
      continue;
    }
    const { sections, quantStats } = payload.workspace;
    const bag = new Set<string>();
    for (const section of sections) collectLabels(section.blocks, bag);

    const missing: string[] = [];
    for (const requirement of requirements(quantStats)) {
      if (requirement.names.length === 0) continue; // 그 데이터에 없는 항목은 검사 대상이 아니다
      const gone = requirement.names.filter((name) => !mentions(bag, name));
      if (gone.length > 0) missing.push(`${requirement.what}: ${gone.slice(0, 3).join(", ")}${gone.length > 3 ? ` 외 ${gone.length - 3}개` : ""}`);
    }
    const dangling = danglingHeadings(sections);

    if (missing.length === 0 && dangling.length === 0) {
      console.log(`PASS ${dataset} — 계산된 정량 항목이 모두 보고서에 실림 / 빈 절 제목 없음`);
      continue;
    }
    failures += 1;
    for (const line of missing) console.error(`FAIL ${dataset} — 계산했지만 보고서에 없음 · ${line}`);
    for (const line of dangling) console.error(`FAIL ${dataset} — 내용 없는 절 제목 · ${line}`);
  }
  if (failures > 0) {
    console.error(`\n${failures}개 raw data에서 누락 발견`);
    process.exit(1);
  }
  console.log("\n모든 raw data에서 계산된 정량 항목이 보고서에 실린다");
}

void main();
