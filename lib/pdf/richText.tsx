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
          return (
            <Text key={i} style={[styles.body, { fontWeight: "bold", marginTop: 4, marginBottom: 2 }, style]}>
              {content}
            </Text>
          );
        }
        if (block.kind === "arrow") {
          // 원본 관례는 굵게+기울임이지만, 이탤릭 폰트가 등록돼 있지 않아 fontStyle:"italic"을
          // 쓰면 즉시 렌더 에러가 난다(CLAUDE.md 기록) — 굵게만 쓴다.
          return (
            <Text key={i} style={[styles.body, { fontWeight: "bold", marginBottom: 2 }, style]}>
              → {content}
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
