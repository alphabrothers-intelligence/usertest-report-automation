/**
 * 컬럼 프로파일러 — 범용화 파이프라인 1단계(PRD 2.2.2절).
 *
 * **AI를 쓰지 않는다.** 각 컬럼의 응답값에서 "이 문항이 어떤 형태인가"(단일선택·복수선택·
 * 순위·척도·자유서술·메타)를 규칙으로 판정하고, 척도 상한·선택지 목록·결측률 같은 요약만
 * 만든다. "이 문항이 **무엇을 묻는가**"(역할)는 다음 단계에서 AI가 판정한다 — 형태는 값에서
 * 결정론적으로 나오지만 의미는 데이터셋마다 문구가 달라 규칙으로 못 잡기 때문이다.
 *
 * 이 요약만 AI에 보낸다. **응답 원문(개인정보 포함)은 보내지 않는다.**
 */

export type ColumnType =
  /** 선택지 하나 */
  | "single"
  /** 선택지 여러 개(구분자로 나열) */
  | "multi"
  /** 순위 응답(값이 항목명 또는 순서) */
  | "rank"
  /** 점수 척도. `scaleMax`로 상한을 함께 준다 */
  | "scale"
  /** 자유서술 */
  | "text"
  /** 응답시간·연락처·업로드 URL처럼 보고서에 안 쓰는 컬럼 */
  | "meta";

export type ColumnProfile = {
  index: number;
  header: string;
  type: ColumnType;
  /** 척도 상한(감지값). 0~10이면 10, 1~5면 5. */
  scaleMax?: number;
  /** 선택지 상위 12개(단일·복수·순위). 프롬프트 길이를 위해 자른다. */
  options?: string[];
  uniqueCount: number;
  /** 0~1. 게이팅 뒤 문항은 이 값이 크다(경험 있음 응답자만 답하므로). */
  blankRate: number;
  avgLength: number;
  /** `실용성1) 조작 편의성`처럼 행렬형 그룹 접두가 있으면 그룹명(`실용성`). */
  groupPrefix?: string;
  /** 헤더 안 따옴표로 감싼 항목명(`'펫과의 산책' 기능의 만족도…` → `펫과의 산책`). */
  quotedName?: string;
  /** 이 컬럼이 앞 컬럼의 "이유" 문항이면 그 컬럼 인덱스. 정성 분석 대상을 잇는 신호다. */
  reasonFor?: number;
};

const MULTI_SEPARATORS = /[,;·]|\s\/\s/;
// 뒤쪽 영문 항목은 **탈리(Tally) 폼 내보내기**의 고정 컬럼이다. 탈리는 제출 시각을
// `2026-01-26 03:19:09` 형태로 넣는데 SheetJS가 이를 날짜 일련번호(숫자)로 읽어서, 헤더로
// 안 거르면 **척도 문항으로 잡힌다**(실측 2026-08-28). 주민등록번호·계좌번호처럼 값이
// 제각각인 개인정보는 `identifierLike`가 이미 걸러내지만, 시각은 값만 보면 점수와 구분이 안 된다.
const META_HEADER =
  /응답\s*시간|타임스탬프|timestamp|이름|성함|휴대폰|전화|연락처|이메일|email|번호 끝|차량번호|업로드|첨부|캡쳐|캡처|인증|주민등록|계좌\s*번호|submitted\s*at|submission\s*id|respondent\s*id|created\s*at|start(ed)?\s*time|completion\s*time/i;
const REASON_HEADER = /위와\s*같이\s*평가한\s*이유|그렇게\s*느끼셨나요|이유는\s*무엇|^\s*이유\s*$/;
/** 이유 서술은 짧지 않다. 이 아래는 "왜 그 점수인가"가 아니라 단답(제품명 등)으로 본다. */
const REASON_MIN_LENGTH = 30;
/** 종속 컬럼은 앞 문항의 헤더를 그대로 되풀이한다(투블럭 실측). 이만큼 겹치면 같은 문항으로 본다. */
const SHARED_PREFIX_MIN = 12;

