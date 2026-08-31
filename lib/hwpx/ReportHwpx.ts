/**
 * 한글(HWPX) 내보내기용 OWPML 패키지 작성기.
 *
 * HWPX는 DOCX 확장자를 바꾼 파일이 아니라 ZIP 안에 OWPML XML, manifest, mimetype가
 * 들어가는 한글 문서 형식이다. 이 작성기는 보고서의 확정 텍스트·정량 수치를 문단으로
 * 넣어 한글에서 바로 열어 수정할 수 있는 실제 HWPX 패키지를 만든다. PDF/DOCX 렌더러와
 * 분리해 두었으므로 기존 Claude Code 렌더링 파일에는 영향을 주지 않는다.
 */
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { QuantStats } from "@/lib/quant/compute";
import type { ProductInfo } from "@/lib/productInfo/types";
import { parseRichRuns, parseRichText, type RichTextRun } from "@/lib/report/richText";
import type { ReportBlock, ReportHeadingBlock, ReportSectionContent } from "@/lib/report/sections";
import { SECTION_BANNER, SUBSECTION_BANNER, sectionRomanGlyph } from "@/lib/report/sectionStyle";

const NS = {
  hpf: "http://www.hancom.co.kr/hwpml/2011/hpf",
  hp: "http://www.hancom.co.kr/hwpml/2011/paragraph",
  hs: "http://www.hancom.co.kr/hwpml/2011/section",
  hc: "http://www.hancom.co.kr/hwpml/2011/core",
};

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(text: string, style: "title" | "section" | "heading" | "body" = "body"): string {
  const ids = { title: [1, 1], section: [2, 2], heading: [3, 3], body: [0, 0] } as const;
  const [charPrIDRef, paraPrIDRef] = ids[style];
  const runs = parseRichRuns(text).map((run) => {
    // 제목 자체의 기본 서식은 유지하고, 본문에서만 세밀한 강조 run을 분리한다.
    const richCharPr = style === "body"
      ? run.bold && run.underline && run.italic ? 10
      : run.bold && run.underline ? 6
      : run.bold && run.italic ? 8
      : run.underline && run.italic ? 9
      : run.bold ? 4
      : run.underline ? 5
      : run.italic ? 7
      : charPrIDRef
      : charPrIDRef;
    return `<hp:run charPrIDRef="${richCharPr}"><hp:t>${xml(run.text)}</hp:t></hp:run>`;
  }).join("");
  // 빈 줄도 p로 유지해야 한글에서 문단/줄 간격을 편집할 수 있다.
  return `<hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="${paraPrIDRef}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    ${runs}
  </hp:p>`;
}

function pageBreakParagraph(text = "", style: "title" | "section" | "heading" | "body" = "body"): string {
  return paragraph(text, style).replace('pageBreak="0"', 'pageBreak="1"');
}

/** rich-text 공통 모델을 HWPX 문단용 입력으로 다시 직렬화한다. */
function runsToMarkup(runs: RichTextRun[]): string {
  return runs.map((run) => {
    const text = run.text;
    if (run.bold && run.underline) return `**__${text}__**`;
    if (run.bold) return `**${text}**`;
    if (run.underline) return `__${text}__`;
    return text;
  }).join("");
}

/**
 * 웹 작업공간과 같은 heading / bullet / arrow 규칙을 한글 문서에도 적용한다.
 * HWPX에서 진짜 목록 속성까지 넣는 대신 눈에 보이는 기호와 들여쓰기 가능한 문단을 우선
 * 보장한다. 따라서 HWPX를 열어도 Markdown 표기가 노출되지 않는다.
 */
function richParagraphs(value: string): string[] {
  return parseRichText(value).map((block) => {
    const content = runsToMarkup(block.runs);
    // `[제목]`의 대괄호는 원본에서 실제로 보이는 글자다(richText.ts의 bracketed 주석 참고).
    if (block.kind === "heading") return paragraph(block.bracketed ? `[${content}]` : content, "heading");
    if (block.kind === "bullet") return paragraph(`• ${content}`);
    if (block.kind === "arrow") return paragraph(`→ ${content}`);
    return paragraph(content);
  });
}

