import { redirect } from "next/navigation";
import { PlanBuilder } from "@/components/plan/PlanBuilder";

export const metadata = { title: "기획안 만들기 | 사용성테스트 결과보고서 자동생성" };

/** `/plan/new?survey=<uuid>` — 설문 문항 다음 단계. 설문 없이 오면 설문 목록으로 보낸다. */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ survey?: string | string[] }> }) {
  const { survey } = await searchParams;
  if (typeof survey !== "string") redirect("/survey");
  return <PlanBuilder key={survey} surveyId={survey} />;
}
