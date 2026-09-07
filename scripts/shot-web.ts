/**
 * 웹뷰를 실제로 렌더해서 눈으로 확인하는 도구. Playwright가 설치돼 있지 않은 환경이라
 * **시스템 Chrome을 CDP로 직접 몰아** 찍는다(새 의존성 0개).
 *
 *   npm run shot:web -- "<url>" <출력.png> [뷰포트폭] [sel:<CSS 선택자>]
 *
 * 마지막 인자에 `sel:`을 주면 그 요소가 읽는 위치(뷰포트 32%)에 오도록 스크롤한 뒤 찍는다 —
 * 왼쪽 `분석 근거` 패널이 스크롤 위치로 바뀌므로 그 자리에서 봐야 실제 화면이 나온다.
 *
 * **`chrome --headless --screenshot`(CLI 한 줄)은 이 화면에서 멈춘다** — 스크롤 rAF 루프가
 * 계속 돌아 virtual-time이 끝나지 않기 때문. 그래서 CDP로 붙어 고정 시간 뒤에 캡처한다.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [url, out, widthArg, scrollArg] = process.argv.slice(2);
const width = Number(widthArg ?? 1440);
const scrollY = Number(scrollArg ?? 0);

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9333",
    `--window-size=${width},1000`, "--user-data-dir=/tmp/cdp-profile", "about:blank",
  ], { stdio: "ignore" });
  const target = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      try {
        const list = await (await fetch("http://127.0.0.1:9333/json/list")).json() as { webSocketDebuggerUrl: string; type: string }[];
        const page = list.find((t) => t.type === "page");
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

  await send("Page.enable");
  await send("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 9000));
  if (scrollArg?.startsWith("sel:")) {
    const selector = scrollArg.slice(4);
    await send("Runtime.evaluate", { expression:
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "없음";
         const rect = el.getBoundingClientRect(); const top = rect.top + rect.height / 2 + window.scrollY - window.innerHeight * 0.32;
         window.scrollTo(0, top); return "ok"; })()`, returnByValue: true });
    await new Promise((resolve) => setTimeout(resolve, 2500));
  } else if (scrollY) {
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollY})` });
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  const shot = await send("Page.captureScreenshot", { format: "png" }) as { data: string };
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  const info = await send("Runtime.evaluate", {
    expression: `JSON.stringify({ h: document.body.scrollHeight, panel: !!document.querySelector('[data-quote-category]'), flags: document.querySelectorAll('[data-polarity-review]').length })`,
    returnByValue: true,
  }) as { result?: { value?: string } };
  console.log(info.result?.value ?? "");
  socket.close();
  chrome.kill();
  process.exit(0);
}
void main();
