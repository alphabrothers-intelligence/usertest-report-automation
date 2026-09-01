// 문항 확인 카드 **미리보기 HTML**을 만든다. `npm run render:review-cards` → `tmp/review-cards.html`.
//
// docs/AGENT_PIPELINE_GUIDE.md 6장이 정한 카드 형식(① 문항 → ② 실제 응답 → ③ 시스템 분류 →
// ④ 왜 → ⑤ 고치기)을 **실제 raw data와 실제 저장된 판정으로** 그려서, 만들기 전에 담당자가
// 형태를 눈으로 볼 수 있게 하는 용도다.
//
// **LLM을 부르지 않는다.** 판정은 `reports.role_plan`에 이미 저장된 것을 읽는다(demo:* 4종).
// DB는 필요하다 — `tsx --env-file=.env.local`.
//
// 이건 **미리보기이지 제품 화면이 아니다.** 실제 화면은 `ReportPlanCard` 안 접이식 섹션으로
// 들어가고 ⑤가 `saveRoleOverride()`를 부른다(6장 "어디에 붙일 것인가").
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { profileColumns, type ColumnProfile } from "../lib/agent/profile";
import { applyOverrides, readRolePlan } from "../lib/agent/rolePlan";
import { buildSectionPlan } from "../lib/agent/sectionPlan";
import { toSectionPlanInput } from "../lib/agent/classify";
import { STAGE_OF_ROLE } from "../lib/agent/toQuantStats";
import type { QuestionRole } from "../lib/agent/sectionPlan";
import { sql } from "../lib/db/client";

const DEMOS = [
  { key: "carecl", name: "케어클", file: "[케어클] 사용성테스트 raw data.csv" },
  { key: "ezenauto", name: "이젠오토", file: "[WALLA]_[이젠오토]_사용성_고객반응_설문조사_oS1LD_2608031228.csv" },
  { key: "cleanhabit", name: "정리습관", file: "[WALLA]_[정리습관]_사용성_고객반응_설문조사_2a2KD_2608031225.csv" },
  { key: "twoblock", name: "투블럭에이아이", file: "알파브라더스_투블럭에이아이_사용성테스트_2회차_RAW_data.csv" },
];

/**
 * **화면에는 개발 용어를 한 글자도 쓰지 않는다**(6장 규칙). `feature`·`single`·`groupKey`·
 * `confidence`는 전부 금지어라, 역할도 형태도 여기서 실무자 말로 바꿔서만 내보낸다.
 */
const ROLE_LABEL: Record<QuestionRole, string> = {
  demographic: "응답자 정보 (나이·성별 등)",
  context: "제품을 쓰기 전의 습관",
  prior_service: "다른 서비스를 써본 경험",
  feature: "기능 만족도",
  task_flow: "이용 단계별 만족도",
  journey: "시점별 경험 (첫인상 → 사용 후)",
  purchase_factor: "구매 결정 요인",
  value: "가치 영역 만족도",
  ux_quality: "경험 품질 척도 (양끝 표현)",
  overall: "전반적인 만족도",
  intent: "추천 의향 (NPS)",
  improvement: "개선 아이디어",
  meta: "보고서에 넣지 않음",
};

/** ②를 쓰는 말. "보기 중 하나를 고른 값"도 어렵다는 지적이 있어(6장) 값을 그대로 보여준다. */
function answerShape(profile: ColumnProfile, respondents: number): { summary: string; sample: string } {
  const answered = Math.round(respondents * (1 - profile.blankRate));
  const who = profile.blankRate > 0.2
    ? `${answered}명 응답 (${respondents}명 중 ${respondents - answered}명은 답하지 않음)`
    : `${answered}명 전원 응답`;
  switch (profile.type) {
    case "scale":
      return { summary: `${who} · ${profile.scaleMax ?? 10}점 만점`, sample: rangeChips(profile.scaleMax ?? 10) };
    case "single":
    case "multi":
    case "rank":
      return {
        summary: `${who} · ${profile.uniqueCount}가지 답변`,
        sample: (profile.options ?? []).map((option) => `<span class="chip">${escape(option)}</span>`).join("") || "—",
      };
    default:
      // **자유서술 원문은 절대 보여주지 않는다** — 개인적인 내용이 섞인다. 성격만 쓴다.
      return { summary: `${who} · ${profile.uniqueCount}가지 서로 다른 답`, sample: `<span class="muted">직접 입력한 글 · 평균 ${Math.round(profile.avgLength)}자 (내용은 표시하지 않습니다)</span>` };
  }
}

