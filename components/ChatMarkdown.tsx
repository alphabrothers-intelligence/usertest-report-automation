// 채팅 어시스턴트의 일반 텍스트 메시지(카드가 아닌 설명·전환 문구)에만 쓰는 경량 마크다운
// 렌더러. 카드가 이미 보여주는 데이터를 텍스트로 재요약하지 말라는 원칙(app/api/chat/route.ts
// 시스템 프롬프트)은 그대로 유지하되, 실제로 쓰이는 설명 문구(예: "다음 단계로 넘어갈까요?")는
// 볼드 등 최소한의 서식을 지원해 Claude.ai 채팅처럼 읽기 편하게 한다. dangerouslySetInnerHTML을
// 쓰지 않고 순수 React 노드만 만들어서 별도 sanitize 없이도 안전하다.
import { Fragment, useState } from "react";
import { writeRichClipboard } from "@/components/RichReportEditor";
import { richTextToClipboardHtml } from "@/lib/report/richText";
import { downloadRtf } from "@/lib/report/rtfClipboard";

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const [copyNotice, setCopyNotice] = useState("");
  // 정성 분석처럼 실제 보고서 본문으로 옮길 수 있는 Markdown 결과에만 액션을 노출한다.
  // 단순 안내 문구마다 복사 버튼이 생기면 채팅 흐름을 방해하므로 `**`, `__`, 화살표,
  // 대괄호 소제목 중 하나가 있을 때만 보인다.
  const isReportText = /\*\*|__|^\s*(?:→|▶|\[[^\]]+\])/m.test(text);

  async function copyForHancom() {
    try {
      await writeRichClipboard(richTextToClipboardHtml(text));
      setCopyNotice("한글용 실제 서식으로 복사했습니다.");
    } catch {
      setCopyNotice("복사에 실패했습니다. 한글 서식 파일을 사용하세요.");
    }
  }

  function downloadForHancom() {
    downloadRtf(richTextToClipboardHtml(text), "정성분석_서식본문");
    setCopyNotice("한글 서식 파일을 내려받았습니다.");
  }

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === "") return null;
        if (trimmed.startsWith("- ") || trimmed.startsWith("· ")) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span aria-hidden className="text-zinc-400">
                •
              </span>
              <span>{renderInline(trimmed.slice(2), `${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(line, `${i}`)}</div>;
      })}
      {isReportText && (
        <div data-copy-ignore className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <button type="button" onClick={() => void copyForHancom()} className="rounded border border-[#315c9c] px-2.5 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">한글 서식 복사</button>
          <button type="button" onClick={downloadForHancom} className="rounded bg-[#315c9c] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#294c81]">한글 서식 파일</button>
          {copyNotice && <span className="text-xs text-zinc-500">{copyNotice}</span>}
        </div>
      )}
    </div>
  );
}

const COLLAPSE_LINE_THRESHOLD = 6;

/**
 * 사용자가 긴 메시지를 보내면 채팅창이 그 텍스트로 다 채워져 아래 카드들을 보려면 한참
 * 스크롤해야 하는 문제(2026-07-20 피드백, Claude.ai 벤치마킹) — 일정 줄 수를 넘으면
 * "더보기"/"접기"로 접어둔다. 어시스턴트 메시지는 이미 카드 요약을 우선하는 원칙이 있어
 * 대체로 짧으므로, 사용자 메시지 렌더링에만 쓴다.
 */
export function CollapsibleChatMarkdown({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const isLong = lines.length > COLLAPSE_LINE_THRESHOLD;
  const shown = expanded || !isLong ? text : lines.slice(0, COLLAPSE_LINE_THRESHOLD).join("\n");

  return (
    <div>
      <ChatMarkdown text={shown} />
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {expanded ? "접기" : "더보기"}
        </button>
      )}
    </div>
  );
}
