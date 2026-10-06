"use client";

import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { createContext, useContext } from "react";
import type { ReportBlock } from "@/lib/report/sections";
import { BlockView } from "@/components/report-web-document/ReportBlockView";
import { SectionBanner } from "@/components/report-web-document/ReportDocumentChrome";
import { BANNER_ATOM_ID } from "@/lib/editor/toEditorHtml";

/**
 * 보고서 HTML의 **인라인 서식(배경색·여백·글자 크기)을 그대로 지닌다.** TipTap 기본 문단은
 * style을 버려서 극성 배너 색과 문단 간격이 사라진다 — 원본 양식 재현이 이 보고서의 핵심이다.
 */
export const KeepStyle = Extension.create({
  name: "keepStyle",
  addKeyboardShortcuts() {
    return {
      // 서식 있는 문단(배너 등) **맨 앞**에서 Enter → 그 위에 빈 문단을 넣어 내용 전체를 아래로 민다.
      // 기본 동작은 문단을 둘로 갈라 앞쪽에 빈 색 띠를 남겼다.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || !$from.parent.attrs.style || $from.parent.content.size === 0) return false;
        return editor.chain().insertContentAt($from.before(), { type: "paragraph" }).run();
      },
    };
  },
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading", "table", "tableRow", "tableCell", "tableHeader"],
      attributes: {
        // 그림·표 사이 자리 문단(toEditorHtml의 SPACER). 비어 있을 때만 낮게 그린다.
        spacer: {
          default: null,
          keepOnSplit: false,
          parseHTML: (element) => (element.hasAttribute("data-spacer") ? "" : null),
          renderHTML: (attributes) => (attributes.spacer !== null ? { "data-spacer": "" } : {}),
        },
        // 테두리 상자에 속한 문단(flattenBoxes). Enter로 나눠도 상자 안에 남는다.
        box: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-box"),
          renderHTML: (attributes) => (attributes.box ? { "data-box": attributes.box } : {}),
        },
        style: {
          default: null,
          // Enter로 문단을 나눌 때 **뒤 문단에는 서식을 물려주지 않는다** — 극성 배너 끝에서 Enter를
          // 치면 색 띠가 하나 더 생겼다(2026-10-01 담당자 지적). 새 줄은 평범한 문단이다.
          keepOnSplit: false,
          parseHTML: (element) => element.getAttribute("style"),
          renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
        },
      },
    }];
  },
});

/** 문서 안 그림(제목·차트·도넛 상자)이 그릴 블록을 찾아 주는 곳. */
export type AtomContextValue = {
  blocks: Map<string, ReportBlock>;
  numeral: string;
  title: string;
  onBlockChange: (next: ReportBlock) => void;
  /** 그림을 누르면 오른쪽 수정 탭이 그 블록을 연다(기존 웹뷰와 같다). */
  onSelectBlock?: (blockId: string) => void;
  sourceFileUrl?: string | null;
};
export const AtomContext = createContext<AtomContextValue | null>(null);

function AtomView({ node }: ReactNodeViewProps) {
  const context = useContext(AtomContext);
  const id = node.attrs.blockId as string;
  if (!context) return <NodeViewWrapper />;
  if (id === BANNER_ATOM_ID) {
    return <NodeViewWrapper contentEditable={false}><SectionBanner numeral={context.numeral} title={context.title} /></NodeViewWrapper>;
  }
  const block = context.blocks.get(id);
  return (
    <NodeViewWrapper contentEditable={false} data-atom-id={id} data-report-block-id={id} className="my-1" onClick={() => context.onSelectBlock?.(id)}>
      {block ? <BlockView block={block} onChange={context.onBlockChange} sourceFileUrl={context.sourceFileUrl} /> : null}
    </NodeViewWrapper>
  );
}

