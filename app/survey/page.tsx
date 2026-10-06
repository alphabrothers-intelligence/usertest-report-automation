import { SurveyStudio } from "@/components/survey/SurveyStudio";

export const metadata = { title: "설문 문항 생성 | 사용성테스트 결과보고서 자동생성" };

/** `/survey` = 목록과 새로 만들기, `/survey?id=<uuid>` = 저장된 문항 편집. */
export default async function SurveyPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  return <SurveyStudio key={typeof id === "string" ? id : "new"} initialId={typeof id === "string" ? id : null} />;
}
