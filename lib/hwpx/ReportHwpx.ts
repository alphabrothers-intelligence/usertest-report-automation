/**
 * 한글(HWPX) 내보내기용 OWPML 패키지 작성기.
 *
 * HWPX는 DOCX 확장자를 바꾼 파일이 아니라 ZIP 안에 OWPML XML, manifest, mimetype가
 * 들어가는 한글 문서 형식이다. 이 작성기는 보고서의 확정 텍스트·정량 수치를 문단으로
 * 넣어 한글에서 바로 열어 수정할 수 있는 실제 HWPX 패키지를 만든다. PDF/DOCX 렌더러와
 * 분리해 두었으므로 기존 Claude Code 렌더링 파일에는 영향을 주지 않는다.
 */
import JSZip from "jszip";
import type { QuantStats } from "@/lib/quant/compute";
import type { ProductInfo } from "@/lib/productInfo/types";
import { parseRichRuns, parseRichText, type RichTextRun } from "@/lib/report/richText";

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
  return `<hp:p id="0" paraPrIDRef="${paraPrIDRef}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    ${runs}
  </hp:p>`;
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
    if (block.kind === "heading") return paragraph(content, "heading");
    if (block.kind === "bullet") return paragraph(`• ${content}`);
    if (block.kind === "arrow") return paragraph(`→ ${content}`);
    return paragraph(content);
  });
}

function sectionXml(paragraphs: string[]): string {
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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <hs:sec xmlns:hp="${NS.hp}" xmlns:hs="${NS.hs}">${first}${paragraphs.join("\n")}</hs:sec>`;
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
}

function reportParagraphs(input: HwpxReportInput): string[] {
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
  p.push(paragraph("1. 4대 가치 조사 결과", "heading"));
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

export async function buildReportHwpx(input: HwpxReportInput): Promise<Buffer> {
  const zip = new JSZip();
  const now = new Date().toISOString();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hv:version xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" targetApplication="HWP" major="5" minor="1" micro="1" application="HWPX" os="Web" xmlVersion="1.1"/>`);
  zip.file("META-INF/manifest.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><om:manifest xmlns:om="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><om:file-entry om:full-path="/" om:media-type="application/hwp+zip"/><om:file-entry om:full-path="Contents/content.hpf" om:media-type="application/xml"/><om:file-entry om:full-path="Contents/header.xml" om:media-type="application/xml"/><om:file-entry om:full-path="Contents/section0.xml" om:media-type="application/xml"/></om:manifest>`);
  zip.file("Contents/content.hpf", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hh:hpfs xmlns:hh="${NS.hpf}"><hh:beginNum page="1" footnote="1" endnote="1" picture="1" table="1" equation="1"/><hh:references><hh:refList><hh:fontfaces itemCnt="0"/><hh:charProperties itemCnt="0"/><hh:paraProperties itemCnt="0"/><hh:styles itemCnt="0"/></hh:refList></hh:references><hh:meta><hh:title>${xml(input.productInfo?.serviceName ?? input.fileName ?? "사용성 테스트 결과보고서")}</hh:title><hh:creator>ALPHA BROTHERS</hh:creator><hh:createdDate>${now}</hh:createdDate><hh:modifiedDate>${now}</hh:modifiedDate></hh:meta><hh:manifest><hh:item id="header" href="header.xml" media-type="application/xml"/><hh:item id="sec0" href="section0.xml" media-type="application/xml"/></hh:manifest><hh:spine><hh:itemRef idref="sec0"/></hh:spine></hh:hpfs>`);
  zip.file("Contents/header.xml", headerXml());
  zip.file("Contents/section0.xml", sectionXml(reportParagraphs(input)));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
