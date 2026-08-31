/**
 * 레이아웃 L14 — 경쟁재(타사 서비스) 비교표. 단계 S3(타사 서비스 경험 조사).
 *
 * 원본 2종을 150dpi 픽셀로 실측해 서식을 맞췄다(2026-08-26): 이젠오토 8쪽 `[ 만족 기능 응답
 * 결과 ]`(서비스명/장점/단점 3열), 케어클 9쪽(브랜드명/제품명/장점/단점 4열). **두 원본 모두
 * 제목행만 파랑(#c0cdef)이고 머리글·라벨 열은 회색이며 테두리도 회색이다** — 문항 표(파란
 * 테두리)와 다르므로 `dataTableCss()` 토큰을 쓰지 않고 여기서 따로 정의한다.
 *
 * **이 표에 들어가는 값은 raw data 원문이 아니다.** 원자료는 응답자별 자유서술이고
 * (이젠오토 26~29번, 정리습관 34~38번 컬럼에 서비스명·장점·단점이 별도 컬럼으로 있다),
 * 원본 표의 행 이름("마이클", "기타 출장 서비스")과 짧은 불릿은 그 45건을 **서비스별로 묶고
 * 요약한 결과**다. 묶기·요약은 정성 단계의 일이고, 이 파일은 그 결과를 원본 서식으로 그린다.
 */
import { REPORT_TEXT, tablePalette } from "@/lib/report/sectionStyle";
import { richStaticBlock, type ReportRichStaticBlock } from "@/lib/report/sections";

/** 이젠오토 8쪽·케어클 9쪽 공통 실측값. */
const L14 = {
  headerBackground: "#f2f2f2",
  border: "0.75pt solid #a3a3a3",
  /** 열 너비도 두 원본의 세로 테두리 x좌표에서 재서 넣었다(150dpi). 라벨 열을 넉넉히 주지
   * 않으면 "현대차 점검 예약"이 어색하게 쪼개진다(실측). */
  widths3: ["14%", "36%", "50%"],
  widths4: ["12.5%", "19%", "33%", "35.5%"],
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 셀 안 불릿 목록. 한글 붙여넣기에서 목록 태그보다 문단이 안정적이라 `<p>`로 낸다
 * (`overviewBulletsHtml`과 같은 관례). 빈 배열이면 빈 칸으로 둔다 — 원본에서 "없습니다."는
 * 응답자가 실제로 그렇게 쓴 값이므로 렌더러가 지어내지 않는다. */
function bulletCell(items: string[]): string {
  return items
    .map((item) => `<p style="margin:0 0 3pt;padding-left:10pt;text-indent:-8pt">· ${escapeHtml(item)}</p>`)
    .join("");
}

export type CompetitorRow = {
  /** 서비스명(또는 브랜드명). 자유서술을 묶은 대표 이름이다. */
  service: string;
  /** 케어클 원본처럼 제품명 열이 따로 있는 raw data에서만 채운다. 비면 열 자체를 그리지 않는다. */
  product?: string;
  pros: string[];
  cons: string[];
};

export function competitorComparisonBlock(params: {
  id: string;
  title?: string;
  /** 게이팅(경험 있음) 뒤 유효 응답자 수. 카탈로그가 "표 옆에 반드시 명시"를 요구한다 —
   * 앞 문항 전체 응답자 수와 크게 차이 나서 안 적으면 비율을 오해한다. */
  respondentCount?: number;
  rows: CompetitorRow[];
}): ReportRichStaticBlock {
  const title = params.title ?? "만족 기능 응답 결과";
  // 제품명 열은 그 값을 가진 raw data에서만 나온다(케어클). 없으면 3열로 그린다.
  const hasProduct = params.rows.some((row) => row.product?.trim());
  const headers = hasProduct ? ["브랜드명", "제품명", "장점", "단점"] : ["서비스명", "장점", "단점"];
  const widths = hasProduct ? L14.widths4 : L14.widths3;
  const headCell = `background-color:${L14.headerBackground};border:${L14.border};padding:5pt;text-align:center;font-weight:700`;
  const head = (label: string, index: number) => `<th style="${headCell};width:${widths[index]}">${label}</th>`;
  const labelCell = (text: string) => `<td style="${headCell};vertical-align:middle">${escapeHtml(text)}</td>`;
  const bodyCell = (html: string) =>
    `<td style="border:${L14.border};padding:6pt 8pt;vertical-align:middle">${html}</td>`;

  const note = params.respondentCount === undefined
    ? ""
    : `<p style="margin:0 0 3pt;text-align:right;font-size:${REPORT_TEXT.noteFontSize}pt;color:#111827">* 유효 응답자 ${params.respondentCount}명 (경험 있음 응답자만)</p>`;

  const rows = params.rows.map((row) =>
    `<tr>${labelCell(row.service)}${hasProduct ? labelCell(row.product ?? "") : ""}${bodyCell(bulletCell(row.pros))}${bodyCell(bulletCell(row.cons))}</tr>`,
  ).join("");

  return richStaticBlock({
    id: params.id,
    html: `${note}<table style="border-collapse:collapse;width:100%;table-layout:fixed;color:#111827;font-size:${REPORT_TEXT.bodyFontSize}pt;margin:0 0 10pt">`
      + `<thead><tr><th colspan="${headers.length}" style="background-color:${tablePalette(0).title};border:${L14.border};padding:5pt;text-align:center;font-weight:700">[ ${escapeHtml(title)} ]</th></tr>`
      + `<tr>${headers.map((label, index) => head(label, index)).join("")}</tr></thead>`
      + `<tbody>${rows}</tbody></table>`,
  });
}