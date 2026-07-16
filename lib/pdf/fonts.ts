import path from "node:path";
import { Font } from "@react-pdf/renderer";

// PRD 8장: 한글 폰트(Noto Sans KR)는 명시적으로 등록해야 한다(기본 폰트로는 한글이 깨짐).
// public/fonts/ 아래 정적 파일을 쓴다 — Next.js가 항상 public/을 배포에 포함하므로
// (node_modules 경로를 직접 참조하면 Vercel 서버리스 파일 트레이싱에서 누락될 위험이 있다).
let registered = false;

export function registerFonts() {
  if (registered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "Noto Sans KR",
    fonts: [
      { src: path.join(dir, "NotoSansKR-Regular.woff"), fontWeight: "normal" },
      { src: path.join(dir, "NotoSansKR-Bold.woff"), fontWeight: "bold" },
    ],
  });
  registered = true;
}
