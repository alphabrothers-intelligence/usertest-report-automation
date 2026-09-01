"use client";

import { useRouter } from "next/navigation";
import { QuestionLayoutCards } from "@/components/QuestionLayoutCards";

/**
 * 미리보기 카드 + "보고서 생성하기". 버튼은 편집 가능한 보고서 웹뷰(`/viewer`)로 넘긴다 —
 * 실무자는 거기서 모든 내용을 고치고 최종본을 PDF·DOCX로 내려받는다.
 *
 * 카드 화면 자체(`QuestionLayoutCards`)는 라우터를 모른다. 마법사 안에 끼워 넣을 때는
 * `onGenerate`로 다음 단계를 부르면 되기 때문이다.
 */
export function QuestionLayoutCardsPage({ dataset, source }: { dataset?: string; source?: string }) {
  const router = useRouter();
  const target = source ? `/viewer?source=${encodeURIComponent(source)}` : `/viewer?dataset=${dataset ?? "rivalabs"}`;
  return <QuestionLayoutCards dataset={dataset} source={source} onGenerate={() => router.push(target)} />;
}