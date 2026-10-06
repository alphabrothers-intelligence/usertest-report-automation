import type { Editor } from "@tiptap/core";

/**
 * **마지막으로 커서를 둔 이어진 편집기.** 상단 툴바(굵게·정렬·되돌리기 등)는 버튼을 누르는 순간
 * 포커스가 버튼으로 옮겨 가므로, 어느 장의 편집기에 명령을 보낼지 여기서 기억한다.
 * 편집기는 장마다 하나라 여러 개가 동시에 떠 있다(ChapterEditor가 focus/destroy 때 갱신).
 */
let active: Editor | null = null;

export function setActiveEditor(editor: Editor | null) {
  active = editor;
  // 검사 스크립트가 어느 장이 활성인지 볼 수 있게(개발 서버에서만).
  if (process.env.NODE_ENV !== "production") (globalThis as { __activeEditor?: Editor | null }).__activeEditor = editor;
}

export function forgetEditor(editor: Editor) {
  if (active === editor) active = null;
}

export function getActiveEditor(): Editor | null {
  return active && !active.isDestroyed ? active : null;
}

const SIZE_STEPS_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];

/** 툴바 명령을 편집기에 보낸다. 편집기가 없으면 false(옛 블록 화면은 기존 방식대로 처리한다). */
export function runEditorCommand(command: string): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const chain = editor.chain().focus();
  switch (command) {
    case "bold": chain.toggleBold().run(); return true;
    case "italic": chain.toggleItalic().run(); return true;
    case "underline": chain.toggleUnderline().run(); return true;
    case "bullet": chain.toggleBulletList().run(); return true;
    case "number": chain.toggleOrderedList().run(); return true;
    case "alignLeft": chain.setTextAlign("left").run(); return true;
    case "alignCenter": chain.setTextAlign("center").run(); return true;
    case "alignRight": chain.setTextAlign("right").run(); return true;
    case "sizeUp":
    case "sizeDown": {
      // 지금 크기(없으면 본문 기본 10pt)에서 한 단계 위/아래.
      const current = parseFloat(String(editor.getAttributes("textStyle").fontSize ?? "10pt")) || 10;
      const index = SIZE_STEPS_PT.findIndex((step) => step >= current);
      const at = index < 0 ? SIZE_STEPS_PT.length - 1 : index;
      const next = SIZE_STEPS_PT[Math.min(SIZE_STEPS_PT.length - 1, Math.max(0, at + (command === "sizeUp" ? 1 : -1)))];
      chain.setFontSize(`${next}pt`).run();
      return true;
    }
    case "arrow":
      // 제언 화살표 문단: 지금 문단 뒤에 굵은 기울임 "→ " 줄을 넣는다.
      chain.insertContentAt(editor.state.selection.$to.after(1), { type: "paragraph", content: [{ type: "text", text: "→ ", marks: [{ type: "bold" }, { type: "italic" }] }] }).run();
      return true;
    case "undo": chain.undo().run(); return true;
    case "redo": chain.redo().run(); return true;
    default: return false;
  }
}

/** 떠 있는 모든 장 편집기(ChapterEditor가 만들 때 넣고 없앨 때 뺀다). 문서 전체 교정은 여기를 돈다. */
const all = new Set<Editor>();
export function registerEditor(editor: Editor) { all.add(editor); }
export function unregisterEditor(editor: Editor) { all.delete(editor); forgetEditor(editor); }

/**
 * **인용문 글을 편집기 문서에서 바꾼다** — 끝맺음 교정·일괄 교정은 예전엔 블록 HTML만 고쳐서, 이어진
 * 편집기 화면에는 반영되지 않았다. 인용문 감싸기(`data-report-quote`, 원문은 `data-quote-text`)를 찾아
 * 첫 문단 글을 바꾸고 원문 속성도 새 글로 맞춘다. 반환값은 바꾼 인용문 수.
 */
export function replaceQuotesInEditors(replacements: Map<string, string>): number {
  let count = 0;
  for (const editor of all) {
    if (editor.isDestroyed) continue;
    const targets: { pos: number; attrs: Record<string, string>; text: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "reportDiv") return true;
      const attrs = node.attrs.attrs as Record<string, string>;
      if (!("data-report-quote" in attrs)) return true;
      const next = replacements.get(attrs["data-quote-text"] ?? "");
      if (next !== undefined) targets.push({ pos, attrs, text: next });
      return false;
    });
    if (targets.length === 0) continue;
    const tr = editor.state.tr;
    // 뒤에서부터 바꿔야 앞쪽 위치가 밀리지 않는다.
    for (const target of targets.reverse()) {
      const div = tr.doc.nodeAt(target.pos);
      const paragraph = div?.firstChild;
      if (!div || !paragraph) continue;
      const start = target.pos + 2;
      tr.replaceWith(start, start + paragraph.content.size, editor.schema.text(`“${target.text}”`));
      tr.setNodeMarkup(target.pos, undefined, { attrs: { ...target.attrs, "data-quote-text": encodeURIComponent(target.text) } });
      count += 1;
    }
    editor.view.dispatch(tr);
  }
  return count;
}

/**
 * **서버가 다시 만든 블록을 편집기 문서에 끼운다**(극성 재판정 등). 블록 번호 감싸기
 * (`data-report-block-id`)를 찾아 그 자리를 새 HTML로 바꾼다 — 그 블록 밖의 편집 내용은 그대로다.
 */
export function replaceBlockInEditors(blockId: string, html: string): boolean {
  return replaceBlock(blockId, html);
}

// 검사 스크립트(check:editor-links)가 교정 경로를 과금 없이 직접 불러 볼 수 있게(개발 서버에서만).
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __editorTools?: unknown }).__editorTools = { replaceQuotesInEditors: (pairs: [string, string][]) => replaceQuotesInEditors(new Map(pairs)) };
}

function replaceBlock(blockId: string, html: string): boolean {
  for (const editor of all) {
    if (editor.isDestroyed) continue;
    let found: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name === "reportDiv" && (node.attrs.attrs as Record<string, string>)["data-report-block-id"] === blockId) {
        found = { from: pos, to: pos + node.nodeSize };
        return false;
      }
      return true;
    });
    if (found) {
      editor.chain().insertContentAt(found, html).run();
      return true;
    }
  }
  return false;
}