const rangeChips = (max: number) =>
  Array.from({ length: max + 1 }, (_, i) => `<span class="chip chip-score">${i}</span>`).join("") + `<span class="muted"> 중 하나</span>`;

/**
 * ④ — **"형태가 맞지 않습니다" 같은 추상 문장 대신 사실 두 줄을 나란히 놓는다**(6장 규칙).
 *
 * 저장된 `note`는 AI 근거와 코드가 잡은 위반이 ` · `로 이어붙은 것인데, 위반 쪽 문구가
 * 개발 용어(`역할 journey과 형태 single이 맞지 않음`)라 그대로 쓸 수 없다. 지금 5종에서
 * 실제로 나오는 종류만 옮긴다 — **새 위반 종류가 생기면 여기에 한 줄을 더한다.**
 */
function conflictLines(note: string, profile: ColumnProfile, role: QuestionRole): string[] {
  const lines: string[] = [];
  if (/형태가? 맞지 않음|형태 \w+이 맞지 않음/.test(note)) {
    lines.push(`이 분류의 응답은 ${expectedShape(role)}이어야 합니다.`);
    lines.push(`그런데 이 문항의 응답은 ${actualShape(profile)}입니다.`);
  }
  if (/계열 접두/.test(note)) {
    lines.push("이 설문의 다른 경험 품질 문항은 앞에 묶음 이름이 붙어 있습니다 (예: <code>실용성1) 조작 편의성</code>).");
    lines.push("이 문항만 묶음 이름이 없어, 여러 문항을 한 그림에 겹쳐 그리는 차트에서 빠집니다.");
  }
  if (/결측\s*\d+%/.test(note)) {
    const rate = /결측\s*(\d+)%/.exec(note)?.[1];
    lines.push(`${rate}%가 답하지 않았습니다 — 앞 문항에서 "경험 있음"이라고 답한 사람만 받은 문항으로 보입니다.`);
  }
  if (/#\d+\s*(의)?\s*이유/.test(note)) {
    lines.push("앞 문항의 <strong>이유</strong>를 묻는 문항으로 봤습니다. 앞 문항과 같은 곳으로 함께 들어갑니다.");
  }
  // 시점 강등 — **이 카드가 가장 중요하다.** 시점 문항이 3개 모이면 「고객 여정」 장이 통째로
  // 생기므로(가이드 8.4 ④), 근거 없는 판정 하나가 없던 장을 만든다. 그래서 이 경우만 코드가
  // 역할까지 내리는데, 그 사실을 담당자가 모르면 "왜 여정 장이 없지"가 된다.
  if (/시간 표현/.test(note)) {
    lines.push("AI는 이 문항을 <strong>시점별 경험</strong>으로 봤습니다.");
    lines.push("그런데 문항에 <strong>“첫인상”, “처음 사용”, “1주 후”처럼 시점을 가리키는 말이 없습니다.</strong>");
    lines.push("시점 문항이 3개 이상 모이면 「고객 여정」 장이 통째로 생깁니다. 근거 없이 장을 만들지 않으려고 <strong>이용 단계별 만족도로 낮췄습니다.</strong> 실제로 시점 문항이 맞다면 여기서 되돌려 주세요.");
  }
  if (lines.length === 0) {
    lines.push("시스템이 이 판정을 확신하지 못했습니다 — 문항 문구만으로는 판단이 갈리는 종류입니다.");
    lines.push("위 ①②를 보고 맞으면 그대로 두시고, 아니면 ⑤에서 바꿔 주세요.");
  }
  return lines;
}

const expectedShape = (role: QuestionRole) =>
  role === "feature" || role === "task_flow" || role === "journey" || role === "value" || role === "ux_quality" || role === "overall" || role === "intent"
    ? "0~10점 같은 <strong>점수</strong>"
    : "보기에서 고른 <strong>값</strong>";