/** 구조가 정해진 블록을 문서 안의 그림 하나로 넣는다. 커서는 그 앞뒤로 지나간다. */
export const ReportAtom = Node.create({
  name: "reportAtom",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { blockId: { default: null, parseHTML: (element) => element.getAttribute("data-report-atom") } };
  },
  parseHTML() {
    return [{ tag: "div[data-report-atom]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-report-atom": HTMLAttributes.blockId })];
  },
  addKeyboardShortcuts() {
    /** 커서 바로 앞/뒤가 그림이면 Backspace/Delete가 **그림을 지우지 않게** 한다 — Word에서 표 다음
     * 문단 맨 앞의 Backspace가 표를 지우지 않는 것과 같다(2026-10-01: 배너 앞 Backspace로 표가 사라졌다).
     * 빈 문단이면 그 문단만 지워 아래 내용을 끌어올린다. 그림 자체는 클릭해 선택한 뒤 지운다. */
    const guard = (direction: "backward" | "forward") => () => {
      const { state } = this.editor;
      const { $from, empty } = state.selection;
      if (!empty) return false;
      const atEdge = direction === "backward" ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
      if (!atEdge || $from.depth === 0) return false;
      const neighbour = direction === "backward"
        ? state.doc.resolve($from.before()).nodeBefore
        : state.doc.resolve($from.after()).nodeAfter;
      if (neighbour?.type.name !== this.name) return false;
      if ($from.parent.content.size === 0) {
        return this.editor.chain().deleteRange({ from: $from.before(), to: $from.after() }).run();
      }
      return true;
    };
    /** 그림과 그림 사이(빈 칸 커서)나 선택된 그림에서 Enter → 그 자리에 빈 줄을 넣어 아래를 민다. */
    const enterAtGap = () => {
      const { selection } = this.editor.state;
      const isGap = selection instanceof GapCursor || (selection instanceof NodeSelection && selection.node.type.name === this.name);
      if (!isGap) return false;
      return this.editor.chain().insertContentAt(selection.from, { type: "paragraph" }).run();
    };
    return { Backspace: guard("backward"), Delete: guard("forward"), Enter: enterAtGap };
  },
  addNodeView() {
    // 그림 안의 편집칸(제목 글자 등)이 자체 contentEditable을 쓰므로 그 안의 입력은 편집기가 가로채지 않는다.
    return ReactNodeViewRenderer(AtomView, { stopEvent: () => true });
  },
});

/**
 * **표식이 붙은 감싸기 요소를 문서 안에 보존한다** — 인용문 묶음(`data-quote-group`), 인용문 원문
 * (`data-report-quote`·`data-quote-text`), 극성 확인 묶음(`data-quote-category`), 해석 상자
 * (`data-analysis-evidence`), 블록 번호(`data-report-block-id`). 편집기 기본 문서는 `div`를 버려서
 * 왼쪽 근거 패널이 읽는 위치·인용 원문·극성 확인을 못 찾았다. 속성은 하나도 바꾸지 않고 그대로 낸다.
 */
const KEPT_DIV = /^(data-quote-group|data-report-quote|data-quote-category|data-quote-section|data-analysis-evidence|data-report-block-id)$/;
export const ReportDiv = Node.create({
  name: "reportDiv",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      attrs: {
        default: {},
        parseHTML: (element) => Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value])),
        renderHTML: (attributes) => attributes.attrs as Record<string, string>,
      },
    };
  },
  parseHTML() {
    return [{
      tag: "div",
      getAttrs: (element) => ([...(element as HTMLElement).attributes].some((attribute) => KEPT_DIV.test(attribute.name)) && !(element as HTMLElement).hasAttribute("data-report-atom") ? null : false),
    }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes, 0];
  },
});

/** 쪽 나누기(Word의 Ctrl+Enter). 화면에는 점선 한 줄로만 보이고, 다음 내용은 새 쪽에서 시작한다. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return ["div", { "data-page-break": "", class: "editor-page-break", contenteditable: "false" }];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.chain().focus().insertContent({ type: this.name }).run(),
    };
  },
});
