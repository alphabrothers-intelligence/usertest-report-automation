/**
 * 설문 문항 리스트 — 사전요청서에서 만든 문항을 웹에서 고치고 xlsx/csv로 내려받는다.
 *
 * 열 구성은 `data/사용성테스트_문항리스트_템플릿.xlsx`(Tally 설문 폼 입력용) 그대로다.
 * **문항번호는 저장하지 않고 순서에서 계산한다** — 행을 옮기거나 지울 때마다 번호를 손으로
 * 맞추지 않게 하려는 것이고, 분기조건도 번호가 아니라 문항 id를 가리켜 번호가 바뀌어도 안 깨진다.
 */

/** 템플릿 `단계` 드롭다운 값 + 기획안(케어클)에 있던 `고객 여정 기반 경험 평가`. 순서가 곧 표준 설문 순서다. */
export const SURVEY_STAGES = [
  "인적 사항 및 특성·경험 조사",
  "기능별 고객 경험 평가 - 자사 제품 평가",
  "기능별 고객 경험 평가 - 타사 제품 평가",
  "고객 여정 기반 경험 평가",
  "핵심구매요인 파악",
  "가치 만족도 평가",
  "구매/추천 의향 조사",
  "종합 만족도",
  "개선 아이디어",
  "기타 기업 요청사항",
] as const;

/** 단계별 파스텔 색 — 웹 표와 xlsx 단계 칸이 같은 색을 쓴다(RGB hex, # 없음). */
const STAGE_COLORS: Record<string, string> = {
  "인적 사항 및 특성·경험 조사": "DCE6F2",
  "기능별 고객 경험 평가 - 자사 제품 평가": "EBF1DE",
  "기능별 고객 경험 평가 - 타사 제품 평가": "FDE9D9",
  "고객 여정 기반 경험 평가": "E4DFEC",
  "핵심구매요인 파악": "FFF2CC",
  "가치 만족도 평가": "DAEEF3",
  "구매/추천 의향 조사": "FCE4D6",
  "종합 만족도": "E2EFDA",
  "개선 아이디어": "F2DCDB",
  "기타 기업 요청사항": "EDEDED",
};
export const stageColor = (stage: string) => STAGE_COLORS[stage] ?? "F2F2F2";

/** 템플릿 `문항타입` 드롭다운 값 그대로 — Tally가 이 값으로 응답 형식을 정한다. */
export const SURVEY_TYPES = ["척도(0-10)", "객관식-단일", "객관식-복수", "주관식", "이미지업로드", "날짜"] as const;

export type SurveyType = (typeof SURVEY_TYPES)[number];

export interface SurveyQuestion {
  id: string;
  stage: string;
  text: string;
  type: SurveyType;
  options: string[];
  required: boolean;
  /** 바로 앞 본문항에 딸린 문항(이유 묻기 등) — 번호가 Q3-1처럼 붙는다. */
  followUp: boolean;
  /** 이 문항이 보이는 조건: `branchOn` 문항에서 `branchValue`를 고른 경우. */
  branchOn: string;
  branchValue: string;
  /** 응답자에게 보이는 안내 문구. */
  note: string;
  /** 담당자가 이 문항에서 확인할 점 — 화면에서만 보이고 파일에는 안 나간다. 옛 저장본엔 없을 수 있다. */
  caution?: string;
}

export interface SurveyDraft {
  companyName: string;
  productName: string;
  questions: SurveyQuestion[];
  /** 사전요청서에 있었지만 테스트로 평가하기 어려워 뺀 기능과 이유. */
  excludedFeatures: { name: string; reason: string }[];
  /** 특정 문항에 붙일 수 없는 설문 전체의 확인 사항. */
  reviewNotes: string[];
}

export const isChoice = (type: string) => type.startsWith("객관식");

/** 순서대로 Q1, Q2 … 를 매기고, 딸린 문항은 앞 본문항 번호에 -1, -2 를 붙인다. */
export function numberQuestions(questions: SurveyQuestion[]): Map<string, string> {
  const numbers = new Map<string, string>();
  let main = 0;
  let sub = 0;
  for (const q of questions) {
    if (q.followUp && main > 0) {
      sub += 1;
      numbers.set(q.id, `Q${main}-${sub}`);
    } else {
      main += 1;
      sub = 0;
      numbers.set(q.id, `Q${main}`);
    }
  }
  return numbers;
}

export const SHEET_HEADER = ["단계", "문항번호", "문항텍스트", "문항타입", "보기(선택지)", "필수여부", "분기조건", "비고"];

/** 템플릿 한 행 = 문항 하나. 보기는 템플릿 안내대로 `;`로 잇는다. */
export function toSheetRows(questions: SurveyQuestion[]): string[][] {
  const numbers = numberQuestions(questions);
  return questions.map((q) => {
    const target = q.branchOn ? numbers.get(q.branchOn) : undefined;
    return [
      q.stage,
      numbers.get(q.id) ?? "",
      q.text,
      q.type,
      isChoice(q.type) ? q.options.map((o) => o.trim()).filter(Boolean).join(";") : "",
      q.required ? "필수" : "선택",
      target ? `${target} = '${q.branchValue}' 응답 시` : "",
      q.note,
    ];
  });
}

