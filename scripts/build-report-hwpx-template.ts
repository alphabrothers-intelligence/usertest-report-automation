/**
 * 결과보고서 HWPX 양식(`public/hwpx/report-template.hwpx`)을 실제 발행본에서 뽑아낸다.
 *
 * 발행본(`data/[알파브라더스] 리바랩스_…_0904_상연.hwpx`)은 응답자 인용문이 들어 있어 커밋할 수 없다.
 * 그래서 **서식(header.xml)·표지·뒷표지·쪽 설정과 블록 원형 몇 개만** 남기고 본문 글자는 전부 지운다.
 * 원형 순서는 `lib/hwpx/publishedReport.ts`의 `PROTO`와 짝이다 — 바꾸면 둘 다 고칠 것.
 *
 * 실행: npx tsx scripts/build-report-hwpx-template.ts (data/ 원본 필요, 한 번만 돌리면 된다)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import JSZip from "jszip";
import { blocks } from "@/lib/survey/plan";

async function main() {
const name = readdirSync("data").find((f) => f.normalize("NFC").includes("리바랩스") && f.endsWith(".hwpx") && f.includes("0904"));
if (!name) throw new Error("data/에 리바랩스 발행본 hwpx가 없습니다.");
const src = await JSZip.loadAsync(readFileSync(`data/${name}`));
const read = (p: string) => src.file(p)!.async("string");

const section1 = await read("Contents/section1.xml");
const ps = blocks(section1, "p").map((s) => section1.slice(s.start, s.end));
const head = section1.slice(0, blocks(section1, "p")[0].start);
const blank = (xml: string) => xml.replace(/<hp:t>[^<]*<\/hp:t>/g, "<hp:t></hp:t>");

// 0 쪽 설정(secPr·쪽 번호) · 1 목차 · 2 장 배너 · 3 절 배너 · 4 본문 문단 · 5 문항 머리 · 6 문항 머리+척도 주석 · 7 [응답 결과] 그림 틀
const proto = [ps[0], blank(ps[3]), blank(ps[20]), blank(ps[33]), blank(ps[9]), blank(ps[21]), blank(ps[127]), blank(ps[22])];
const out = new JSZip();
out.file("mimetype", await read("mimetype"), { compression: "STORE" });
for (const p of ["version.xml", "settings.xml", "META-INF/container.xml", "META-INF/container.rdf", "META-INF/manifest.xml", "Contents/header.xml", "Contents/section2.xml"]) {
  out.file(p, await read(p));
}
let section0 = await read("Contents/section0.xml");
for (const [from, to] of [
  ["2025 by Alphabrothers", "{{YEAR}} by Alphabrothers"],
  ["발주처 l 정보통신산업진흥원 ", ""],
  ["사업명 l 2019 SW제품 시장성테스트 및 개선방안 수립 지원 사업", ""],
  [">리바랩스<", ">{{COMPANY}}<"],
  ["‘캣독런’", "‘{{SERVICE}}’"],
  [">2025.<", ">{{YEAR}}.<"],
  [">09.05<", ">{{MMDD}}<"],
]) {
  if (!section0.includes(from)) throw new Error(`표지에서 "${from}"를 못 찾았습니다.`);
  section0 = section0.replace(from, to);
}
out.file("Contents/section0.xml", section0);
out.file("Contents/section2.xml", (await read("Contents/section2.xml")).replace("Copyright 2025", "Copyright {{YEAR}}"));
out.file("Contents/section1.xml", head + proto.join("") + "</hs:sec>");
out.file("Preview/PrvText.txt", "사용성 테스트 결과보고서");

// 남기는 그림: header.xml이 쓰는 쪽 배경(image1~3)과 표지(image4)뿐
const keep = new Set(["image1", "image2", "image3", "image4"]);
let hpf = await read("Contents/content.hpf");
hpf = hpf.replace(/<opf:item id="(image\d+)"[^>]*\/>/g, (m, id) => (keep.has(id) ? m : ""))
  .replace(/<opf:item id="prv[^>]*\/>/gi, "")
  .replace(/<opf:title>[^<]*<\/opf:title>/, "<opf:title>사용성 테스트 결과보고서</opf:title>");
out.file("Contents/content.hpf", hpf);
for (const f of Object.keys(src.files)) {
  const id = f.match(/^BinData\/(image\d+)\./)?.[1];
  if (id && keep.has(id)) out.file(f, await src.file(f)!.async("uint8array"));
}

mkdirSync("public/hwpx", { recursive: true });
writeFileSync("public/hwpx/report-template.hwpx", await out.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/hwp+zip" }));
console.log("public/hwpx/report-template.hwpx 생성");
}

void main();
