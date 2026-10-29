"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SelectionBar } from "@/components/SelectionBar";
import type { SurveyListItem } from "@/lib/db/surveys";

/** 저장된 설문 문항 목록 — 보고서 목록(`/reports`)과 같은 모양. */
export function SurveyList() {
  const [items, setItems] = useState<SurveyListItem[] | null>(null);

  useEffect(() => {
    fetch("/api/survey", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => setItems(payload.surveys ?? []))
      .catch(() => setItems([]));
  }, []);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  /** 고른 설문을 지운다 — 한 건 삭제 API를 그대로 여러 번 부른다. 실패한 것은 목록에 남는다. */
  async function remove(ids: string[], label: string) {
    if (!ids.length || !window.confirm(`${label}을(를) 삭제할까요? 복구할 수 없습니다.`)) return;
    setDeleting(true);
    const results = await Promise.all(ids.map((id) => fetch(`/api/survey/${id}`, { method: "DELETE" }).then((r) => (r.ok ? id : null), () => null)));
    const gone = new Set(results.filter((id): id is string => !!id));
    setItems((list) => list?.filter((i) => !gone.has(i.id)) ?? []);
    setPicked(new Set());
    setDeleting(false);
    if (gone.size < ids.length) window.alert(`${ids.length - gone.size}개는 삭제하지 못했습니다.`);
  }
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!items || items.length === 0) return null;
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[17px] font-bold text-[#1d2433]">저장된 설문 문항</h2>
        <SelectionBar
          total={items.length}
          count={picked.size}
          deleting={deleting}
          onAll={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}
          onDelete={() => remove([...picked], `고른 설문 문항 ${picked.size}개`)}
        />
      </div>
      <ul className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e7ecf3] bg-white">
        {items.map((item) => (
          <li key={item.id} className={`flex items-center gap-4 px-5 py-4 ${picked.has(item.id) ? "bg-[#f3f7ff]" : "hover:bg-[#f9fafc]"}`}>
            <input type="checkbox" aria-label={`${item.companyName || "이름 없음"} 선택`} checked={picked.has(item.id)} onChange={() => toggle(item.id)} className="size-4 shrink-0 cursor-pointer accent-[#356df3]" />
            <Link href={`/survey?id=${item.id}`} className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-[#1d2433]">
                {item.companyName || "기업명 없음"}{item.productName && <span className="font-normal text-[#6b778a]"> · {item.productName}</span>}
              </span>
              <span className="block truncate text-[13px] text-[#94a0b2]">
                {item.parentId && <span className="mr-1.5 rounded-full bg-[#f0f0f2] px-1.5 py-0.5 text-[11px] font-semibold text-[#6b778a]">제품별로 나눈 설문</span>}
                {item.questionCount}문항 · {new Date(item.updatedAt).toLocaleString("ko-KR")} 수정{item.sourceFileName && ` · ${item.sourceFileName}`}
              </span>
            </Link>
            <Link
              href={`/plan/new?survey=${item.id}`}
              title={item.parentId ? "제품별로 나눈 설문입니다. 원래 설문으로 만들면 두 제품이 한 기획안에 제품별로 들어갑니다." : "이 설문으로 설문 구성 기획안(HWPX)을 만듭니다."}
              className="rounded-lg bg-[#eef3fe] px-3 py-1.5 text-[13px] font-semibold text-[#356df3] hover:bg-[#e0eafd]"
            >
              기획안
            </Link>
            <button type="button" onClick={() => remove([item.id], `‘${item.companyName || item.sourceFileName || "이름 없음"}’ 설문 문항`)} className="rounded-lg px-3 py-1.5 text-[13px] text-[#b42318] hover:bg-[#fff1ef]">
              삭제
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