function sharedPrefixLength(a: string, b: string): number {
  const x = a.replace(/\s+/g, " ");
  const y = b.replace(/\s+/g, " ");
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
  return i;
}
/** 순위 컬럼의 헤더는 `1순위`도 되고 리바랩스처럼 그냥 `1위`도 된다(실측). */
const RANK_HEADER = /순위|순서대로|^\s*\d+\s*위\s*$/;
/** `실용성1)`, `즐거움2)` 같은 행렬형 접두 — 뒤에 붙는 숫자까지 하나의 그룹 신호다. */
const GROUP_PREFIX = /^([가-힣A-Za-z]+)\s*\d+\s*\)/;
const QUOTED_NAME = /['‘"“]([^'’"”]{2,40})['’"”]/;

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** 숫자로 읽히는 값인지. "7", "7점", "7.0" 모두 허용한다. */
function asNumber(value: string): number | null {
  const cleaned = value.replace(/점|score/gi, "").trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** 실측 상한을 설문에서 흔한 척도(5·7·10·100)로 올림한다 — 아무도 만점을 안 준 경우를 위해서다. */
function detectScaleMax(values: number[]): number {
  const max = Math.max(...values);
  for (const candidate of [5, 7, 10, 100]) {
    if (max <= candidate) return candidate;
  }
  return Math.ceil(max);
}

function profileColumn(index: number, header: string, rawValues: unknown[]): ColumnProfile {
  const all = rawValues.map(cellText);
  const filled = all.filter((value) => value !== "");
  const unique = new Set(filled);
  const avgLength = filled.length === 0 ? 0 : filled.reduce((sum, v) => sum + v.length, 0) / filled.length;
  const base = {
    index,
    header,
    uniqueCount: unique.size,
    blankRate: all.length === 0 ? 1 : 1 - filled.length / all.length,
    avgLength: Math.round(avgLength * 10) / 10,
  };
  const groupPrefix = GROUP_PREFIX.exec(header)?.[1];
  const quotedName = QUOTED_NAME.exec(header)?.[1];
  // reasonFor는 앞 컬럼의 **형태**를 알아야 정해지므로 profileColumns의 2차 순회에서 채운다.
  const extra = { groupPrefix, quotedName };

  // 메타는 값 형태로는 자유서술과 구분되지 않는다(둘 다 제각각인 문자열) — 헤더로 먼저 거른다.
  // 응답자마다 값이 거의 다 다르면서 짧은 것도 식별자로 본다(이름·차량번호 등).
  // 게이팅 뒤 문항(경험 있는 사람만 답함)도 값이 제각각이고 짧을 수 있다 — 케어클 "어떤
  // 뷰티 디바이스를 사용해 보셨나요?"가 그래서 메타로 잘못 잡혔다. 식별자는 **모두에게** 묻는
  // 것이므로 결측이 거의 없다는 조건을 함께 건다.
  const identifierLike = filled.length >= 5 && unique.size >= filled.length * 0.9
    && avgLength <= 20 && base.blankRate < 0.1;
  if (!header.trim() || META_HEADER.test(header) || identifierLike) {
    return { ...base, ...extra, type: "meta" };
  }

  const numbers = filled.map(asNumber).filter((n): n is number => n !== null);
  if (filled.length > 0 && numbers.length >= filled.length * 0.9) {
    return { ...base, ...extra, type: "scale", scaleMax: detectScaleMax(numbers) };
  }

  const options = [...unique].slice(0, 12);
  // 순위는 "값이 항목명"이라 단일선택과 값 모양이 같다 — 헤더 문구로 가른다.
  if (RANK_HEADER.test(header)) return { ...base, ...extra, type: "rank", options };

  const separated = filled.filter((value) => MULTI_SEPARATORS.test(value));
  if (separated.length >= filled.length * 0.5 && avgLength <= 60 && unique.size > 2) {
    return { ...base, ...extra, type: "multi", options };
  }

  // 선택지형은 "같은 값이 반복"된다. 자유서술은 거의 다 다르다.
  // 절대 상한(12개)만 보면 응답자가 적은 raw data에서 자유서술이 전부 선택지로 잡힌다 —
  // 정리습관 "아쉬웠던 점"은 12명이 12가지로 답했는데 선택지로 판정됐다(실측). 반복 비율을
  // 함께 봐서, 값이 실제로 겹칠 때만 선택지로 본다.
  const repeats = filled.length > 0
    && unique.size <= Math.max(12, filled.length * 0.3)
    && unique.size <= filled.length * 0.5;
  if (repeats && avgLength <= 40) return { ...base, ...extra, type: "single", options };

  return { ...base, ...extra, type: "text" };
}

/** 헤더 행 + 데이터 행에서 컬럼별 프로파일을 만든다. 트레일링 빈 컬럼은 제외한다. */
export function profileColumns(headerRow: unknown[], dataRows: unknown[][]): ColumnProfile[] {
  const headers = headerRow.map(cellText);
  let end = headers.length;
  while (end > 0 && headers[end - 1] === "" && dataRows.every((row) => cellText(row[end - 1]) === "")) end -= 1;
  const profiles = headers.slice(0, end).map((header, index) =>
    profileColumn(index, header, dataRows.map((row) => row[index])),
  );

  // 이유 컬럼은 **위치로도** 잡는다. 리바랩스는 헤더가 `이유` 두 글자뿐이라 문구 규칙만으로는
  // 하나도 안 걸렸다(실측 2026-08-26).
  //
  // 위치 규칙은 "척도 문항 뒤의 긴 자유서술"만으로는 너무 넓다 — 이젠오토 45번(개선 아이디어)이
  // 종합 만족도 척도 바로 뒤에 있어 이유로 잡혔고, 그 바람에 개선 아이디어 절이 통째로
  // 사라졌다(실측 2026-08-26). 그래서 **앞 문항 헤더를 되풀이하는지**를 함께 본다 —
  // 종속 컬럼은 헤더가 `Q1. '마이 홈'에 대한 만족도는 몇 점입니까? - …`처럼 부모 문구로 시작한다.
  for (let i = 1; i < profiles.length; i += 1) {
    const profile = profiles[i];
    if (profile.type !== "text") continue;
    const parent = profiles[i - 1];
    const followsScale =
      parent.type === "scale"
      && profile.avgLength >= REASON_MIN_LENGTH
      && sharedPrefixLength(parent.header, profile.header) >= SHARED_PREFIX_MIN;
    if (REASON_HEADER.test(profile.header) || followsScale) profile.reasonFor = i - 1;
  }
  return profiles;
}