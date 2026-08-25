"use client";

import { PUBLISHER_DEFAULTS, type ProductInfo } from "@/lib/productInfo/types";
import type { ReportHeadingBlock, ReportSectionContent } from "@/lib/report/sections";
import { sectionRomanGlyph } from "@/lib/report/sectionStyle";

type PageGroups = Record<string, string[][]>;

function editableText(event: React.FocusEvent<HTMLElement>): string {
  return event.currentTarget.textContent?.trim() ?? "";
}

export function ReportCoverPage({ productInfo, onChange }: { productInfo: ProductInfo; onChange: (next: ProductInfo) => void }) {
  const date = productInfo.coverDate?.trim() || new Date().toISOString().slice(0, 10).replaceAll("-", ".");
  return (
    <section data-front-page data-a4-page className="relative box-border h-[297mm] w-[210mm] overflow-hidden border border-[#dfe3e9] bg-white shadow-[0_12px_34px_rgba(28,39,55,.11)]">
      {/* 원본 PDF 1쪽의 글자 없는 배경 레이어(모자이크+ALPHA BROTHERS 워드마크). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/rivalabs-cover-template.png" alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute left-[18.5mm] top-[151mm] w-[150mm] tracking-[-0.055em]">
        <h1 className="m-0 text-[31.5pt] font-bold leading-[1.35] text-[#075b9c]">사용성 테스트<br />결과보고서</h1>
        <p contentEditable suppressContentEditableWarning onBlur={(event) => onChange({ ...productInfo, companyName: editableText(event) })} className="mt-[10mm] text-[25pt] font-medium leading-none text-[#5d7fd0] outline-none focus:bg-[#eef5ff]">{productInfo.companyName || "기업명 입력"}</p>
        <p className="mt-[8mm] text-[12pt] tracking-[-0.035em] text-[#555]">Usability Test Proposal for ‘<span contentEditable suppressContentEditableWarning onBlur={(event) => onChange({ ...productInfo, serviceName: editableText(event) })} className="outline-none focus:bg-[#eef5ff]">{productInfo.serviceName || "서비스·제품명 입력"}</span>’</p>
        <p contentEditable suppressContentEditableWarning onBlur={(event) => onChange({ ...productInfo, coverDate: editableText(event) })} className="mt-[8mm] text-[11pt] tracking-normal text-[#666] outline-none focus:bg-[#eef5ff]">{date}</p>
      </div>
      <p className="absolute bottom-[10mm] left-0 right-0 text-center text-[9pt] text-[#222]">- 1 -</p>
    </section>
  );
}

/**
 * 판권면(배면, 레이아웃 L30) — 원본 마지막 쪽. 표지와 같은 배경 이미지를 쓰되 **상단 50%만**
 * 잘라 쓴다: 원본 배면에는 모자이크만 있고 하단 ALPHA BROTHERS 워드마크가 없기 때문이다
 * (템플릿 PNG 실측 — 모자이크 14.7~48.8%, 워드마크 93.3~94.5%). 별도 배경 이미지를 새로
 * 만들지 않고 클리핑으로 해결한다.
 *
 * 라벨 앞 세로 막대는 원본의 "▌" 글자를 그대로 쓰지 않고 CSS 사각형으로 그린다 — 서브셋
 * 폰트에 없는 특수문자가 텍스트를 통째로 지워버린 사고가 반복됐다(CLAUDE.md 참고).
 */
export function ReportBackCoverPage({ productInfo, onChange }: { productInfo: ProductInfo; onChange: (next: ProductInfo) => void }) {
  const year = (productInfo.coverDate?.trim().match(/\d{4}/)?.[0]) || String(new Date().getFullYear());
  const brand = productInfo.footerBrandName?.trim() || "alphabrothers";
  const rows: { label: string; field: "publisher" | "publisherContact" | "publisherAddress" }[] = [
    { label: "발행인", field: "publisher" },
    { label: "문　의", field: "publisherContact" },
    { label: "주　소", field: "publisherAddress" },
  ];
  return (
    <section data-front-page data-a4-page className="relative box-border h-[297mm] w-[210mm] overflow-hidden border border-[#dfe3e9] bg-white shadow-[0_12px_34px_rgba(28,39,55,.11)]">
      <div className="absolute inset-x-0 top-0 h-[150mm] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/rivalabs-cover-template.png" alt="" className="h-[297mm] w-full object-cover" />
      </div>
      <div className="absolute left-[26mm] top-[212mm] w-[160mm]">
        {rows.map((row) => (
          <p key={row.field} className="mb-[3.4mm] flex items-center text-[11pt] text-[#222]">
            <span aria-hidden className="mr-[2.5mm] inline-block h-[4.6mm] w-[1.1mm] shrink-0 bg-[#1b2c58]" />
            <span className="shrink-0 font-medium">{row.label}</span>
            <span
              contentEditable
              suppressContentEditableWarning
              onBlur={(event) => onChange({ ...productInfo, [row.field]: editableText(event) })}
              className="ml-[6mm] outline-none focus:bg-[#eef5ff]"
            >
              {productInfo[row.field]?.trim() || PUBLISHER_DEFAULTS[row.field]}
            </span>
          </p>
        ))}
        <p className="mt-[9mm] text-[9.5pt] text-[#8a8a8a]">Copyright {year} {brand}, All Right Reserved, Printed in Korea.</p>
      </div>
    </section>
  );
}

function automaticPages(sections: ReportSectionContent[], groups: PageGroups) {
  let nextPage = 3;
  return sections.map((section) => {
    const sectionPages = groups[section.numeral] ?? [section.blocks.map((block) => block.id)];
    const start = nextPage;
    nextPage += Math.max(sectionPages.length, 1);
    return { section, sectionPages, start };
  });
}

export function ReportTocPage({ sections, pageGroups, onSectionsChange }: {
  sections: ReportSectionContent[];
  pageGroups: PageGroups;
  onSectionsChange: (next: ReportSectionContent[]) => void;
}) {
  const pages = automaticPages(sections, pageGroups);
  const updateSection = (numeral: string, patch: Partial<ReportSectionContent>) => onSectionsChange(sections.map((section) => section.numeral === numeral ? { ...section, ...patch } : section));
  const updateHeading = (numeral: string, id: string, patch: Partial<ReportHeadingBlock>) => onSectionsChange(sections.map((section) => section.numeral !== numeral ? section : { ...section, blocks: section.blocks.map((block) => block.id === id && block.kind === "heading" ? { ...block, ...patch } : block) }));

  return (
    <section data-front-page data-a4-page className="relative box-border h-[297mm] w-[210mm] overflow-hidden border border-[#dfe3e9] bg-white px-[26mm] pb-[20mm] pt-[15mm] shadow-[0_12px_34px_rgba(28,39,55,.11)]">
      {/* 원본처럼 첫 행은 위쪽에 두고 마지막 행은 하단 쪽수 안전영역 위에서 끝낸다.
          장 사이 margin을 누적하면 글꼴/브라우저 배율에 따라 아래가 넘치거나 크게 비므로,
          242mm 가용 높이 안에서 9개 장 묶음을 균등 분배한다. */}
      <div className="flex h-[242mm] flex-col justify-between">
        {pages.map(({ section, sectionPages, start }) => {
          const headings = section.blocks.filter((block): block is ReportHeadingBlock => block.kind === "heading" && block.variant === "numbered");
          return <div key={section.numeral}>
            <div className="flex min-w-0 items-end text-[#075b9c]">
              <p className="shrink-0 whitespace-nowrap text-[14pt] font-bold"><span>{sectionRomanGlyph(section.numeral)}.</span> <span contentEditable suppressContentEditableWarning onBlur={(event) => updateSection(section.numeral, { title: editableText(event) })} className="outline-none focus:bg-[#eef5ff]">{section.title}</span></p>
              <span className="mx-[3mm] mb-[1.7mm] min-w-[8mm] flex-1 border-b border-dotted border-[#9a9a9a]" />
              <span contentEditable suppressContentEditableWarning onBlur={(event) => updateSection(section.numeral, { tocPageOverride: editableText(event) })} className="w-[8mm] text-right text-[10.5pt] text-[#222] outline-none focus:bg-[#eef5ff]">{section.tocPageOverride || section.tocPageNumber || start}</span>
            </div>
            {headings.map((heading, index) => {
              const pageOffset = Math.max(0, sectionPages.findIndex((ids) => ids.includes(heading.id)));
              return <div key={heading.id} className="mt-[1.4mm] flex min-w-0 items-end pl-[2mm] text-[#202020]">
                <p className="shrink-0 whitespace-nowrap text-[10.5pt]"><span>{heading.number || index + 1}.</span> <span contentEditable suppressContentEditableWarning onBlur={(event) => updateHeading(section.numeral, heading.id, { text: editableText(event) })} className="outline-none focus:bg-[#eef5ff]">{heading.text}</span></p>
                <span className="mx-[3mm] mb-[1.4mm] min-w-[8mm] flex-1 border-b border-dotted border-[#aaa]" />
                <span contentEditable suppressContentEditableWarning onBlur={(event) => updateHeading(section.numeral, heading.id, { tocPageOverride: editableText(event) })} className="w-[8mm] text-right text-[10pt] outline-none focus:bg-[#eef5ff]">{heading.tocPageOverride || heading.tocPageNumber || start + pageOffset}</span>
              </div>;
            })}
          </div>;
        })}
      </div>
      <p className="absolute bottom-[10mm] left-0 right-0 text-center text-[9pt] text-[#222]">- 2 -</p>
    </section>
  );
}
