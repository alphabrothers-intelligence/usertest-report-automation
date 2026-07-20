// 채팅 어시스턴트의 일반 텍스트 메시지(카드가 아닌 설명·전환 문구)에만 쓰는 경량 마크다운
// 렌더러. 카드가 이미 보여주는 데이터를 텍스트로 재요약하지 말라는 원칙(app/api/chat/route.ts
// 시스템 프롬프트)은 그대로 유지하되, 실제로 쓰이는 설명 문구(예: "다음 단계로 넘어갈까요?")는
// 볼드 등 최소한의 서식을 지원해 Claude.ai 채팅처럼 읽기 편하게 한다. dangerouslySetInnerHTML을
// 쓰지 않고 순수 React 노드만 만들어서 별도 sanitize 없이도 안전하다.
import { Fragment } from "react";

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
    </div>
  );
}
