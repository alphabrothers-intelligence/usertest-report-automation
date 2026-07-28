/**
 * 원본/생성 PDF의 같은 페이지를 JPEG로 렌더링한 뒤 OpenAI 시각 QA를 실행한다.
 * 예: npx tsx --env-file=.env.local scripts/check-visual-layout.ts 6
 * 사전 준비: pdftoppm으로 tmp/pdfs/review/original-06.jpg,
 *          tmp/pdfs/quant-preview/page-06.jpg 생성
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { reviewVisualLayout } from "../lib/layoutQa/openai";

async function main() {
  const page = Number(process.argv[2] ?? "6");
  if (!Number.isInteger(page) || page < 1) throw new Error("페이지 번호는 1 이상의 정수여야 합니다.");
  const id = String(page).padStart(2, "0");
  const referencePath = path.join(process.cwd(), "tmp", "pdfs", "review", `original-${id}.jpg`);
  const generatedPath = path.join(process.cwd(), "tmp", "pdfs", "quant-preview", `page-${id}.jpg`);
  const review = await reviewVisualLayout({
    pageNumber: page,
    referenceImage: readFileSync(referencePath),
    generatedImage: readFileSync(generatedPath),
  });
  console.log(JSON.stringify(review, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
