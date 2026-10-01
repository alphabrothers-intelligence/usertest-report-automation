"use client";

/**
 * **역할 판정 확인 카드**(2026-09-09). 컬럼 하나하나가 무슨 문항인지는 AI가 판정하고, 그
 * 판정이 보고서의 뼈대를 정한다(`feature`면 기능별 평가 장으로, `meta`면 보고서에서 빠짐).
 * AI가 스스로 확신이 낮다고 표시한 문항만 여기 뜨고, 담당자가 그 자리에서 고친다.
 *
 * **게이트가 아니라 표시다**(memory: review-flag-not-gate). 고치지 않아도 다음으로 넘어간다 —
 * 아래 "이 구성으로 보고서 생성하기" 버튼은 이 카드와 무관하게 항상 눌린다.
 *
 * 판정을 고치면 정량 도표와 장 구성이 바로 다시 계산된다(`PATCH`가 서버에서 같이 처리).
 * 그래서 이 컴포넌트는 저장이 끝나면 부모에게 알려 미리보기를 다시 불러오게 한다 —
 * 고쳤는데 화면이 그대로면 고쳐진 것인지 알 수 없다.
 */
import { useCallback, useEffect, useState } from "react";

type Item = {
  columnIndex: number;
  header: string;
  role: string;
  confidence: number;
  note: string | null;
};

/** 역할 이름은 코드값이라 그대로 보여주면 담당자가 못 읽는다. 판정 근거는 `note`가 따로 준다. */
const ROLE_LABEL: Record<string, string> = {
  demographic: "인적 사항(나이·성별·직업 등)",
  context: "사용 습관·태도",
  prior_service: "유사 서비스 경험",
  feature: "기능별 만족도",
  task_flow: "이용 단계별 만족도",
  journey: "시점별 경험(첫인상·1주 후 등)",
  purchase_factor: "구매 결정 요인",
  value: "가치 영역 만족도",
  ux_quality: "사용자 경험 품질(의미분별 척도)",
  overall: "전반적 만족도",
  intent: "사용·추천 의향(NPS)",
  improvement: "개선 아이디어·추가 질문",
  meta: "보고서에 쓰지 않음",
};

export function RoleReviewCard({ source, onFixed }: { source: string; onFixed: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixedCount, setFixedCount] = useState(0);

  const load = useCallback(() => {
    fetch(`/api/wizard/role-review?source=${encodeURIComponent(source)}`)
      .then((response) => response.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? "판정을 불러오지 못했습니다.");
        setItems(json.items);
        setRoles(json.roles);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [source]);

  useEffect(load, [load]);

  async function fix(columnIndex: number, role: string) {
    setSaving(columnIndex);
    setError(null);
    try {
      const response = await fetch("/api/wizard/role-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, columnIndex, role }),
      });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error ?? "판정을 고치지 못했습니다.");
      setItems((current) => (current ?? []).filter((item) => item.columnIndex !== columnIndex));
      setFixedCount((count) => count + 1);
      onFixed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  }

  // 확인할 것이 없으면 아무것도 그리지 않는다 — 빈 상자는 화면만 차지한다.
  if (!items || (items.length === 0 && fixedCount === 0)) return null;

  return (
    <section className="mb-5 rounded-xl border border-[#f0d9a8] bg-[#fffaf0] px-5 py-4">
      <h2 className="text-[13px] font-bold text-[#8a5a12]">
        판정이 헷갈린 문항 {items.length}개
        {fixedCount > 0 && <span className="ml-2 text-[13px] font-semibold text-[#3f6b45]">· {fixedCount}개 고침</span>}
      </h2>
      <p className="mt-1 text-[13px] text-[#7a6a52]">
        각 문항이 무엇을 묻는지 AI가 판정했고, 그 판정대로 보고서의 장·도표가 만들어집니다.
        아래는 <strong className="font-semibold">AI가 스스로 확신이 낮다고 표시한 것</strong>입니다 —
        맞으면 그냥 두시고, 틀리면 바꾸면 아래 미리보기가 바로 다시 그려집니다.
      </p>
      {/* 판정을 고치면 정량 수치가 바뀌고, 그 위에 쓴 해석(Ⅸ장 결과 요약·섹션 분석)은 낡은 것이
          되어 버려진다 — 누르기 전에 보이게 한다(2026-09-11). */}
      <p className="mt-1 text-[12px] text-[#8a5a12]">
        고치면 정량 수치가 다시 계산되고, 그 위에 쓴 <strong className="font-semibold">종합 해석(마지막 장)은 다시 만들어야</strong> 합니다.
      </p>

      {error && <p className="mt-3 text-[13px] font-semibold text-[#b91c1c]">{error}</p>}

      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.columnIndex} className="rounded-lg border border-[#ecdcbd] bg-white px-4 py-3">
            <p className="text-[13px] font-semibold leading-snug text-[#27272a]">
              <span className="mr-1.5 rounded bg-[#f4f4f5] px-1.5 py-0.5 text-[11px] font-bold text-[#71717a]">
                {item.columnIndex + 1}열
              </span>
              {item.header || <span className="text-[#a1a1aa]">(제목 없는 컬럼)</span>}
            </p>
            {item.note && <p className="mt-1 text-[12px] leading-snug text-[#8a7a62]">AI 사유: {item.note}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-[#71717a]">지금 판정</span>
              <select
                value={item.role}
                disabled={saving === item.columnIndex}
                onChange={(event) => void fix(item.columnIndex, event.target.value)}
                className="rounded-md border border-[#d4d4d8] bg-white px-2 py-1 text-[13px] font-semibold text-[#27272a] disabled:opacity-50"
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role] ?? role}
                  </option>
                ))}
              </select>
              {saving === item.columnIndex && <span className="text-[12px] text-[#71717a]">고치는 중…</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
