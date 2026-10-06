/**
 * 문항 리스트 템플릿(`public/templates/survey-question-template.xlsx`)의 4행부터를 문항으로
 * 채운다. 단계 칸(A열)은 연속한 같은 단계끼리 병합하고 단계마다 파스텔 색을 칠한다.
 * SheetJS로 새로 쓰면 드롭다운(데이터 유효성)·머리행 색·`작성 안내` 시트가 사라지므로
 * 템플릿 XML을 그대로 두고 행만 갈아끼운다. 1~3행(머리행·설명·예시)은 템플릿 그대로 남긴다.
 * 브라우저와 Node 둘 다에서 돈다(JSZip).
 */
import JSZip from "jszip";
import { stageColor, toSheetRows, type SurveyQuestion } from "./types";

const SHEET = "xl/worksheets/sheet1.xml";
const FIRST_ROW = 4;
const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const DATA_STYLE = 5; // 템플릿의 빈 입력 행이 쓰는 셀 스타일

const escapeXml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function buildSurveyXlsx(template: ArrayBuffer | Uint8Array, questions: SurveyQuestion[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const xml = await zip.file(SHEET)!.async("string");

  const rows = toSheetRows(questions);
  const stageStyles = await addStageStyles(zip, [...new Set(questions.map((q) => q.stage))]);

  // 연속한 같은 단계 → A열 병합. 병합 영역의 값은 첫 칸에만 둔다(엑셀 규칙).
  const merges: string[] = [];
  const continued = new Set<number>(); // 병합 영역의 둘째 행부터(rows 인덱스)
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1][0] === rows[i][0]) continued.add(++j);
    if (j > i) merges.push(`<mergeCell ref="A${FIRST_ROW + i}:A${FIRST_ROW + j}"/>`);
    i = j + 1;
  }

  // 템플릿은 100행까지 빈 입력칸이 있다 — 문항이 적어도 그만큼은 입력칸으로 남긴다.
  const lastRow = Math.max(100, FIRST_ROW + rows.length - 1);
  const rowXml: string[] = [];
  for (let r = FIRST_ROW; r <= lastRow; r += 1) {
    const index = r - FIRST_ROW;
    const values = rows[index] ?? [];
    const cells = COLS.map((col, i) => {
      const stageCell = i === 0 && values.length > 0;
      const v = stageCell && continued.has(index) ? "" : values[i] ?? "";
      const style = stageCell ? stageStyles.get(values[0])! : DATA_STYLE;
      return v
        ? `<c r="${col}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`
        : `<c r="${col}${r}" s="${style}"/>`;
    }).join("");
    rowXml.push(`<row r="${r}">${cells}</row>`);
  }

  const start = xml.indexOf(`<row r="${FIRST_ROW}"`);
  const end = xml.indexOf("</sheetData>");
  if (start < 0 || end < 0) throw new Error("문항 리스트 템플릿 형식이 예상과 다릅니다.");

  let out = xml.slice(0, start) + rowXml.join("") + xml.slice(end);
  if (merges.length) {
    // 스키마 순서상 mergeCells는 autoFilter 뒤, conditionalFormatting 앞이다.
    out = out.replace("<conditionalFormatting", `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells><conditionalFormatting`);
  }
  // 드롭다운·자동필터·서식 범위를 실제 마지막 행까지 늘린다(문항이 98개를 넘는 경우).
  const rangeEnd = lastRow + 1;
  out = out
    .replace(/<dimension ref="A1:H\d+"\/>/, `<dimension ref="A1:H${lastRow}"/>`)
    .replace(/([A-H])4:([A-H])101/g, (_, a, b) => `${a}4:${b}${rangeEnd}`)
    .replace(/A1:H101/g, `A1:H${rangeEnd}`)
    .replace(/\$A\$1:\$H\$101/g, `$A$1:$H$${rangeEnd}`);
  zip.file(SHEET, out);

  // workbook.xml의 자동필터 정의 이름도 같은 범위를 쓴다.
  const workbook = await zip.file("xl/workbook.xml")!.async("string");
  zip.file("xl/workbook.xml", workbook.replace(/\$A\$1:\$H\$101/g, `$A$1:$H$${rangeEnd}`));

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 단계마다 파스텔 채우기 + 가운데 정렬 셀 서식을 styles.xml에 덧붙이고, 단계 → 서식 번호를 돌려준다. */
async function addStageStyles(zip: JSZip, stages: string[]): Promise<Map<string, number>> {
  let styles = await zip.file("xl/styles.xml")!.async("string");
  const fillCount = Number(styles.match(/<fills count="(\d+)"/)![1]);
  const xfCount = Number(styles.match(/<cellXfs count="(\d+)"/)![1]);
  const fills = stages.map((s) => {
    const rgb = `FF${stageColor(s)}`;
    return `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor rgb="${rgb}"/></patternFill></fill>`;
  });
  const xfs = stages.map((_, i) =>
    `<xf numFmtId="0" fontId="3" fillId="${fillCount + i}" borderId="1" applyFill="1" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`);
  styles = styles
    .replace(/<fills count="\d+">([\s\S]*?)<\/fills>/, (_, inner) => `<fills count="${fillCount + fills.length}">${inner}${fills.join("")}</fills>`)
    .replace(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/, (_, inner) => `<cellXfs count="${xfCount + xfs.length}">${inner}${xfs.join("")}</cellXfs>`);
  zip.file("xl/styles.xml", styles);
  return new Map(stages.map((s, i) => [s, xfCount + i]));
}
