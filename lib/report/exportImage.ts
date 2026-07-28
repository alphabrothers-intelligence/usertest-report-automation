/**
 * 차트/표를 PNG로 내보내는 공유 헬퍼. 이전엔 `ReportWebDocument.tsx` 안에 `downloadChart`
 * (SVG를 읽어 래스터화)와 `downloadBarChart`(같은 시각을 SVG 문자열로 별도로 다시 만들어
 * 래스터화)가 서로 독립적으로 중복 구현돼 있었다 — 하나로 합친다(2026-07-25 재구성).
 */

function triggerDownload(blob: Blob, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function rasterizeSvgMarkup(markup: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("canvas 2d context 생성 실패"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error("PNG 인코딩 실패"));
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG 래스터화 실패"));
    };
    image.src = url;
  });
}

/** 차트(SVG 루트 엘리먼트)를 PNG Blob으로 만든다 — 화면에 보이는 SVG를 그대로 직렬화한다. */
export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const viewBox = svg.viewBox.baseVal;
  const cropTop = Math.max(0, Number(svg.getAttribute("data-export-crop-top") || 0));
  const svgWidth = viewBox.width || svg.clientWidth || 640;
  const exportHeight = Math.max(1, (viewBox.height || svg.clientHeight || 320) - cropTop);
  const width = svgWidth * scale;
  const height = exportHeight * scale;
  // 화면용 제목 밴드는 유지하고, 저장본에는 그래프만 남긴다.
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.querySelectorAll("[data-export-exclude]").forEach((node) => node.remove());
  if (cropTop > 0) copy.setAttribute("viewBox", `${viewBox.x} ${viewBox.y + cropTop} ${svgWidth} ${exportHeight}`);
  const markup = new XMLSerializer().serializeToString(copy);
  return rasterizeSvgMarkup(markup, width, height);
}

export async function downloadSvgAsPng(svg: SVGSVGElement, filename: string, scale = 2) {
  const blob = await svgToPngBlob(svg, scale);
  triggerDownload(blob, filename);
}

const TABLE_FONT_FAMILY = "'맑은 고딕', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

/**
 * 표를 PNG로 만든다. **처음엔 SVG `<foreignObject>`로 표 HTML을 감싸 `<img>`로 래스터화하는
 * 방식을 썼는데, 실제 브라우저 실측(2026-07-25)에서 `canvas.toBlob()`이 항상
 * `"Tainted canvases may not be exported"`로 실패하는 게 확인됐다** — Chrome은
 * `foreignObject`가 포함된 SVG를 `drawImage`한 캔버스를 무조건 오염(tainted) 처리한다(같은
 * origin의 blob URL이어도 예외 없음, 브라우저의 의도된 보안 정책). `html2canvas` 같은 외부
 * 라이브러리도 이 정책을 피해가진 못해 내부적으로 DOM을 직접 캔버스에 다시 그리는 방식을
 * 쓴다 — 우리도 같은 원리로, 표의 실제 셀 텍스트를 `ctx.fillText`/`ctx.strokeRect`로 직접
 * 그린다(이미지 로드 단계 자체가 없어 오염 문제가 원천적으로 발생하지 않는다). 이 프로젝트가
 * PDF 차트에서 이미 쓰는 "정확한 폭 계산을 위해 직접 캔버스에 그린다"는 원칙과 같은 방식이다
 * (CLAUDE.md `lib/charts/canvasCharts.ts` 참고).
 */
