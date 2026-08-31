/**
 * 정답지 로더 — **`docs/STAGE_MAPPING.xlsx`의 `단계매핑` 시트가 유일한 정답 기준이다.**
 *
 * 이 시트는 담당자와 같이 만든 것으로, 데이터셋 5종의 **컬럼 하나하나가 보고서의 어느 장으로
 * 가는지**(단계코드 S0~S9)를 이미 담고 있다. 검사 스크립트가 자기 정답표를 따로 들고 있으면
 * 정답이 두 벌이 되어 한쪽만 고쳐도 아무도 모른다 — 실제로 그렇게 어긋났었다(2026-08-27:
 * 손으로 쓴 표는 리바랩스 순위 문항을 S5로, 이젠오토 35번을 S2로 적었는데 시트가 맞았다).
 * **여기에 정답을 새로 적지 말 것.** 틀린 게 있으면 시트를 고친다.
 *
 * ## 단계코드가 역할보다 굵다는 점
 *
 * 시트는 "어느 장으로 가는가"(S1~S9)를 말하고, 에이전트는 그보다 잔 역할 13종을 판정한다.
 * 한 단계 안에 역할이 둘인 곳이 있다 — S1은 인적사항(`demographic`)과 습관(`context`)이,
 * S8은 종합만족도(`overall`)와 추천의향(`intent`)이 같은 장이다. 그래서 시트가 갈라주지
 * 않는 곳은 **둘 다 정답으로 친다**(`allowedRoles`). 이게 예전에 손으로 "복수 정답"을 정하던
 * 판단을 대신한다 — 이제 근거가 사람 감이 아니라 시트다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { ColumnProfile } from "../lib/agent/profile";
import type { QuestionRole } from "../lib/agent/sectionPlan";

export type StageCode = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";

/** 시트의 `단계명` 그대로. 틀린 곳을 사람이 읽을 때 코드만 보면 무슨 장인지 모른다. */
export const STAGE_NAMES: Record<StageCode, string> = {
  S0: "메타 (보고서 미출력)",
  S1: "인적 사항 및 특성·경험 조사",
  S2: "기능별 고객 경험 평가",
  S3: "타사 서비스 경험 조사",
  S4: "고객 여정 기반 경험 평가",
  S5: "핵심구매요소",
  S6: "4대 가치 만족도",
  S7: "사용자 경험 품질 평가",
  S8: "종합 만족도 및 NPS 지수",
  S9: "개선 아이디어 및 추가 질문",
};

/** 시트의 `데이터셋` 이름 → `data/`의 raw data 파일. 정답이 아니라 파일 경로일 뿐이다. */
const FILES: Record<string, string> = {
  리바랩스: "[리바랩스]사용성테스트 raw data.xlsx",
  케어클: "[케어클] 사용성테스트 raw data.csv",
  이젠오토: "[WALLA]_[이젠오토]_사용성_고객반응_설문조사_oS1LD_2608031228.csv",
  정리습관: "[WALLA]_[정리습관]_사용성_고객반응_설문조사_2a2KD_2608031225.csv",
  투블럭에이아이: "알파브라더스_투블럭에이아이_사용성테스트_2회차_RAW_data.csv",
};

/**
 * 생성돼야 하는 장 제목(번호 제외, 순서대로). **이건 컬럼 정답지가 아니라 결과물 기대값**이라
 * 시트가 아니라 실제 발행 보고서에서 온다(원본과 다른 곳은 전부 설계 결정, 가이드 8.8).
 * 투블럭은 발행 보고서를 아직 대조하지 않아 비워둔다.
 */
const CHAPTERS: Record<string, string[]> = {
  리바랩스: [
    "개요",
    "인적 사항 및 특성·경험 조사",
    "기능별 고객 경험 평가",
    "핵심구매요소",
    "4대 가치 만족도",
    "사용자 경험 품질 평가",
    "교차 분석",
    "종합 만족도 및 NPS 지수",
    "종합 결과 및 제언",
  ],
  // 원본(2025.10.28) 8장과 개수·순서가 그대로 일치한다. 제목 문구만 표준 목차 쪽을 쓴다.
  케어클: [
    "개요",
    "인적 사항 및 특성·경험 조사",
    "기능별 고객 경험 평가",
    "고객 여정 기반 경험 평가",
    "핵심구매요소",
    "4대 가치 만족도",
    "종합 만족도 및 NPS 지수",
    "종합 결과 및 제언",
  ],
  // 원본(2025.02.05)도 8장. 차이는 설계 결정 둘 — `설문 항목`을 독립 장이 아니라 Ⅰ장 3절로
  // 넣고, `교차 분석`은 데이터가 되므로 만든다(원본에 없는 건 원본 편차다 — 아래 정리습관 주석).
  // 원본의 4대 가치 ↔ 핵심구매요소 순서도 표준 목차를 따른다.
  이젠오토: [
    "개요",
    "인적 사항 및 특성·경험 조사",
    "기능별 고객 경험 평가",
    "핵심구매요소",
    "4대 가치 만족도",
    "교차 분석",
    "종합 만족도 및 NPS 지수",
    "종합 결과 및 제언",
  ],
  // 원본은 6장, 우리는 7장이다. 차이는 `교차 분석`(데이터가 되므로 만든다)과 마지막 장의
  // 제언 절이다. **원본에 없는 것은 조건이 안 맞아서가 아니라 원본 편차다** — 발행 보고서는
  // 원래 사람이 손으로 쓰던 문서라 작성자가 절을 빼거나 더했다(표준목차 시트 X-2 참고).
  정리습관: [
    "개요",
    "인적 사항 및 특성·경험 조사",
    "단계별 고객 경험 평가",
    "핵심구매요소",
    "교차 분석",
    "종합 만족도 및 NPS 지수",
    "종합 결과 및 제언",
  ],
};