function sectionXml(paragraphs: string[], templateSection?: string): string {
  // secPr/colPr는 첫 문단의 첫 run 안에 둔다. 이것이 section0.xml을 일반 XML이 아니라
  // OWPML 섹션으로 식별하게 하는 핵심 구조다.
  const first = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0">
      <hp:secPr textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" textVerticalWidthTail="0" lineGrid="0" charGrid="0" xmlns:hp="${NS.hp}">
        <hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>
        <hp:startNum pageStartsOn="BOTH" page="1" footnote="1" endnote="1" picture="1" table="1" equation="1"/>
        <hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" hideFirstBorder="0" hideFirstFill="0" hideFirstPageNum="0" hideFirstEmptyLine="0" hideFirstLineNum="0" showBorder="1" showFill="1"/>
        <hp:lineNumber countBy="0" distance="0" startNumber="0"/>
        <hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY">
          <hp:margin header="4252" footer="4252" gutter="0" left="5669" right="5669" top="5669" bottom="5669"/>
        </hp:pagePr>
        <hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" superscript="0"/><hp:noteLine length="1016" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="425" aboveLine="283"/><hp:numbering type="CONTINUOUS" newNum="1"/></hp:footNotePr>
        <hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" superscript="0"/><hp:noteLine length="1016" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="425" aboveLine="283"/><hp:numbering type="CONTINUOUS" newNum="1"/></hp:endNotePr>
      </hp:secPr>
      <hp:colPr type="NEWSPAPER" layout="LEFT" sameSz="1" sameGap="0" num="1"/>
      <hp:t></hp:t>
    </hp:run>
  </hp:p>`;
  const templateFirstParagraph = templateSection?.match(/<hp:p\b[\s\S]*?<\/hp:p>/)?.[0];
  let paragraphId = 1000000001;
  let tableId = 2000000001;
  const body = paragraphs.join("\n")
    .replaceAll("__REPORT_PARAGRAPH_ID__", () => String(paragraphId++))
    .replaceAll("__REPORT_TABLE_ID__", () => String(tableId++));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <hs:sec xmlns:hp="${NS.hp}" xmlns:hs="${NS.hs}">${templateFirstParagraph ?? first}${body}</hs:sec>`;
}

function headerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="${NS.hc}">
  <hh:refList>
    <hh:fontfaces><hh:fontface lang="HANGUL" count="2"><hh:font id="0" face="맑은 고딕" type="TTF"/><hh:font id="1" face="Pretendard" type="TTF"/></hh:fontface></hh:fontfaces>
    <hh:borderFills><hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0"/><hh:backSlash type="NONE" Crooked="0"/><hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/><hh:fillBrush><hc:winBrush faceColor="#FFFFFF" hatchColor="#000000" alpha="0"/></hh:fillBrush></hh:borderFill></hh:borderFills>
    <hh:charProperties>
      <hh:charPr id="0" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="0" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr>
      <hh:charPr id="1" height="3000" textColor="#173F73" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="1" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/></hh:charPr>
      <hh:charPr id="2" height="1900" textColor="#315C9C" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="1" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/></hh:charPr>
      <hh:charPr id="3" height="1400" textColor="#111111" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="1" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/></hh:charPr>
      <hh:charPr id="4" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="1" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr>
      <hh:charPr id="5" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="0" underlineType="BOTTOM" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="BOTTOM" shape="SOLID" color="#222222"/></hh:charPr>
      <hh:charPr id="6" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="0" bold="1" underlineType="BOTTOM" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="BOTTOM" shape="SOLID" color="#222222"/></hh:charPr>
      <hh:charPr id="7" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="1" bold="0" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr>
      <hh:charPr id="8" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="1" bold="1" underlineType="NONE" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr>
      <hh:charPr id="9" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="1" bold="0" underlineType="BOTTOM" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="BOTTOM" shape="SOLID" color="#222222"/></hh:charPr>
      <hh:charPr id="10" height="1100" textColor="#222222" shadeColor="none" useFontSpace="0" useKerning="0" italic="1" bold="1" underlineType="BOTTOM" strikeoutType="NONE" outlineType="NONE" shadowType="NONE" emboss="0" engrave="0" superscript="0" subscript="0"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:underline type="BOTTOM" shape="SOLID" color="#222222"/></hh:charPr>
    </hh:charProperties>
    <hh:paraProperties><hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widOrphan="1" keepWithNext="0" keepLines="0" pageBreakBefore="0"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin intent="0" left="0" right="0" prev="0" next="240"/><hh:lineSpacing type="PERCENT" value="150"/></hh:paraPr><hh:paraPr id="1" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="CENTER" vertical="BASELINE"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widOrphan="1" keepWithNext="0" keepLines="0" pageBreakBefore="0"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin intent="0" left="0" right="0" prev="0" next="500"/><hh:lineSpacing type="PERCENT" value="150"/></hh:paraPr><hh:paraPr id="2" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widOrphan="1" keepWithNext="1" keepLines="1" pageBreakBefore="1"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin intent="0" left="0" right="0" prev="0" next="500"/><hh:lineSpacing type="PERCENT" value="150"/></hh:paraPr><hh:paraPr id="3" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widOrphan="1" keepWithNext="1" keepLines="1" pageBreakBefore="0"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin intent="0" left="0" right="0" prev="0" next="260"/><hh:lineSpacing type="PERCENT" value="150"/></hh:paraPr></hh:paraProperties>
  </hh:refList>
