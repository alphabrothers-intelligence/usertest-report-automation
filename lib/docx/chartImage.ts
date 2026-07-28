// lib/charts/canvasCharts.ts가 만든 CanvasChart({buffer,width,height} — buffer는 이미 PNG)를
// docx ImageRun으로 감싼다. **2026-07-23 변경**: 기존엔 SVG 문자열을 만든 뒤 sharp로 PNG
// 변환하는 별도 단계가 있었는데(lib/docx/svgCharts.ts, 삭제됨), 이제 캔버스가 PNG를 직접
// 만들어주므로 이 파일은 단순히 이미지를 문단에 배치하는 역할만 한다.
import { AlignmentType, ImageRun, Paragraph } from "docx";
import type { CanvasChart } from "@/lib/charts/canvasCharts";

const PT_TO_PX = 96 / 72;

// 본문 섹션 페이지 폭(A4 595.28pt) - 좌우 여백(ReportDocx.ts의 content section margin,
// 1100 twips = 55pt씩)을 안전하게 하회하는 최대 표시 폭. 개별 차트 함수마다 폭을 손으로
// 맞추는 대신, 여기서 한 번에 안전 폭을 넘는 이미지는 종횡비를 유지한 채 축소한다(2026-07-23
// 실측 버그 — 처음 차트를 심었을 때 내부 폭을 그대로 썼다가 페이지 여백을 넘어 잘려나갔다).
const MAX_DISPLAY_WIDTH_PT = 470;

/** CanvasChart를 중앙 정렬된 이미지 단락으로 변환한다. */
export function chartParagraph(chart: CanvasChart): Paragraph {
  const scale = chart.width > MAX_DISPLAY_WIDTH_PT ? MAX_DISPLAY_WIDTH_PT / chart.width : 1;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [
      new ImageRun({
        type: "png",
        data: chart.buffer,
        transformation: {
          width: Math.round(chart.width * scale * PT_TO_PX),
          height: Math.round(chart.height * scale * PT_TO_PX),
        },
      }),
    ],
  });
}
