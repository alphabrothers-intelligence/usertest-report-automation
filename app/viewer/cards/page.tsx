import { QuestionLayoutCardsPage } from "@/components/QuestionLayoutCardsPage";

export const metadata = {
  title: "문항별 레이아웃 미리보기 | 사용성테스트 결과보고서 자동생성",
};

/**
 * 문항 하나가 보고서에서 어떤 도표로 나오는지 카드로 훑고, 그대로 보고서를 여는 화면.
 *
 * `?dataset=` 은 예시 raw data(정량만), `?source=` 는 실제 업로드한 보고서(정성 결과까지)를
 * 연다 — `/viewer`와 같은 두 통로다.
 */
export default async function ViewerCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string | string[]; source?: string | string[] }>;
}) {
  const params = await searchParams;
  const dataset = typeof params.dataset === "string" ? params.dataset : undefined;
  const source = typeof params.source === "string" && /^https?:\/\//.test(params.source) ? params.source : undefined;
  return <QuestionLayoutCardsPage dataset={dataset} source={source} />;
}