</hh:head>`;
}

export interface HwpxReportInput {
  fileName: string | null;
  generatedAt: string;
  quantStats: QuantStats;
  resultSummary: string;
  productInfo?: ProductInfo;
  /** /viewer에서 사용자가 수정한 현재 문서. 있으면 DB 원본 재조립보다 이 스냅샷을 우선한다. */
  sections?: ReportSectionContent[];
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

function blockLines(block: ReportBlock): string[] {
  switch (block.kind) {
    case "heading": return [`${block.number ? `${block.number}. ` : ""}${block.text}`];
    case "text": return htmlToText(block.html).split("\n");
    case "rich-static": return htmlToText(block.html).split("\n");
    case "table": return [block.title ?? "", block.headers.join(" | "), ...block.rows.map((row) => row.join(" | "))].filter(Boolean);
    case "chart": return [block.title, ...block.items.map((item) => `${item.label}: ${item.value}${block.unit}`)];
    case "journey-line": return [block.title, ...block.points.map((point) => `${point.label}: ${point.value.toFixed(2)}${block.unit}`)];
    case "waterfall": return [block.title, ...block.steps.map((step) => `${step.label}: ${step.delta > 0 ? "+" : ""}${step.delta.toFixed(2)}${block.unit}`)];
    case "rank-composition": return [block.title, ...block.rows.map((row) => `${row.rank}순위: ${row.segments.map((item) => `${item.name} ${item.percentage}%`).join(" · ")}`)];
    case "stacked-bar": return [block.title, ...block.rows.map((row) => `${row.label}: ${row.segments.map((item) => `${item.name} ${item.value}${block.unit}`).join(" · ")}`)];
    case "grouped-bar": return [block.title, ...block.categories.map((item) => `${item.label}: ${item.values.map((value) => `${value.series} ${value.value}${block.unit}`).join(" · ")}`)];
    case "radar": return [block.title, ...block.indicators.map((label, index) => `${label}: ${block.series.map((series) => `${series.name} ${series.values[index] ?? "-"}`).join(" · ")}`)];
    case "nps": return [block.title, `평균 ${block.mean} · NPS ${block.npsScore} · 추천 ${block.promoterPct}% · 중립 ${block.passivePct}% · 비추천 ${block.detractorPct}%`];
    case "quadrant": return [block.title, ...block.items.map((item) => `${item.name}: 중요도 ${item.importance} · 만족도 ${item.satisfaction}`), ...block.zones.map((zone) => `${zone.title}: ${zone.description}`)];
    case "priority-reference": return [block.title];
    case "polarity": return [block.title, `긍정 ${block.positive}% · 부정 ${block.negative}% · 중립 ${block.neutral}%`];
    case "row-group": return [block.headers?.join(" | ") ?? "", ...block.rows.flatMap((row) => [row.label, ...row.blocks.flatMap(blockLines)])].filter(Boolean);
  }
}

/** 원본 HWPX의 장 제목 2셀 표를 실측값 그대로 재현한다(27.17pt + 198.86pt, 높이 33.10pt). */
function sectionBannerTable(numeral: string, title: string, pageBreak: boolean): string {
  return `<hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:tbl id="__REPORT_TABLE_ID__" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="2" cellSpacing="0" borderFillIDRef="3" noAdjust="0">
      <hp:sz width="22603" widthRelTo="ABSOLUTE" height="3310" heightRelTo="ABSOLUTE" protect="0"/>
      <hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>
      <hp:outMargin left="0" right="0" top="0" bottom="1152"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>
      <hp:tr>
        <hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="1" borderFillIDRef="7"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0"><hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="28" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="16"><hp:t>${xml(sectionRomanGlyph(numeral))}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="2717" height="3310"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>
        <hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="1" borderFillIDRef="8"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0"><hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="28" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="17"><hp:t>${xml(title)}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="19886" height="3310"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>
      </hp:tr>
    </hp:tbl></hp:run>
  </hp:p>`;
}

/** 원본의 `1 | 제품 소개` 2셀 절 제목 표(37.44pt, 전체 본문 폭, 높이 30pt). */
function subsectionBannerTable(number: string, title: string): string {
  return `<hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:tbl id="__REPORT_TABLE_ID__" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="2" cellSpacing="0" borderFillIDRef="9" noAdjust="0">
      <hp:sz width="42520" widthRelTo="ABSOLUTE" height="3000" heightRelTo="ABSOLUTE" protect="0"/>
      <hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>
      <hp:outMargin left="0" right="0" top="0" bottom="1164"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>
      <hp:tr>
        <hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="1" borderFillIDRef="10"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0"><hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="28" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="18"><hp:t>${xml(number)}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="3744" height="3000"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>
        <hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="1" borderFillIDRef="9"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0"><hp:p id="__REPORT_PARAGRAPH_ID__" paraPrIDRef="29" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="18"><hp:t>${xml(title)}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="38776" height="3000"/><hp:cellMargin left="1296" right="0" top="0" bottom="0"/></hp:tc>
      </hp:tr>
    </hp:tbl></hp:run>
  </hp:p>`;
}

function workspaceParagraphs(sections: ReportSectionContent[]): string[] {
  return sections.flatMap((section) => [
    sectionBannerTable(section.numeral, section.title, true),
    ...section.blocks.flatMap((block) => block.kind === "heading" && block.variant === "numbered"
      ? [subsectionBannerTable(block.number ?? "", block.text)]
      : blockLines(block).filter(Boolean).map((line, index) => paragraph(line, block.kind === "heading" || index === 0 && !["text", "rich-static"].includes(block.kind) ? "heading" : "body"))),
  ]);
}

function frontMatterParagraphs(input: HwpxReportInput, sections: ReportSectionContent[]): string[] {
  const company = input.productInfo?.companyName?.trim() || "기업명 입력";
  const service = input.productInfo?.serviceName?.trim() || "서비스·제품명 입력";
  const date = input.productInfo?.coverDate?.trim() || input.generatedAt.replaceAll("-", ".");
  const cover = [
    paragraph("사용성 테스트\n결과보고서", "title"),
    paragraph(company, "title"),
    paragraph(`Usability Test Proposal for ‘${service}’`, "heading"),
    paragraph(date),
    paragraph("- 1 -"),
  ];
  const toc = sections.flatMap((section, sectionIndex) => {
    const sectionPage = section.tocPageOverride || section.tocPageNumber || "";
    const headings = section.blocks.filter((block): block is ReportHeadingBlock => block.kind === "heading" && block.variant === "numbered");
    return [
      sectionIndex === 0
        ? pageBreakParagraph(`${sectionRomanGlyph(section.numeral)}. ${section.title}  ·········································  ${sectionPage}`, "heading")
        : paragraph(`${sectionRomanGlyph(section.numeral)}. ${section.title}  ·········································  ${sectionPage}`, "heading"),
      ...headings.map((heading) => paragraph(`${heading.number || ""}. ${heading.text}  ·································  ${heading.tocPageOverride || heading.tocPageNumber || sectionPage}`)),
    ];
  });
  return [...cover, ...toc, paragraph("- 2 -")];
}

function reportParagraphs(input: HwpxReportInput): string[] {
  if (input.sections?.length) return [...frontMatterParagraphs(input, input.sections), ...workspaceParagraphs(input.sections)];
  const q = input.quantStats;
  const product = input.productInfo?.serviceName ?? input.fileName?.replace(/\.[^.]+$/, "") ?? "사용성 테스트";
  const company = input.productInfo?.companyName ?? "입력 필요";
  const stat = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "-";
  const p: string[] = [];
  p.push(paragraph("사용성 테스트 결과보고서", "title"));
  p.push(paragraph(product, "title"));
  p.push(paragraph(`생성일: ${input.generatedAt}`, "body"));
  p.push(paragraph("ALPHA BROTHERS", "heading"));
  p.push(paragraph("Ⅰ. 개요", "section"));
  p.push(paragraph("1. 제품 소개", "heading"));
  p.push(paragraph(`기업명: ${company}`));
  p.push(paragraph(`제품·서비스명: ${product}`));
  p.push(paragraph(`응답자 수: ${q.respondentCount}명`));
  p.push(paragraph("Ⅱ. 인적 사항 및 특성 조사", "section"));
  p.push(paragraph("응답 결과", "heading"));
  p.push(paragraph(`성별 분포: ${q.demographics.gender.map((x) => `${x.label} ${x.percentage}%`).join(" · ")}`));
  p.push(paragraph(`운영체제 분포: ${q.demographics.os.map((x) => `${x.label} ${x.percentage}%`).join(" · ")}`));
  p.push(paragraph("Ⅲ. 기능별 고객 경험 평가", "section"));
  p.push(paragraph("1. 기능별 고객 경험 조사 결과", "heading"));
  q.featureSatisfaction.forEach((item, index) => p.push(paragraph(`${index + 1}. ${item.name}: 평균 ${stat(item.mean)}점 / 표준편차 ${stat(item.sd)}`)));
  p.push(paragraph("기능별 중요 순위 종합", "heading"));
  q.relativeImportance.forEach((item, index) => p.push(paragraph(`${index + 1}위  ${item.name}: 상대 중요도 ${stat(item.score)}`)));
  p.push(paragraph("Ⅳ. 핵심구매요소", "section"));
  p.push(paragraph("1. 핵심구매요소 조사 결과", "heading"));
  q.keyFactorDistribution.forEach((item, index) => p.push(paragraph(`${index + 1}. ${item.label}: ${item.percentage}% (${item.count}명)`)));
  p.push(paragraph("Ⅴ. 4대 가치 만족도", "section"));
  p.push(paragraph("1. 4대 가치 만족도 조사 결과", "heading"));
  [["기능적 가치", q.fourValues.functional], ["심미적 가치", q.fourValues.aesthetic], ["경제적 가치", q.fourValues.economic], ["사회·공공적 가치", q.fourValues.social]].forEach(([name, value]) => {
    const metric = value as { mean: number; sd: number };
    p.push(paragraph(`${name}: 평균 ${stat(metric.mean)}점 / 표준편차 ${stat(metric.sd)}`));
  });
  p.push(paragraph("Ⅵ. 사용자 경험 품질 평가", "section"));
  p.push(paragraph("1. 사용자 경험 품질 평가 결과", "heading"));
  [...q.uxQuality.usability, ...q.uxQuality.fun].forEach((item) => p.push(paragraph(`${item.name}: 평균 ${stat(item.mean)}점 / 표준편차 ${stat(item.sd)}`)));
  p.push(paragraph("Ⅶ. 교차 분석", "section"));
  p.push(paragraph("사용자 특성별 정량 교차 분석 결과는 PDF 보고서의 차트와 함께 확인할 수 있습니다."));
  p.push(paragraph("Ⅷ. 종합 만족도 및 NPS 지수", "section"));
  p.push(paragraph(`종합 만족도: 평균 ${stat(q.overallSatisfaction.mean)}점 / 표준편차 ${stat(q.overallSatisfaction.sd)}`, "heading"));
  p.push(paragraph(`NPS 지수: ${q.nps.npsScore} (추천 고객 ${q.nps.promoterPct}% · 중립 고객 ${q.nps.passivePct}% · 비추천 고객 ${q.nps.detractorPct}%)`));
  p.push(paragraph("Ⅸ. 종합 결과 및 제언", "section"));
  p.push(paragraph("사용성테스트 결과 요약", "heading"));
  p.push(...richParagraphs(input.resultSummary));
  return p;
}

function enhanceTemplateHeader(header: string): string {
  const borderFill = (id: number, color: string, border = "NONE") => `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="${border}" width="0.20 mm" color="${SUBSECTION_BANNER.borderColor}"/><hh:rightBorder type="${border}" width="0.20 mm" color="${SUBSECTION_BANNER.borderColor}"/><hh:topBorder type="${border}" width="0.20 mm" color="${SUBSECTION_BANNER.borderColor}"/><hh:bottomBorder type="${border}" width="0.20 mm" color="${SUBSECTION_BANNER.borderColor}"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="${color}" hatchColor="#000000" alpha="0"/></hc:fillBrush></hh:borderFill>`;
  const charPr = (id: number, height: number, color: string, spacing: number) => `<hh:charPr id="${id}" height="${height}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="${spacing}" latin="${spacing}" hanja="${spacing}" japanese="${spacing}" other="${spacing}" symbol="${spacing}" user="${spacing}"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`;
  const centerPara = `<hh:paraPr id="28" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR"><hh:align horizontal="CENTER" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="1" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"><hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="140" unit="HWPUNIT"/></hp:case><hp:default><hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="140" unit="HWPUNIT"/></hp:default></hp:switch><hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`;
  const leftPara = centerPara.replace('id="28"', 'id="29"').replace('horizontal="CENTER"', 'horizontal="LEFT"');
  return header
    .replace(/<hh:borderFills itemCnt="6">/, `<hh:borderFills itemCnt="10">`)
    .replace("</hh:borderFills>", `${borderFill(7, SECTION_BANNER.badgeBackground)}${borderFill(8, SECTION_BANNER.titleBackground)}${borderFill(9, "#FFFFFF", "SOLID")}${borderFill(10, SUBSECTION_BANNER.numberBackground, "SOLID")}</hh:borderFills>`)
    .replace(/<hh:charProperties itemCnt="16">/, `<hh:charProperties itemCnt="19">`)
    .replace("</hh:charProperties>", `${charPr(16, 1400, SECTION_BANNER.badgeColor, 0)}${charPr(17, 1500, SECTION_BANNER.titleColor, -5)}${charPr(18, 1404, "#111827", -3)}</hh:charProperties>`)
    .replace(/<hh:paraProperties itemCnt="28">/, `<hh:paraProperties itemCnt="30">`)
    .replace("</hh:paraProperties>", `${centerPara}${leftPara}</hh:paraProperties>`);
}

