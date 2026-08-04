// LLM이 만든 Markdown 강조(**굵게**, __밑줄__, `[제목]`, `#` 헤딩, `→`/`▶` 제언, `-`/`•` 불릿)를
// PDF Text 트리로 변환한다. lib/report/richText.ts의 parseRichText가 이미 웹/DOCX/HWPX가
// 공유하는 파서이므로 그대로 재사용하고, PDF 전용 렌더러만 새로 추가한다(2026-08-03).
//
// **실측 버그(같은 날 발견): 이 렌더러가 없어서 Ⅳ장 "해석"·Ⅸ장 제언·결과요약 셀에 `**굵게**`/
// `__밑줄__`/`# 제목` 마크다운이 글자 그대로 노출되고 있었다** — 담당자가 실제 생성 PDF를
// 열어보고서야 발견(코드 리뷰·정량 미리보기로는 안 잡힘, 정성 분석 실제 데이터가 있어야 보임).
//
// **강조에 색을 쓰지 않는다(2026-08-03 사용자 명시 지적)**: 예전 CategoryBlock의 insight
// 텍스트는 `colors.tealDark`(녹색)를 썼는데, 원본 발행 보고서엔 강조 텍스트에 색이 전혀 없다 —
// 전부 검정 굵게/밑줄만 쓴다. 이 렌더러도 fontWeight/textDecoration만 바꾸고 color는 절대
// 건드리지 않는다.
import { Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { parseRichText, type RichTextRun } from "@/lib/report/richText";
import { styles } from "./theme";

// "※"(U+203B)는 서브셋 WOFF 폰트에 없어 렌더 시 사라지거나 깨진다(CLAUDE.md에 이미 기록된
// "폰트에 없는 특수 유니코드가 텍스트를 지운다" 버그의 재발 사례, 2026-08-03 실측). 검증된
// 안전한 "•"로 치환한다 — 프롬프트 문구 자체(recommendation.ts)는 건드리지 않는다.
function sanitizeGlyphs(text: string): string {
  return text.replace(/※/g, "•");
}

function RunText({ run }: { run: RichTextRun }) {
  return (
    <Text
      style={{
        fontWeight: run.bold ? "bold" : undefined,
        textDecoration: run.underline ? "underline" : undefined,
      }}
    >
      {sanitizeGlyphs(run.text)}
    </Text>
  );
}

/** LLM 생성 텍스트(마크다운 강조 포함)를 문단/불릿/제목 블록으로 렌더링한다.
 * `styles.body`와 같은 자리에 드롭인으로 쓸 수 있다. */
export function RichText({ value, style = {} }: { value: string; style?: Style }) {
  const blocks = parseRichText(value);
  return (
    <View>
      {blocks.map((block, i) => {
        if (block.empty) return <View key={i} style={{ height: 4 }} />;
        const content = <Text>{block.runs.map((run, j) => <RunText key={j} run={run} />)}</Text>;
        if (block.kind === "heading") {
          // parseRichText는 "[제목]" 한 줄을 heading으로 분류하며 대괄호를 판별용 마커로 보고
          // 벗겨낸다(runs에는 안쪽 텍스트만 남음) — bullet의 "•"/arrow의 "→"는 이 렌더러가
          // 이미 다시 붙이는데 heading만 빠져 있었다(2026-08-04 실측: hwpx 원본은 "[전반적
          // 만족도 경향]"처럼 대괄호가 실제로 화면에 보이는 텍스트인데, PDF는 대괄호 없이
          // 굵은 글자만 남아 있었다). level 2(원문 "[...]" 한 줄짜리)만 대괄호를 복원한다 —
          // level 1(# 헤딩)은 원래 대괄호 문법이 아니었으므로 건드리지 않는다.
          return (
            <Text key={i} style={[styles.body, { fontWeight: "bold", marginTop: 4, marginBottom: 2 }, style]}>
              {block.level === 2 ? <>[{content}]</> : content}
            </Text>
          );
        }
        if (block.kind === "arrow") {
          // 원본 관례는 굵게+기울임이지만, 이탤릭 폰트가 등록돼 있지 않아 fontStyle:"italic"을
          // 쓰면 즉시 렌더 에러가 난다(CLAUDE.md 기록) — 굵게만 쓴다.
          // **"→"(U+2192)는 이 서브셋 폰트에서 "'"(작은 따옴표)로 보이는 mojibake가 난다**
          // (2026-08-04 실측 — 최소 재현 스크립트로 직접 렌더링해 확인. pdftotext 추출에서도
          // "’"로 나와 시각적 버그와 텍스트 추출 버그가 같은 원인임을 확인했다. CLAUDE.md에
          // "→는 검증된 안전한 문자"라고 잘못 기록돼 있었다 — 실제로는 아니었다, 이 문서를
          // 갱신할 것). 여러 대체 문자를 직접 렌더링 비교해 "›"(U+203A)만 정상 렌더됨을
          // 확인했다(">", "->", "•", "·"도 안전하지만 "›"가 원본의 화살표 뉘앙스에 가장 가깝다).
          return (
            <Text key={i} style={[styles.body, { fontWeight: "bold", marginBottom: 2 }, style]}>
              › {content}
            </Text>
          );
        }
        if (block.kind === "bullet") {
          return (
            <Text key={i} style={[styles.body, { marginBottom: 1 }, style]}>
              • {content}
            </Text>
          );
        }
        return (
          <Text key={i} style={[styles.body, { marginBottom: 4 }, style]}>
            {content}
          </Text>
        );
      })}
    </View>
  );
}
