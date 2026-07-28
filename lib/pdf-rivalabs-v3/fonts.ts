import path from "node:path";
import { Font } from "@react-pdf/renderer";

// 리바랩스 격리 렌더러는 맑은 고딕에 가까운 화면 인상의 Pretendard를 쓴다. 운영체제의
// 맑은 고딕/Apple SD Gothic Neo를 직접 참조하면 Vercel에서 달라지므로, public 아래의 정적
// 글꼴을 명시 등록한다. 일반 `bold`는 SemiBold에 연결해 표·차트 글자가 지나치게 두꺼워지는
// 것을 막고, 섹션 띠 제목처럼 정말 강조할 부분만 700(Bold)을 쓴다.
let registered = false;

export function registerFonts() {
  if (registered) return;
  const dir = path.join(process.cwd(), "public", "fonts", "pdf-rivalabs-v3");
  Font.register({
    family: "Pretendard Report",
    fonts: [
      { src: path.join(dir, "Pretendard-Regular.otf"), fontWeight: "normal" },
      { src: path.join(dir, "Pretendard-SemiBold.otf"), fontWeight: "bold" },
      { src: path.join(dir, "Pretendard-Bold.otf"), fontWeight: 700 },
    ],
  });
  // 한글은 음절 단위 분할 대신 공백으로 나뉜 어절 단위로만 줄바꿈한다. 예: "작성해주세 / 요"
  // 같은 부자연스러운 끊김을 막고, 길어지는 문장은 앞선 의미 단위에서 다음 줄로 보낸다.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