export type StageDataset = {
  name: string;
  file: string;
  /** 컬럼 인덱스 → 단계코드. 시트에 적힌 그대로다. */
  stages: Record<number, StageCode>;
  chapters?: string[];
};

/** `docs/STAGE_MAPPING.xlsx > 단계매핑`을 읽는다. 병합 셀은 위 값이 이어지는 것으로 본다. */
export function loadStageAnswerKey(): StageDataset[] {
  const file = path.join(process.cwd(), "docs", "STAGE_MAPPING.xlsx");
  const sheet = XLSX.read(readFileSync(file), { type: "buffer" }).Sheets["단계매핑"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });

  const byDataset = new Map<string, Record<number, StageCode>>();
  let stage: StageCode | null = null;
  let dataset: string | null = null;
  for (const row of rows.slice(1)) {
    const [stageCell, , , datasetCell, columnCell] = row as (string | null)[];
    if (stageCell) stage = stageCell.trim() as StageCode;
    // 시트의 데이터셋 표기는 `리바랩스 · 캣독런`처럼 제품명이 붙는다 — 앞부분만 쓴다.
    if (datasetCell) dataset = datasetCell.split("·")[0].trim();
    const column = Number(columnCell);
    if (!stage || !dataset || columnCell === null || !Number.isInteger(column)) continue;
    const bucket = byDataset.get(dataset) ?? {};
    bucket[column] = stage;
    byDataset.set(dataset, bucket);
  }

  return [...byDataset.entries()]
    .filter(([name]) => FILES[name])
    .map(([name, stages]) => ({ name, file: FILES[name], stages, chapters: CHAPTERS[name] }));
}

/**
 * 그 단계에 들어갈 수 있는 역할. 시트가 갈라주지 않는 곳은 여러 개가 정답이다.
 *
 * 순위 문항만 예외적으로 형태를 같이 본다 — 시트는 리바랩스 `1위~6위`를 **기능 장(S2)**에
 * 넣는데(원본 설문 항목 표의 Q12가 `기능별 고객경험 평가` 단계다), 에이전트는 같은 열을
 * 구매 결정 요인으로 읽는다. 둘 다 말이 되고 장 구성도 안 바뀌므로 순위형에 한해 허용한다.
 */
export function allowedRoles(stage: StageCode, profile: ColumnProfile): QuestionRole[] {
  switch (stage) {
    case "S0":
      return ["meta"];
    case "S1":
      return ["demographic", "context"];
    case "S2":
      return profile.type === "rank"
        ? ["purchase_factor", "feature", "task_flow"]
        : ["feature", "task_flow"];
    case "S3":
      return ["prior_service"];
    case "S4":
      return ["journey"];
    case "S5":
      return ["purchase_factor"];
    case "S6":
      return ["value"];
    case "S7":
      return ["ux_quality"];
    case "S8":
      return ["overall", "intent"];
    case "S9":
      return ["improvement"];
  }
}

/** 추천 의향(NPS) 문항. 같은 S8 안에서 종합 만족도와 가르는 유일한 신호다. */
const NPS_HEADER = /추천|NPS/i;

/**
 * 시트의 단계코드만으로 역할 하나를 정한다. **LLM을 안 쓰는 검사**(`check:role-quant`)가
 * "판정은 맞다고 치고 계산만 본다"고 할 때 쓸 판정값이다. 위 `allowedRoles`가 여럿을
 * 허용하는 곳은 형태·헤더로 가른다 — 정답을 새로 만드는 게 아니라 굵은 정답을 잘게 나눌 뿐이다.
 */
export function defaultRole(stage: StageCode, profile: ColumnProfile): QuestionRole {
  if (stage === "S2" && profile.type === "rank") return "purchase_factor";
  if (stage === "S8") return NPS_HEADER.test(profile.header) ? "intent" : "overall";
  return allowedRoles(stage, profile)[0];
}