export async function tableToPngBlob(table: HTMLTableElement, scale = 2): Promise<Blob> {
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children).map((cell) => ({
      text: (cell.textContent || "").trim(),
      isHeader: cell.tagName === "TH",
    })),
  );
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  const fontSize = 13;
  const padding = 10;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) throw new Error("canvas 2d context 생성 실패");

  const colWidths = new Array(colCount).fill(60);
  for (const row of rows) {
    row.forEach((cell, i) => {
      measureCtx.font = `${cell.isHeader ? "bold " : ""}${fontSize}px ${TABLE_FONT_FAMILY}`;
      colWidths[i] = Math.max(colWidths[i], measureCtx.measureText(cell.text).width + padding * 2);
    });
  }
  const rowHeight = fontSize + padding * 2;
  const width = colWidths.reduce((sum, w) => sum + w, 0);
  const height = rowHeight * rows.length;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 생성 실패");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#d4d4d8";
  ctx.lineWidth = 1;

  let y = 0;
  for (const row of rows) {
    let x = 0;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      const colWidth = colWidths[i];
      if (cell.isHeader) {
        // #f4f4f5 — EditableTable 화면 헤더색과 동일하게(2026-07-25, 예전엔 #c0cdef로 화면과
        // PNG 내보내기 색이 서로 달랐다).
        ctx.fillStyle = "#f4f4f5";
        ctx.fillRect(x, y, colWidth, rowHeight);
      }
      ctx.strokeRect(x, y, colWidth, rowHeight);
      ctx.fillStyle = "#111827";
      ctx.font = `${cell.isHeader ? "bold " : ""}${fontSize}px ${TABLE_FONT_FAMILY}`;
      ctx.fillText(cell.text, x + padding, y + rowHeight / 2, colWidth - padding * 2);
      x += colWidth;
    }
    y += rowHeight;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 인코딩 실패"))), "image/png");
  });
}

export async function downloadTableAsPng(table: HTMLTableElement, filename: string, scale = 2) {
  const blob = await tableToPngBlob(table, scale);
  triggerDownload(blob, filename);
}

/**
 * 지정한 컨테이너 안의 `[data-report-export]` 요소를 전부 PNG로 만들어 ZIP 하나로 묶어
 * 다운로드한다("이 섹션 차트·표 ZIP 다운로드", 2026-07-25 확정 — 현재 보고 있는 섹션 범위만).
 * `jszip`은 이미 프로젝트 의존성에 있다(package.json 확인, 새로 추가하지 않음).
 */
export async function downloadSectionExportsAsZip(container: HTMLElement, zipFilename: string) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-report-export]"));
  const exportedSvgs = new Set<SVGSVGElement>();
  let index = 0;
  for (const node of nodes) {
    index += 1;
    const kind = node.getAttribute("data-report-export");
    const name = (node.getAttribute("data-report-export-name") || `${kind}-${index}`).replace(/[\\/:*?"<>|]/g, "_");
    // data-report-export는 실제 그릴 대상(svg/table)을 감싼 바깥 div에 붙인다 — 안쪽의
    // 진짜 요소를 찾아 각자 맞는 방식으로 래스터화한다(차트=svgToPngBlob, 표=tableToPngBlob).
    const target = kind === "chart" ? node.querySelector("svg") : node.querySelector("table");
    if (!target) continue; // 방어적 스킵 — 대상을 못 찾으면 건너뛴다
    if (kind === "chart") exportedSvgs.add(target as SVGSVGElement);
    const blob = kind === "chart" ? await svgToPngBlob(target as SVGSVGElement) : await tableToPngBlob(target as HTMLTableElement);
    zip.file(`${name}.png`, blob);
  }

  // 원본 재현용 정적 블록에도 실제 SVG 차트가 들어간다(도넛·만족도 분포 등).
  // 이들은 편집형 차트처럼 data-report-export 래퍼가 없으므로, 섹션 ZIP에서도
  // 빠지지 않게 원본 SVG 자체만 별도 저장한다. 바깥 제목/연보라색 띠는 SVG 밖의
  // HTML이므로 PNG에는 포함되지 않는다.
  const staticSvgs = Array.from(container.querySelectorAll<SVGSVGElement>("svg"))
    .filter((svg) => !exportedSvgs.has(svg));
  for (const svg of staticSvgs) {
    index += 1;
    const blob = await svgToPngBlob(svg);
    zip.file(`그래프-${index}.png`, blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, zipFilename);
}