const actualShape = (profile: ColumnProfile) => {
  if (profile.type === "scale") return "<strong>점수</strong>";
  if (profile.type === "text") return "<strong>직접 입력한 글</strong>";
  if (profile.type === "meta") return "<strong>사람마다 거의 다 다른 값</strong>(집계할 수 없습니다)";
  const first = (profile.options ?? []).slice(0, 2).map((o) => `"${o}"`).join(", ");
  return `<strong>보기에서 고른 값</strong>${first ? ` (${first} …)` : ""}`;
};

/**
 * AI가 쓴 근거만 남긴다 — 뒤에 이어붙은 코드 위반 문구는 ④의 ⚠ 줄이 따로 옮겨 쓴다.
 *
 * **근거 문장 안에 역할 이름이 영어로 박혀 있다**("체험 기간 중 사용 실태(주기)는 journey").
 * 프롬프트가 역할 이름으로 사고하니 당연한 결과인데, 화면에는 개발 용어를 한 글자도 쓰지
 * 않는다는 규칙이 있으므로 여기서 실무자 말로 바꿔서 내보낸다.
 */
function aiReason(note: string): string | undefined {
  const raw = note.split(" · ").find((part) => !/맞지 않음|계열 접두|결측|시간 표현|순서가 겹|이유$/.test(part))?.trim();
  // `unassigned`는 역할이 아니라 "판단 못 함"이라는 탈출구인데(가이드 2단계) 근거 문장에는
  // 역할처럼 섞여 나온다. 같이 옮겨야 화면에 영어가 안 남는다.
  const words: Record<string, string> = { ...ROLE_LABEL, unassigned: "판단 못 함" };
  return raw?.replace(new RegExp(`\\b(${Object.keys(words).join("|")})\\b`, "g"), (word) => `‘${words[word]}’`);
}

/**
 * ③ "이 문항이 몇 장으로 가는가". 새 매핑표를 만들지 않고 **역할 → 단계 이름**
 * (`STAGE_OF_ROLE`)에 장 제목을 잇는다 — 둘은 같아야 한다는 규칙이 이미 있다.
 *
 * 다만 **장 제목은 데이터에 따라 늘어난다**(타사 문항이 있으면 `인적 사항 및 특성 조사` →
 * `인적 사항 및 특성·경험 조사`). 포함 관계로도 안 걸리므로 앞 네 글자까지 같으면 같은
 * 장으로 본다 — 표준 목차의 장 제목은 앞머리가 서로 겹치지 않는다.
 *
 * **장이 아니라 절인 역할도 있다**(`improvement` → 「개선 아이디어」는 종합 만족도 장의 2절).
 * 「개선 아이디어」라고만 쓰면 어디로 가는지 모르므로 절도 같이 찾는다.
 */
