// PDF 쪽 lib/pdf/charts.tsx·theme.ts에 해당하는 DOCX 빌더 유틸 — react-pdf의 View/Text
// 대신 docx 패키지의 Paragraph/Table을 쓴다는 것만 다르고, 데이터는 QuantStats/Question 등
// PDF와 완전히 같은 소스를 그대로 재사용한다(lib/docx/ReportDocx.ts 참고).
import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
  type ITableBordersOptions,
} from "docx";
import { colors } from "./theme";
import { parseRichRuns } from "@/lib/report/richText";

// pageBreakBefore는 스타일(default.heading1)이 아니라 문단 단위 옵션이라 여기서 직접 준다 —
// PDF의 각 장(Ⅰ~Ⅸ) SectionHeader가 <View break>로 항상 새 페이지에서 시작하는 것과 같은
// 원칙(단, Ⅰ장은 목차 바로 다음이라 이미 새 페이지지만 pageBreakBefore를 줘도 빈 페이지가
// 추가되지는 않는다 — Word는 페이지 맨 위에서의 pageBreakBefore를 무시한다).
export function h1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, pageBreakBefore: true });
}

export function h2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
}

export function h3(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } });
}

// 이탤릭은 안 쓴다 — 한글 폰트(맑은 고딕 등)는 진짜 이탤릭 글리프가 없어 렌더러가 임의로
// 기울이는 합성 이탤릭(synthetic oblique)을 적용하는데, 이게 일부 글자(특히 획이 많은
// 글자)를 알아보기 어렵게 뭉갠다(2026-07-23 LibreOffice 렌더 실측 확인: "입력 필요"의
// "필"이 "픸"처럼 깨져 보임). PDF 쪽 CLAUDE.md의 "이탤릭 폰트 파일을 등록 안 해서 에러난다"
// 문제와 원인은 다르지만 결론(한글에 이탤릭을 쓰지 않는다)은 같다 — 색상만으로 구분한다.
export function body(text: string, opts?: { bold?: boolean; color?: string }): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, bold: opts?.bold, color: opts?.color })],
  });
}

/** 여러 줄(각 줄이 개조식 항목)을 한 번에 문단으로 만든다 — PDF의 MarkdownLite와 같은 이유로
 * (LLM 결과요약 프롬프트가 종종 "#"·"-" 마크다운을 섞어 쓴다) 가벼운 마크다운 변환을 거친다.
 * 프롬프트 문구 자체는 건드리지 않는다는 원칙은 PDF 쪽과 동일 — 표시 단계에서만 보정한다. */
export function markdownLite(text: string): Paragraph[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.map((line) => {
    const trimmed = line.trim();
    const isBoldLine = /^\*\*.+\*\*:?$/.test(trimmed);
    const textRuns = (value: string) => parseRichRuns(value).map((run) => new TextRun({ text: run.text, bold: run.bold, underline: run.underline ? {} : undefined }));
    if (trimmed.startsWith("## ") || trimmed.startsWith("# ") || isBoldLine) {
      const content = isBoldLine ? trimmed.replace(/^\*\*|\*\*:?$/g, "") : trimmed.replace(/^#+\s*/, "");
      return new Paragraph({
        spacing: { before: 120, after: 60 },
        children: parseRichRuns(content).map((run) => new TextRun({ text: run.text, bold: true, underline: run.underline ? {} : undefined })),
      });
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      return new Paragraph({
        spacing: { after: 60 },
        bullet: { level: 0 },
        children: textRuns(trimmed.slice(2)),
      });
    }
    if (/^(→|▶)\s*/.test(trimmed)) {
      return new Paragraph({
        spacing: { after: 80 },
        indent: { left: 240, hanging: 240 },
        children: [new TextRun({ text: "→ ", bold: true }), ...textRuns(trimmed.replace(/^(→|▶)\s*/, ""))],
      });
    }
    return new Paragraph({ spacing: { after: 80 }, children: textRuns(trimmed) });
  });
}

export function placeholder(text: string): Paragraph {
  return body(text, { color: colors.subtext });
}

/** Ⅰ장 제품정보 필드 한 줄(라벨: 값) — 값이 없으면 PDF와 동일하게 "입력 필요"로 남긴다
 * (AI가 임의로 채우지 않는다는 5.0절 원칙, ReportDocument.tsx의 FieldRow와 동일 규칙). */
export function fieldRow(label: string, value: string | null | undefined): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    tabStops: [{ type: "left" as const, position: 1600 }],
    children: [
      new TextRun({ text: `${label}\t`, color: colors.subtext }),
      value
        ? new TextRun({ text: value })
        : new TextRun({ text: "입력 필요", color: colors.subtext }),
    ],
  });
}

const THIN_BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 2, color: colors.border };

export const TABLE_BORDERS: ITableBordersOptions = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

export function tableCell(
  text: string,
  opts?: { bold?: boolean; shading?: string; align?: "center" | "left" | "right"; width?: number; color?: string },
): TableCell {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment:
          opts?.align === "center"
            ? AlignmentType.CENTER
            : opts?.align === "right"
              ? AlignmentType.RIGHT
              : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts?.bold, color: opts?.color })],
      }),
    ],
  });
}

/** 헤더 행(회색 배경, 굵게) + 데이터 행들로 이뤄진 표 — PDF의 styles.table/tableRow/
 * tableHeaderCell/tableCell에 대응한다. columnWidthsPct 합은 100이어야 한다(생략 시 균등폭). */
export function dataTable(headers: string[], rows: (string | number)[][], columnWidthsPct?: number[]): Table {
  const widths = columnWidthsPct ?? headers.map(() => Math.floor(100 / headers.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => tableCell(h, { bold: true, shading: colors.bgAlt, align: "center", width: widths[i] })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((cellValue, i) => tableCell(String(cellValue), { align: "center", width: widths[i] })),
          }),
      ),
    ],
  });
}

export function spacer(after = 120): Paragraph {
  return new Paragraph({ spacing: { after } });
}
