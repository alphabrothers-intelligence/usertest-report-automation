// 컬럼 프로파일러를 data/ 의 실제 raw data 5종에 돌려 형태 판정이 맞는지 본다.
// LLM·DB 호출 없음. `npm run check:column-profile`.
//
// 기대값은 각 raw data를 직접 열어 확인한 것이다(2026-08-26). 여기서 보는 것은 "문항이
// 무엇을 묻는가"(역할)가 아니라 **"어떤 형태인가"**(척도·단일선택·순위·자유서술·메타)뿐이다 —
// 역할 판정은 다음 단계(AI)의 일이고, 이 단계가 틀리면 그쪽도 같이 틀리므로 먼저 고정한다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns, type ColumnProfile } from "../lib/agent/profile";

const DATA = path.join(process.cwd(), "data");

type Expect = { index: number; type: ColumnProfile["type"]; scaleMax?: number; reasonFor?: number; note: string };
type Dataset = { name: string; file: string; expects: Expect[]; reasonColumns?: number };

const DATASETS: Dataset[] = [
  {
    name: "리바랩스",
    file: "[리바랩스]사용성테스트 raw data.xlsx",
    expects: [
      { index: 1, type: "scale", scaleMax: 100, note: "나이(숫자 입력 — 척도 아님은 역할 단계에서 가름)" },
      { index: 2, type: "single", note: "성별" },
      { index: 6, type: "scale", scaleMax: 10, note: "'펫과의 산책' 기능 만족도" },
      { index: 7, type: "text", reasonFor: 6, note: "헤더가 `이유` 두 글자뿐인 이유 컬럼" },
      { index: 18, type: "rank", note: "기능 중요도 1순위" },
      { index: 29, type: "text", reasonFor: 28, note: "핵심요인(선택형) 뒤의 이유 — 헤더 문구로 잡힌다" },
      { index: 58, type: "text", note: "개선 아이디어" },
    ],
    // 척도 21개(나이 제외)의 이유 + 핵심요인 이유 1개. `이유` 헤더 수와 일치한다.
    reasonColumns: 22,
  },
  {
    name: "케어클",
    file: "[케어클] 사용성테스트 raw data.csv",
    expects: [
      { index: 25, type: "single", note: "다른 홈케어 디바이스 경험 유무(게이팅)" },
      // 선택형 뒤의 짧은 단답이라 이유 컬럼이 아니다 — 위치 규칙이 이것까지 삼키면 안 된다.
      { index: 26, type: "text", reasonFor: undefined, note: "어떤 디바이스를 써봤나(제품명 자유서술)" },
      { index: 27, type: "scale", scaleMax: 10, note: "경험 제품 만족도 — 값에 9·10이 있어 10점 척도다(내 최초 기대값 5점은 오류였다)" },
      { index: 28, type: "text", reasonFor: 27, note: "이유(장점·단점이 한 컬럼에 섞임)" },
    ],
  },
  {
    name: "이젠오토",
    file: "[WALLA]_[이젠오토]_사용성_고객반응_설문조사_oS1LD_2608031228.csv",
    expects: [
      { index: 9, type: "single", note: "셀프 정비 경험 수준(1~3단계)" },
      { index: 10, type: "scale", scaleMax: 10, note: "'고장 내용 진단' 기능 만족도" },
      { index: 26, type: "single", note: "타사 서비스 경험 유무(게이팅)" },
      { index: 28, type: "text", note: "경험 서비스의 장점" },
      { index: 29, type: "text", note: "경험 서비스의 단점" },
      // 종합 만족도 척도 바로 뒤에 오는 긴 서술이지만 **이유가 아니라 개선 아이디어**다.
      // 위치만 보면 이유로 잡혀 개선 아이디어 절이 통째로 사라진다(실측 2026-08-26).
      { index: 45, type: "text", reasonFor: undefined, note: "개선 아이디어(척도 뒤 긴 서술이지만 이유 아님)" },
    ],
    reasonColumns: 13,
  },
  {
    name: "정리습관",
    file: "[WALLA]_[정리습관]_사용성_고객반응_설문조사_2a2KD_2608031225.csv",
    expects: [
      { index: 34, type: "single", note: "유사 서비스 이용 경험(게이팅)" },
      // raw data 자체의 헤더 오류: 36·37번 헤더가 똑같은데 36번에는 점수가, 37번에 실제
      // 서술이 들어 있다(WALLA 복사 흔적). 프로파일러는 헤더가 아니라 **값**으로 판정하므로
      // 이런 어긋남도 그대로 드러난다 — 이 검사가 그걸 고정한다.
      { index: 36, type: "scale", note: "헤더는 '만족스러웠던 점'인데 값은 점수다(원본 데이터 오류)" },
      { index: 37, type: "text", note: "실제 장점 서술" },
      { index: 38, type: "text", note: "아쉬웠던 점(단점)" },
    ],
  },
  {
    // 종속 컬럼 헤더가 부모 문항 문구를 그대로 되풀이하는 유일한 데이터셋 — 위치 규칙의 근거다.
    name: "투블럭에이아이",
    file: "알파브라더스_투블럭에이아이_사용성테스트_2회차_RAW_data.csv",
    expects: [
      { index: 10, type: "scale", scaleMax: 10, note: "Q1 '마이 홈' 만족도" },
      { index: 11, type: "text", reasonFor: 10, note: "같은 Q1 문구로 시작하는 종속 서술" },
    ],
    reasonColumns: 10,
  },
];

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label} — 기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
  if (ok) pass += 1; else fail += 1;
}

for (const dataset of DATASETS) {
  const buffer = readFileSync(path.join(DATA, dataset.file));
  // parseWallaWorkbook은 SheetJS를 쓰므로 xlsx·csv를 모두 읽는다.
  const { headerRow, dataRows } = parseWallaWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const profiles = profileColumns(headerRow, dataRows);
  const counts = profiles.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.type]: (acc[p.type] ?? 0) + 1 }), {});
  console.log(`\n=== ${dataset.name} — 컬럼 ${profiles.length}개 / 응답 ${dataRows.length}명 ===`);
  console.log(`  형태 분포: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`  이유 컬럼(정성 대상 후보): ${profiles.filter((p) => p.reasonFor !== undefined).length}개`);

  for (const expect of dataset.expects) {
    const profile = profiles[expect.index];
    check(`[${expect.index}] ${expect.note}`, profile?.type, expect.type);
    if (expect.scaleMax !== undefined) check(`[${expect.index}] 척도 상한`, profile?.scaleMax, expect.scaleMax);
    // `reasonFor: undefined`는 "이유 컬럼이 아니어야 한다"는 기대다 — 키 존재로 가른다.
    if ("reasonFor" in expect) check(`[${expect.index}] 이유 대상 컬럼`, profile?.reasonFor, expect.reasonFor);
  }
  if (dataset.reasonColumns !== undefined) {
    check(`이유 컬럼 수`, profiles.filter((p) => p.reasonFor !== undefined).length, dataset.reasonColumns);
  }
}

console.log(`\n=== 요약: ${pass}/${pass + fail} PASS ===`);
process.exit(fail === 0 ? 0 : 1);