export function toCsv(questions: SurveyQuestion[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [SHEET_HEADER, ...toSheetRows(questions)].map((row) => row.map(cell).join(","));
  // BOM이 없으면 엑셀이 한글을 깨뜨려 연다.
  return "﻿" + lines.join("\r\n");
}

/** WALLA에서 한 문항이 놓이는 자리 — 페이지(블록) 번호와 그 안의 순서가 WALLA 화면의 `1-4` 같은 번호다. */
export interface WallaSlot {
  q: SurveyQuestion;
  block: string;
  label: string;
}

const isOther = (option: string) => /^기타\s*\(/.test(option.trim());

/**
 * WALLA로 넘길 문항 순서와 블록. 분기 문항(같은 문항의 응답에 따라 보이는 문항들)은 **분기 기준 문항
 * 바로 뒤에, 보기별로 한 묶음씩** 모은다 — 엑셀 순서처럼 단계마다 일반인용·기관용이 번갈아 나오면
 * WALLA 로직을 묶음이 바뀔 때마다 걸어야 한다(실측: 피매치 10번 이상). 묶으면 기준 문항에서 보기별
 * 이동 + 묶음 끝 이동, 서너 개로 끝난다. 엑셀·CSV 순서는 그대로 둔다.
 */
export function wallaLayout(questions: SurveyQuestion[]): WallaSlot[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered: { q: SurveyQuestion; block: string }[] = [];
  const placed = new Set<string>();
  const place = (q: SurveyQuestion) => {
    if (placed.has(q.id)) return;
    placed.add(q.id);
    const source = q.branchOn ? byId.get(q.branchOn) : undefined;
    // 분기 묶음은 블록 이름 앞에 보기를 붙여 WALLA에서 어느 응답자 페이지인지 보이게 한다.
    ordered.push({ q, block: source && q.branchValue ? `${q.branchValue} · ${q.stage}` : q.stage });
    const dependents = questions.filter((d) => d.branchOn === q.id);
    const values = [...new Set([...q.options, ...dependents.map((d) => d.branchValue)])];
    for (const value of values) for (const d of dependents) if (d.branchValue === value) place(d);
  };
  for (const q of questions) if (!q.branchOn || !byId.has(q.branchOn)) place(q);
  for (const q of questions) place(q); // 기준 문항을 못 찾은 고아 분기 문항
  let page = 0;
  let pos = 0;
  return ordered.map((slot, i) => {
    if (i === 0 || slot.block !== ordered[i - 1].block) { page += 1; pos = 0; }
    pos += 1;
    return { ...slot, label: `${page}-${pos}` };
  });
}

const snippet = (text: string) => (text.length > 28 ? `${text.slice(0, 28)}…` : text);

/** WALLA로 가져온 뒤 이 문항에서 손으로 해야 할 일. txt 형식에 담을 수 없는 것들이다. */
export function wallaTodos(q: SurveyQuestion, layout: WallaSlot[]): string[] {
  const todos: string[] = [];
  const slotOf = (id: string) => layout.find((s) => s.q.id === id);
  const source = q.branchOn ? slotOf(q.branchOn) : undefined;
  if (source) todos.push(`분기: ${source.label} 문항에서 '${q.branchValue}'를 고른 사람에게만 보임 — 로직은 ${source.label}에 설정`);
  const dependents = layout.filter((s) => s.q.branchOn === q.id);
  if (dependents.length) todos.push(`로직 설정: 응답에 따라 이동(아래 'WALLA 설정 목록' 참고)`);
  if (q.required) todos.push("필수입력 켜기");
  if (q.type === "척도(0-10)") todos.push("문항 유형을 선형배율(0~10)로 바꾸기");
  if (isChoice(q.type) && q.options.some(isOther)) todos.push("'기타(직접 입력)' 보기를 지우고 '기타' 옵션 추가");
  return todos;
}

/** WALLA 화면 옆에 띄워 두고 위에서부터 처리하는 한 장짜리 설정 목록. */
export function wallaChecklist(questions: SurveyQuestion[]): string {
  const layout = wallaLayout(questions);
  const ref = (s: WallaSlot) => `${s.label} ${snippet(s.q.text)}`;
  const lines = ["WALLA 설정 목록 — txt를 가져온 뒤 위에서부터 처리하세요.", "번호는 WALLA 화면의 필드 번호(페이지-순서)입니다.", ""];

  lines.push("■ 1. 로직(분기) — 오른쪽 위 [로직] 탭");
  let any = false;
  for (const src of layout) {
    const deps = layout.filter((s) => s.q.branchOn === src.q.id);
    if (!deps.length) continue;
    any = true;
    const after = layout.slice(layout.indexOf(deps.at(-1)!) + 1).find((s) => s.q.branchOn !== src.q.id);
    lines.push(`[${ref(src)}]에서 응답에 따라 로직 구성`);
    for (const value of src.q.options.map((o) => o.trim()).filter(Boolean)) {
      const first = deps.find((d) => d.q.branchValue === value);
      lines.push(`  · '${value}' → ${first ? ref(first) : after ? ref(after) : "엔딩"}`);
    }
    const values = [...new Set(deps.map((d) => d.q.branchValue))];
    for (const value of values.slice(0, -1)) {
      const last = deps.filter((d) => d.q.branchValue === value).at(-1)!;
      lines.push(`  · ${last.label}(‘${value}’ 묶음 끝)의 기본 이동 → ${after ? ref(after) : "엔딩"}`);
    }
  }
  if (!any) lines.push("  없음");

  const section = (title: string, items: WallaSlot[]) => {
    lines.push("", `${title} (${items.length}개)`);
    lines.push(...(items.length ? items.map((s) => `  · ${ref(s)}`) : ["  없음"]));
  };
  const optional = layout.filter((s) => !s.q.required);
  lines.push("", "■ 2. 필수입력 — 아래 문항을 뺀 나머지 전부 켜기");
  lines.push(...(optional.length ? optional.map((s) => `  · ${ref(s)}`) : ["  (모든 문항 필수)"]));
  section("■ 3. 문항 유형 → 선형배율(0~10)로 바꾸기", layout.filter((s) => s.q.type === "척도(0-10)"));
  section("■ 4. '기타(직접 입력)' 보기를 지우고 '기타' 옵션 추가", layout.filter((s) => isChoice(s.q.type) && s.q.options.some(isOther)));
  return lines.join("\r\n") + "\r\n";
}

/**
 * WALLA 가져오기용 텍스트 — WALLA는 CSV·엑셀 가져오기가 없고 `Qualtrics 심플 포맷(.txt)` 업로드만
 * 받는다. 문법은 WALLA가 제공한 샘플(`walla-import-sample-ko.txt`, 2026-10-02 담당자 전달)을 따른다:
 * 블록 = Block(블록 사이 PageBreak), 객관식 = MC, 이유 등 긴 답 = TE:Essay, 나이처럼 짧은 답 = TE:SingleLine.
 * **척도(0-10)는 한 줄짜리 객관식 표(Matrix, 열 0~10)** 로 낸다 — 실측(2026-10-06): WALLA 가져오기는
 * NPS·Slider를 `[미지원]` 자리표시로 만들고, 가로 객관식(MC Horizontal)은 세로 보기 11개가 된다.
 * 분기·필수 여부·선형배율·'기타' 직접 입력은 이 형식에 없다 — `wallaChecklist`가 손으로 할 일을 정리한다.
 */
export function toWallaTxt(questions: SurveyQuestion[]): string {
  const out = ["[[AdvancedFormat]]"];
  let block: string | null = null;
  for (const { q, block: name } of wallaLayout(questions)) {
    if (name !== block) {
      if (block !== null) out.push("", "[[PageBreak]]");
      block = name;
      out.push("", `[[Block:${name}]]`);
    }
    // ponytail: 문항타입이 '주관식' 하나라 짧은 답은 단계로 가린다(인적 사항 = 나이 등 한 줄 답). 틀리면 WALLA에서 바꾸면 된다.
    const shortText = q.stage === SURVEY_STAGES[0];
    const tag =
      q.type === "객관식-단일" ? "[[Question:MC:SingleAnswer:Vertical]]" :
      q.type === "객관식-복수" ? "[[Question:MC:MultipleAnswer:Vertical]]" :
      q.type === "척도(0-10)" ? "[[Question:Matrix:SingleAnswer]]" :
      q.type === "주관식" && !shortText ? "[[Question:TE:Essay]]" :
      "[[Question:TE:SingleLine]]"; // 이미지업로드·날짜도 — 텍스트 형식에 대응 타입이 없다
    // 문구 안의 줄바꿈은 새 태그로 오인될 수 있어 한 줄로 편다.
    const text = [q.text, q.note && `(${q.note})`, q.type === "이미지업로드" && "[이미지 업로드 문항]", q.type === "날짜" && "[날짜 문항]"]
      .filter(Boolean).join(" ").replace(/\s*\n\s*/g, " ");
    out.push("", tag, text);
    if (q.type === "척도(0-10)") {
      out.push("[[Choices]]", "점수", "[[Answers]]", ...Array.from({ length: 11 }, (_, i) => String(i)));
      continue;
    }
    const options = isChoice(q.type) ? q.options.map((o) => o.trim()).filter(Boolean) : [];
    if (options.length) out.push("[[Choices]]", ...options);
  }
  return out.join("\r\n") + "\r\n";
}

/** `{기업명}_문항리스트.xlsx` — 템플릿 안내 6번: 다음 단계가 기업명을 파일명에서만 읽는다. */
export const surveyFileName = (companyName: string, ext: "xlsx" | "csv" | "txt", suffix = ext === "txt" ? "_WALLA" : "") =>
  `${companyName.trim().replace(/[\\/:*?"<>|]/g, "") || "기업명"}_문항리스트${suffix}.${ext}`;