export async function buildReportHwpx(input: HwpxReportInput): Promise<Buffer> {
  // 한컴은 XML만 든 최소 ZIP을 구조상 열 수 있어 보여도 실제로는 손상 문서로 거부한다.
  // settings/Preview/container 메타데이터가 포함된 검증 완료 베이스 패키지를 복제하고 본문만
  // 교체한다. 이 파일은 next.config.ts의 outputFileTracingIncludes로 서버 번들에도 포함된다.
  const templatePath = path.join(process.cwd(), "output", "hwpx-templates", "01_공통_기본_사용성테스트_보고서_양식.hwpx");
  const templateBuffer = await readFile(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);
  const templateSection = await zip.file("Contents/section0.xml")?.async("string");
  const templateHeader = await zip.file("Contents/header.xml")?.async("string");
  // 템플릿의 검증된 header.xml 스타일/참조 체계를 그대로 유지한다. 과거 자체 생성 header가
  // 한컴의 복구 경고를 유발한 핵심 원인이었다.
  void headerXml;
  if (templateHeader) zip.file("Contents/header.xml", enhanceTemplateHeader(templateHeader), { createFolders: false });
  zip.file("Contents/section0.xml", sectionXml(reportParagraphs(input), templateSection), { createFolders: false });
  // mimetype은 반드시 첫 엔트리이자 무압축이어야 한다. JSZip은 기존 순서를 유지한다.
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE", createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
