import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";
import { buildReportWorkspaceSeed } from "../lib/report/workspace";

const sourcePath = new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url);
const buffer = readFileSync(sourcePath);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
const parsed = parseWallaWorkbook(arrayBuffer);
const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
const quantStats = computeQuantStats(records, parsed.headerRow);
const workspace = buildReportWorkspaceSeed({
  quantStats,
  fileName: "[리바랩스]사용성테스트 raw data.xlsx",
  qualitative: [],
  recommendations: [],
});

const featureSection = workspace.sections.find((section) => section.numeral === "III");
if (!featureSection) throw new Error("Ⅲ장 기능별 고객 경험 평가가 생성되지 않았습니다.");

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sectionStructure = workspace.sections.map((section) => ({
  numeral: section.numeral,
  title: section.title,
  blocks: section.blocks.map((block) => ({ id: block.id, kind: block.kind })),
}));

const actual = {
  workspace: digest(workspace.sections),
  feature: digest(featureSection),
  structure: digest(sectionStructure),
};

const expected = {
  workspace: "6e0977f9285b4c0b9e83d334f7844dbb03017ed585a16452d281f1bda40523fa",
  feature: "0089c2c4e8d37f61b24323bc9207f30989fce4650258926b9205b32e9e9be64b",
  structure: "837ab14e25069351322ffbd2e577ffdf2cae26025a3cc573df980e9e408db4d8",
};

console.log(JSON.stringify(actual, null, 2));

for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
  if (actual[key] !== expected[key]) {
    throw new Error(`${key} 작업공간 출력이 변경됐습니다. 기대값 ${expected[key]}, 실제값 ${actual[key]}`);
  }
}
