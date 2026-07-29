// 채팅 어시스턴트의 일반 텍스트 메시지(카드가 아닌 설명·전환 문구)에만 쓰는 경량 마크다운
// 렌더러. 카드가 이미 보여주는 데이터를 텍스트로 재요약하지 말라는 원칙(app/api/chat/route.ts
// 시스템 프롬프트)은 그대로 유지하되, 실제로 쓰이는 설명 문구(예: "다음 단계로 넘어갈까요?")는
// 볼드 등 최소한의 서식을 지원해 Claude.ai 채팅처럼 읽기 편하게 한다. dangerouslySetInnerHTML을
// 쓰지 않고 순수 React 노드만 만들어서 별도 sanitize 없이도 안전하다.
import { Fragment, useState } from "react";

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={`${keyPrefix}-${i}`} className="rounded bg-[#f0ede7] px-1 py-0.5 text-[0.92em] text-[#554e46]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="min-w-0 space-y-2 text-[15px] leading-7 text-[#38322d]">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === "") return <div key={i} className="h-1.5" />;
        if (/^#{1,3}\s+/.test(trimmed)) {
          return (
            <h2 key={i} className="pt-2 text-base font-semibold text-[#26211d]">
              {renderInline(trimmed.replace(/^#{1,3}\s+/, ""), `${i}`)}
            </h2>
          );
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("· ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span aria-hidden className="text-[#8b8378]">
                •
              </span>
              <span>{renderInline(trimmed.slice(2), `${i}`)}</span>
            </div>
          );
        }
        if (/^\d+[.)]\s+/.test(trimmed)) {
          return <div key={i} className="pl-1">{renderInline(trimmed, `${i}`)}</div>;
        }
        return <p key={i}>{renderInline(line, `${i}`)}</p>;
      })}
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