function chapterLabelOf(
  chapters: { numeral: string; title: string; sections: { number: number; title: string }[] }[],
  role: QuestionRole,
): string | null {
  const stage = STAGE_OF_ROLE[role];
  if (!stage) return null;
  const chapter = chapters.find((c) => c.title === stage || c.title.includes(stage) || stage.includes(c.title))
    ?? chapters.find((c) => c.title.slice(0, 4) === stage.slice(0, 4));
  if (chapter) return `${chapter.numeral}장 「${chapter.title}」`;
  for (const candidate of chapters) {
    const section = candidate.sections.find((s) => s.title.includes(stage));
    if (section) return `${candidate.numeral}장 「${candidate.title}」의 ${section.number}절 「${section.title}」`;
  }
  return `「${stage}」`;
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

async function buildDataset(demo: (typeof DEMOS)[number]): Promise<string> {
  const plan = await readRolePlan(`demo:${demo.key}`);
  if (!plan) return `<section class="dataset" data-key="${demo.key}"><p class="empty">저장된 판정이 없습니다. <code>/viewer?dataset=${demo.key}</code>를 한 번 열면 만들어집니다.</p></section>`;

  const buffer = readFileSync(path.join(process.cwd(), "data", demo.file));
  const { headerRow, dataRows } = parseWallaWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const profiles = profileColumns(headerRow, dataRows);
  const profileOf = new Map(profiles.map((profile) => [profile.index, profile]));
  const classification = applyOverrides(plan);
  const chapters = buildSectionPlan(toSectionPlanInput(classification, plan.profiles, dataRows)).chapters;
  const chapterOf = (role: QuestionRole) => chapterLabelOf(chapters, role);

  const needsReview = classification.questions.filter((question) => question.confidence < 0.7);
  const settled = classification.questions.filter((question) => question.confidence >= 0.7);

  const roleOptions = (selected: QuestionRole) =>
    (Object.keys(ROLE_LABEL) as QuestionRole[])
      .map((role) => `<option value="${role}"${role === selected ? " selected" : ""}>${ROLE_LABEL[role]}</option>`)
      .join("");

  const cards = needsReview.map((question) => {
    const profile = profileOf.get(question.columnIndex);
    if (!profile) return "";
    const shape = answerShape(profile, dataRows.length);
    const destination = chapterOf(question.role);
    const reason = aiReason(question.note ?? "");
    return `
    <article class="card">
      <header class="card-head">
        <span class="badge">확인 필요</span>
        <span class="col">${question.columnIndex + 1}번째 열</span>
      </header>

      <div class="step">
        <div class="step-no">1</div>
        <div class="step-body">
          <div class="step-title">설문 문항</div>
          <p class="question">${escape(oneLine(profile.header)) || '<span class="muted">(제목 없음)</span>'}</p>
        </div>
      </div>

      <div class="step">
        <div class="step-no">2</div>
        <div class="step-body">
          <div class="step-title">실제 응답은 이렇게 생겼습니다</div>
          <p class="meta">${shape.summary}</p>
          <div class="chips">${shape.sample}</div>
        </div>
      </div>

      <div class="step">
        <div class="step-no">3</div>
        <div class="step-body">
          <div class="step-title">시스템은 이렇게 분류했습니다</div>
          <p class="verdict">${ROLE_LABEL[question.role]}</p>
          <p class="dest" data-dest>${destination ? `→ ${destination}에 들어갑니다.` : "→ 보고서에 넣지 않습니다."}</p>
        </div>
      </div>

      <div class="step">
        <div class="step-no">4</div>
        <div class="step-body">
          <div class="step-title">왜 그렇게 판단했나</div>
          ${reason ? `<p class="quote">“${escape(reason)}”</p>` : ""}
          <ul class="conflict">${conflictLines(question.note ?? "", profile, question.role).map((line) => `<li>${line}</li>`).join("")}</ul>
        </div>
      </div>

      <div class="step step-fix">
        <div class="step-no">5</div>
        <div class="step-body">
          <div class="step-title">이 문항의 역할</div>
          <select data-role-select>${roleOptions(question.role)}</select>
          <p class="hint" data-hint>바꾸면 들어가는 장이 여기에 표시됩니다.</p>
        </div>
      </div>
    </article>`;
  }).join("");

  const settledRows = settled.map((question) => {
    const destination = chapterOf(question.role);
    return `<tr>
      <td class="num">${question.columnIndex + 1}</td>
      <td>${escape(oneLine(profileOf.get(question.columnIndex)?.header ?? "").slice(0, 60))}</td>
      <td class="role">${ROLE_LABEL[question.role]}</td>
      <td class="dest-cell">${destination ?? "보고서에 넣지 않음"}</td>
    </tr>`;
  }).join("");

  return `
  <section class="dataset" data-key="${demo.key}">
    <div class="summary">
      <div>
        <strong>${demo.name}</strong> · 전체 ${classification.questions.length}문항 중
        <strong class="hl">${needsReview.length}개</strong>만 확인이 필요합니다.
      </div>
      <div class="actions">
        <button class="ghost">확인 없이 이대로 진행</button>
        <button class="primary">이 목차로 보고서 만들기</button>
      </div>
    </div>
    <p class="note-line">고치지 않아도 그대로 진행됩니다. 이 화면은 승인 게이트가 아니라 표시·보조입니다.</p>
    ${cards || '<p class="empty">확인이 필요한 문항이 없습니다.</p>'}
    <details class="settled">
      <summary>확인이 끝난 문항 ${settled.length}개 보기</summary>
      <table><thead><tr><th>열</th><th>설문 문항</th><th>분류</th><th>들어가는 곳</th></tr></thead>
      <tbody>${settledRows}</tbody></table>
    </details>
  </section>`;
}

const STYLE = `
:root { --line:#e4e4e7; --ink:#18181b; --muted:#71717a; --blue:#315c9c; --paleblue:#dfe6f7; --warn:#c2410c; --palewarn:#fff1e7; }
* { box-sizing:border-box }
body { margin:0; padding:28px 20px 60px; background:#f4f4f5; color:var(--ink);
  font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif; font-size:14px; line-height:1.6 }
.wrap { max-width:840px; margin:0 auto }
h1 { font-size:20px; margin:0 0 6px }
.lead { color:var(--muted); margin:0 0 20px }
.tabs { display:flex; gap:6px; margin-bottom:18px; flex-wrap:wrap }
.tabs button { border:1px solid var(--line); background:#fff; border-radius:999px; padding:6px 14px; cursor:pointer; font:inherit }
.tabs button[aria-selected="true"] { background:var(--blue); border-color:var(--blue); color:#fff; font-weight:700 }
.dataset { display:none } .dataset.on { display:block }
.summary { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;
  background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px 16px }
.hl { color:var(--warn) }
.actions { display:flex; gap:8px }
button.ghost { border:1px solid var(--line); background:#fff; border-radius:6px; padding:7px 12px; cursor:pointer; font:inherit }
button.primary { border:1px solid var(--blue); background:var(--blue); color:#fff; border-radius:6px; padding:7px 14px; cursor:pointer; font:inherit; font-weight:700 }
.note-line { color:var(--muted); font-size:13px; margin:8px 2px 16px }
.card { background:#fff; border:1px solid var(--line); border-left:4px solid var(--warn); border-radius:10px; padding:4px 18px 16px; margin-bottom:14px }
.card-head { display:flex; align-items:center; gap:8px; padding:12px 0 6px; border-bottom:1px dashed var(--line); margin-bottom:6px }
.badge { background:var(--palewarn); color:var(--warn); font-size:12px; font-weight:700; border-radius:4px; padding:2px 8px }
.col { color:var(--muted); font-size:12px }
.step { display:flex; gap:12px; padding:10px 0 }
.step + .step { border-top:1px solid #f4f4f5 }
.step-no { flex:none; width:22px; height:22px; border-radius:50%; background:var(--paleblue); color:var(--blue);
  font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; margin-top:2px }
.step-body { flex:1; min-width:0 }
.step-title { font-size:12px; font-weight:700; color:var(--muted); letter-spacing:.02em; margin-bottom:4px }
.question { margin:0; font-size:15px; font-weight:700; line-height:1.5 }
.meta { margin:0 0 6px; color:var(--muted); font-size:13px }
.chips { display:flex; flex-wrap:wrap; gap:4px }
.chip { background:#f4f4f5; border:1px solid var(--line); border-radius:4px; padding:2px 8px; font-size:13px }
.chip-score { min-width:28px; text-align:center; font-variant-numeric:tabular-nums }
.verdict { margin:0; font-weight:700; font-size:15px; color:var(--blue) }
.dest { margin:2px 0 0; color:var(--muted); font-size:13px }
.quote { margin:0 0 6px; color:#3f3f46; font-size:13px; background:#fafafa; border-left:2px solid var(--line); padding:6px 10px }
.conflict { margin:0; padding-left:0; list-style:none }
.conflict li { position:relative; padding-left:20px; font-size:13.5px; margin-bottom:2px }
.conflict li:before { content:"!"; position:absolute; left:0; top:0; width:15px; height:15px; border-radius:50%;
  background:var(--palewarn); color:var(--warn); font-size:11px; font-weight:700; text-align:center; line-height:15px; margin-top:3px }
.step-fix { background:#fafbfd; margin:6px -18px -16px; padding:12px 18px 14px; border-radius:0 0 8px 8px; border-top:1px solid var(--line) }
select { font:inherit; padding:7px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; max-width:100%; min-width:260px }
.hint { margin:6px 0 0; font-size:13px; color:var(--blue) }
.muted { color:var(--muted) }
code { background:#f4f4f5; border-radius:3px; padding:1px 4px; font-size:12.5px }
.settled { margin-top:18px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 16px }
.settled summary { cursor:pointer; font-weight:700; color:var(--muted) }
.settled table { width:100%; border-collapse:collapse; margin-top:10px; font-size:13px }
.settled th { text-align:left; color:var(--muted); font-weight:700; border-bottom:1px solid var(--line); padding:6px 8px }
.settled td { border-bottom:1px solid #f4f4f5; padding:6px 8px; vertical-align:top }
.settled .num { color:var(--muted); width:36px } .settled .role { white-space:nowrap } .settled .dest-cell { color:var(--muted); white-space:nowrap }
.empty { color:var(--muted); background:#fff; border:1px dashed var(--line); border-radius:10px; padding:20px; text-align:center }
`;

// ⑤에서 역할을 바꾸면 "어디로 가는지"가 즉시 바뀌는 것까지 보여준다 — 실무자가 판단하는
// 근거가 결국 이 한 줄이라, 미리보기에서도 살아 있어야 형태를 제대로 볼 수 있다.
const SCRIPT = `
const DEST = __DEST__;
const show = (key) => {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.key === key)));
  document.querySelectorAll(".dataset").forEach((d) => d.classList.toggle("on", d.dataset.key === key));
};
document.querySelectorAll(".tabs button").forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.key)));
// #ezenauto 처럼 해시로도 열 수 있다 — 헤드리스 스크린샷으로 탭마다 확인하기 위한 것.
if (location.hash.slice(1)) show(location.hash.slice(1));
document.querySelectorAll("[data-role-select]").forEach((select) => {
  const card = select.closest(".card");
  const key = card.closest(".dataset").dataset.key;
  const original = select.value;
  select.addEventListener("change", () => {
    const dest = (DEST[key] || {})[select.value];
    card.querySelector("[data-dest]").textContent = dest ? "→ " + dest + "에 들어갑니다." : "→ 보고서에 넣지 않습니다.";
    card.querySelector("[data-hint]").textContent = select.value === original
      ? "바꾸면 들어가는 장이 여기에 표시됩니다."
      : "저장하면 다시 분석해도 이 값이 유지됩니다.";
  });
});
`;

async function main() {
  const sections: string[] = [];
  const destinations: Record<string, Record<string, string>> = {};

  for (const demo of DEMOS) {
    sections.push(await buildDataset(demo));
    const plan = await readRolePlan(`demo:${demo.key}`);
    if (!plan) continue;
    const buffer = readFileSync(path.join(process.cwd(), "data", demo.file));
    const { dataRows } = parseWallaWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const chapters = buildSectionPlan(toSectionPlanInput(applyOverrides(plan), plan.profiles, dataRows)).chapters;
    destinations[demo.key] = Object.fromEntries(
      (Object.keys(ROLE_LABEL) as QuestionRole[])
        .map((role) => [role, chapterLabelOf(chapters, role)])
        .filter((entry): entry is [QuestionRole, string] => entry[1] !== null),
    );
  }

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>문항 확인 카드 — 형식 미리보기</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>
<body><div class="wrap">
  <h1>문항 확인 카드 — 형식 미리보기</h1>
  <p class="lead">실제 raw data와 실제 저장된 판정으로 그렸습니다. 실제 화면에서는 목차 동의 카드 안에 접이식으로 들어갑니다.</p>
  <div class="tabs">${DEMOS.map((demo, i) => `<button data-key="${demo.key}" aria-selected="${i === 0}">${demo.name}</button>`).join("")}</div>
  ${sections.map((section, i) => section.replace('class="dataset"', `class="dataset${i === 0 ? " on" : ""}"`)).join("")}
</div><script>${SCRIPT.replace("__DEST__", JSON.stringify(destinations))}</script></body></html>`;

  mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  const out = path.join(process.cwd(), "tmp", "review-cards.html");
  writeFileSync(out, html, "utf8");
  console.log(`확인 카드 미리보기: ${out}`);
  await sql.end();
}

main();