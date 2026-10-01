/**
 * 로컬 Chrome을 헤드리스로 띄워 CDP로 조종한다. **쪽 나눔 검사들이 공유한다** —
 * `check:page-fit`(인쇄해서 쪽수를 센다)과 `check:edit-reflow`(글을 넣고 다시 나뉘는지 본다)가
 * 같은 플러밍을 각자 들고 있으면 한쪽만 고쳐진다. LLM·과금 없음.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export type ChromeSession = {
  /** CDP 원문 호출. */
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** 페이지에서 식을 평가해 값을 받는다. */
  evaluate: <T>(expression: string) => Promise<T>;
  /** 그 주소를 열고 쪽 나눔(실제 렌더 높이 측정 → 재나눔)이 멈출 때까지 기다린다. */
  open: (url: string) => Promise<void>;
  /** 카드 수가 더 안 바뀔 때까지 기다린다(편집 뒤 재나눔을 기다릴 때도 쓴다). */
  settle: () => Promise<number>;
  /** 크롬 프로필 폴더(PDF 같은 임시 파일을 여기에 둔다). */
  profile: string;
  close: () => void;
};

/**
 * **디버깅 포트는 매번 새로 뽑는다.** 고정 포트를 쓰면, 앞선 실행이 남긴 크롬이 그 포트를 잡고
 * 있을 때 새 크롬은 포트를 못 잡고 **스크립트가 남의 크롬에 붙는다** — 이쪽 명령이 그 창에
 * 안 먹으니 에러 없이 영영 기다린다(2026-09-14 실측: 검사가 20분 넘게 멈춰 있었고 붙은 창은
 * `about:blank`였다).
 */
export async function openChrome(): Promise<ChromeSession> {
  const port = 9200 + Math.floor(Math.random() * 700);
  const profile = mkdtempSync(path.join(tmpdir(), "chrome-check-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
    "--window-size=1600,1000", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });

  const target = await (async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { webSocketDebuggerUrl: string; type: string }[];
        const page = list.find((item) => item.type === "page");
        if (page) return page;
      } catch { /* 아직 안 떴다 */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Chrome CDP에 붙지 못했습니다.");
  })();

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolve) => {
    const messageId = ++id;
    const listener = (event: MessageEvent) => {
      const payload = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
      if (payload.id === messageId) { socket.removeEventListener("message", listener); resolve(payload.result ?? {}); }
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });

  const evaluate = async <T>(expression: string): Promise<T> => {
    const out = await send("Runtime.evaluate", { expression, returnByValue: true }) as { result?: { value?: T } };
    return out.result?.value as T;
  };

  /**
   * **정해진 시간을 기다리지 말고 멈출 때까지 기다린다.** 쪽 나눔은 재서 자르고 다시 재는 일을
   * 몇 차례 도는데, 그 횟수는 데이터 양에 따라 다르다. 15초 고정으로 두었더니 설문 문항이 많은
   * raw data(투블럭)에서 아직 그리는 중에 재서 "카드가 하나도 없다"로 실패했다(2026-09-14).
   */
  const settle = async (): Promise<number> => {
    let stable = 0;
    let last = -1;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const cards = await evaluate<number>(`document.querySelectorAll('[data-section-page]').length`);
      // 문서가 "이번 바퀴에 아무것도 안 바꿨다"고 표시했을 때만 안정으로 센다 — 카드 수는
      // 그대로인 채 블록만 갈리는 중인 상태에서 인쇄하면 결과가 실행마다 달라진다.
      const settled = await evaluate<boolean>(`document.documentElement.dataset.layoutSettled === "1"`);
      if (cards > 0 && cards === last && settled) stable += 1;
      else stable = 0;
      last = cards;
      // 차트·이미지가 뒤늦게 자리를 잡아 한 번 더 나뉘는 일이 있어 넉넉히 본다.
      if (stable >= 10) return cards;
    }
    return last;
  };

  await send("Page.enable");
  return {
    send,
    evaluate,
    profile,
    settle,
    open: async (url) => { await send("Page.navigate", { url }); await settle(); },
    close: () => { socket.close(); chrome.kill(); },
  };
}

/** 웹뷰 카드 중 A4(297mm)를 넘긴 것 — 넘치면 인쇄에서 브라우저가 쪼개 PDF가 웹뷰와 달라진다. */
export const OVERSIZED_CARDS_EXPRESSION = `JSON.stringify([...document.querySelectorAll('[data-section-page]')]
  .map((card, index) => ({ index, numeral: card.dataset.sectionPage, mm: +(card.getBoundingClientRect().height / (96 / 25.4)).toFixed(1),
    first: card.querySelector('[data-report-block-id]')?.dataset.reportBlockId }))
  .filter((card) => card.mm > 297.5))`;
