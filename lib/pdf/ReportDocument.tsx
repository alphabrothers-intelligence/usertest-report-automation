// PRD 8장: 섹션 순서는 표준스키마_SW앱형.pdf 목차(Ⅰ~Ⅸ)를 그대로 따른다.
import path from "node:path";
import { Document, Page, Text, View, Link, Image } from "@react-pdf/renderer";
import { styles, colors } from "./theme";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories, RecommendationRow, StrategicInputRow } from "@/lib/db/reports";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import type { SectionAnalyses } from "@/lib/pipeline/sectionAnalysis";
import {
  SectionOverview,
  SectionDemographics,
  SectionCorePurchaseFactor,
  SectionFourValuesTable,
  SectionUxQuality,
  SectionCrossAnalysis,
  type ProductInfo,
} from "./sectionsQuant";
import {
  SectionFeatureExperience,
  SectionFourValuesQualitative,
  SectionNpsAndImprovement,
  SectionConclusion,
} from "./sectionsQualitative";

// 실제 발행 보고서의 푸터는 "{연도} by Alphabrothers ... ALPHA BROTHERS" 형태다(2026-07-21
// 확인) — data/[알파브라더스] ...pdf 파일명에서 보듯 Alphabrothers는 테스트 대상 서비스
// 회사가 아니라 **이 보고서를 만드는 에이전시(=이 도구 자신의 정체성)**다. 그래서
// productInfo.companyName(테스트 대상 회사)이 아니라 고정 브랜드로 넣는다. public/ 아래
// 정적 파일을 쓴다(fonts.ts와 같은 이유 — data/는 gitignore돼 배포에 포함되지 않는다).
const LOGO_PATH = path.join(process.cwd(), "public", "images", "alphabrothers-logo.png");

export interface ReportDocumentProps {
  fileName: string | null;
  generatedAt: string;
  quantStats: QuantStats;
  questions: QuestionWithApprovedCategories[];
  recommendations: RecommendationRow[];
  strategicInput: StrategicInputRow | null;
  resultSummary: string;
  productInfo?: ProductInfo;
  sectionAnalyses?: SectionAnalyses | null;
}

/**
 * 목차 페이지(2026-07-20 추가, 실제 발행 보고서 양식 대조 피드백). 채팅 목차 카드와 같은
 * lib/pipeline/reportPlan.ts의 buildReportPlan()을 그대로 써서 제목·소목차가 서로 어긋나지
 * 않게 한다(따로 두면 둘 중 하나만 고칠 때 어긋난다 — 실제 리바랩스 보고서의 설문 항목 표
 * 자체에 있던 문항번호 불일치를 발견하고 나서 특히 신경 쓴 부분).
 *
 * react-pdf는 페이지 레이아웃을 선언적으로 한 번에 그리기 때문에(사전 측정 없이), 목차에
 * "실제 몇 페이지"처럼 다른 위치의 결과물인 페이지 번호를 미리 계산해 넣을 방법이 없다
 * (bookmark는 PDF 뷰어의 사이드바 개요일 뿐, 본문에 찍을 텍스트가 아니다). 그래서 페이지
 * 번호 대신 각 항목을 해당 섹션으로 바로 이동하는 링크로 만들었다 — 화면에서 클릭 내비게이션은
 * 되지만, 인쇄물처럼 숫자로 확인하고 싶다면 이 부분은 알려진 단순화다.
 */
function TableOfContents({ featureNames }: { featureNames: string[] }) {
  const sections = buildReportPlan(featureNames);
  // 실제 페이지 번호는 못 넣는다(2026-07-22 재확인) — react-pdf는 페이지를 선언적으로 한 번에
  // 그려서, 목차 시점엔 아직 뒤쪽 섹션이 몇 페이지에 놓일지 계산할 방법이 없다(다른 라이브러리도
  // 보통 "먼저 렌더링해서 페이지 수를 알아낸 뒤 다시 렌더링"하는 2-pass 방식을 쓰는데, 이건
  // "어느 section이 몇 페이지에서 시작하는지"까지 정확히 추적해야 해서 훨씬 더 복잡하고 깨지기
  // 쉽다 — 지금 규모에서는 무리라고 판단했다). 대신 요청받은 대안대로(2026-07-22, "그것이
  // 어렵다면 목차 내용의 크기를 키워서") 글자 크기·여백을 키웠다. **처음엔 20/13/10pt까지
  // 키웠는데, 그러면 항목 9개 중 마지막(Ⅸ, 하위 4개로 가장 김) 하나가 한 페이지에 안 들어가
  // 통째로 다음 페이지로 넘어가면서 두 페이지 다 여백이 더 커지는 역효과가 났다(실측 확인,
  // 2026-07-22) — 9개 항목 전부가 한 페이지에 들어가는 선에서 17/11.5/9pt로 낮췄었다.
  // **2026-07-23 재요청**("여백을 줄이고 글씨 크기를 늘려서 목차를 꽉 채워달라"): 처음엔
  // 24/15/11pt까지 키웠는데, 9번째 항목(Ⅸ, 하위 4개로 가장 김)이 페이지에 안 들어가 통째로
  // 다음 페이지로 넘어가는 게 재현됐다(2026-07-23 실측 — 2026-07-22에 20/13/10에서 이미
  // 겪었던 것과 같은 실패 모드) — 9개 항목 전부가 한 페이지에 들어가는 선까지만 키워
  // 19/13/10pt로 낮췄다(기존 17/11.5/9pt보다는 크다).
  // 2026-07-23: 표지가 별도 <Page>로 분리되면서 목차가 이제 그 다음 <Page>의 첫 콘텐츠라
  // break가 더 이상 필요 없다(이미 새 페이지 맨 위) — break를 그대로 뒀다간 "이미 새 페이지
  // 맨 위인데 또 새 페이지로 넘기라"는 지시가 되어 빈 페이지가 하나 더 생길 위험이 있어 뺐다.
  return (
    <View>
      <Text style={{ fontSize: 19, fontWeight: "bold", marginBottom: 18, color: colors.navy }}>목차</Text>
      {sections.map((entry) => (
        <View key={entry.numeral} style={{ marginBottom: 11 }} wrap={false}>
          <Link src={`#section-${entry.numeral}`} style={{ textDecoration: "none" }}>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.navy }}>
              {entry.numeral}. {entry.title}
            </Text>
          </Link>
          {entry.subitems.map((item) => (
            <Text key={item} style={{ fontSize: 10, color: colors.subtext, marginTop: 2.3, marginLeft: 13 }}>
              · {item}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function findQuestion(questions: QuestionWithApprovedCategories[], key: string) {
  return questions.find((q) => q.question_key === key);
}

function findRecommendation(recs: RecommendationRow[], section: string) {
  const r = recs.find((r) => r.section === section);
  return r ? (r.final ?? r.draft) : null;
}

export function ReportDocument({
  fileName,
  generatedAt,
  quantStats,
  questions,
  recommendations,
  strategicInput,
  resultSummary,
  productInfo,
  sectionAnalyses,
}: ReportDocumentProps) {
  const featureQuestions = questions.filter((q) => q.question_key.startsWith("feature:"));
  const valueQuestions = questions.filter((q) => q.question_key.startsWith("values:"));
  const featureRecommendations = recommendations.filter((r) =>
    r.section.startsWith("feature_improvement:"),
  );

  return (
    <Document title={fileName ?? "사용성테스트 결과보고서"}>
      {/* 표지 전용 <Page>(2026-07-23 분리) — 예전엔 표지·목차·본문 전체가 하나의 <Page wrap>
          안에 있어서, 본문에 붙인 fixed 푸터(구분선+우측 로고)가 표지에도 그대로 반복됐다
          (react-pdf의 fixed는 "그 <Page> 안에서 넘치는 모든 물리 페이지"에 반복되는 것이지
          표지만 예외로 뺄 방법이 없었다). "표지에서는 구분선과 우측 아래 로고를 없애도 된다"
          (2026-07-23 요청)는 조건부 렌더 트릭이 아니라 아예 표지를 별도 <Page>로 분리해서
          해결했다 — fixed 요소는 그 요소가 선언된 <Page> 안에서만 반복되므로, 푸터를 본문
          <Page> 쪽에만 두면 표지에는 애초에 그 요소가 존재하지 않는다(Image를 render()
          콜백 조건부 안에 넣으면 자산이 통째로 누락되는 기존 실측 버그도 원천적으로 피한다).
          pageNumber/totalPages는 Document 전체 기준 전역 번호라 이 분리로 번호 체계가 깨지지
          않는다(실제 렌더로 재확인). */}
      <Page size="A4" style={styles.page}>
        {/* 표지(2026-07-22 재구성, 2026-07-23 부제 추가) — 제목·기업명·부제(서비스명)·발행일을
            크게, 발행 기관 로고는 페이지 맨 아래 정중앙에 배치(사용자 첨부 참고 이미지 요청).
            실제 참고 이미지의 상단 사진 콜라주는 우리가 가진 실제 사진 자산이 없어 그대로
            재현할 수 없다(알려진 갭) — 대신 "디자인이 조금 들어가도 좋다"는 요청에 맞춰 브랜드
            컬러(#004FFF/#002D7C) 블록으로 콜라주 느낌만 흉내낸 자리표시 그래픽을 넣었다(사진이
            아니라 순수 색상 블록 — 어떤 프로젝트든 이미지 자산 없이 항상 재현 가능하다는 장점도
            있다). **실측 버그(2026-07-22)**: 처음엔 로고를 position:"absolute"+bottom:50으로
            뒀는데, 렌더링해보니 표지(1페이지)가 아니라 문서 맨 마지막 페이지 하단에 나타났다 —
            react-pdf는 여러 페이지로 넘치는 하나의 <Page>를 먼저 한 덩어리로 배치한 뒤 페이지
            단위로 잘라내는데, fixed가 아닌 absolute는 "이 페이지"가 아니라 "전체 문서 흐름"
            기준으로 bottom이 계산되는 것으로 보인다(그래서 실제로는 문서 전체의 맨 아래 —
            즉 마지막 페이지 — 에 붙어버렸다). absolute 대신 표지 콘텐츠 전체를 문서 여백을
            뺀 실제 높이만큼의 flex 컨테이너로 감싸고 justifyContent:"space-between"으로
            제목 블록은 위에, 로고는 아래에 배치하는 방식으로 바꿔서 표지 페이지 안에만 머물게
            했다. */}
        <View style={{ height: 748, justifyContent: "space-between" }}>
          <View>
            {/* 색상 블록 콜라주 — 참고 이미지의 4×2 사진 그리드 배치를 흉내냈다. */}
            <View style={{ flexDirection: "row", height: 95, gap: 4 }}>
              <View style={{ flex: 1, backgroundColor: colors.navy }} />
              <View style={{ flex: 1, backgroundColor: colors.navyLight }} />
              <View style={{ flex: 1, backgroundColor: colors.chartBannerBg }} />
              <View style={{ flex: 1, backgroundColor: colors.navy }} />
            </View>
            <View style={{ flexDirection: "row", height: 95, gap: 4, marginTop: 4 }}>
              <View style={{ flex: 1, backgroundColor: colors.chartBannerBg }} />
              <View style={{ flex: 1, backgroundColor: colors.navyLight }} />
              <View style={{ flex: 2, backgroundColor: colors.navy }} />
            </View>
            <View style={{ marginTop: 130 }}>
              <Text style={{ fontSize: 25, fontWeight: "bold", lineHeight: 1.35, color: colors.navy }}>
                사용성 테스트{"\n"}결과보고서
              </Text>
              <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.navyLight, marginTop: 14 }}>
                {productInfo?.companyName ?? "기업명 입력 필요"}
              </Text>
              {/* "Usability Test Proposal for '서비스명'" 부제(2026-07-23 요청, 참고 이미지의
                  글씨 크기를 따라 companyName(15pt)보다 한 단계 작은 11pt 회색으로). */}
              <Text style={{ fontSize: 11, color: colors.subtext, marginTop: 6 }}>
                Usability Test Proposal for &apos;{productInfo?.serviceName ?? "서비스명 입력 필요"}&apos;
              </Text>
              {/* raw data 파일명(fileName)은 표지에 노출하지 않는다(2026-07-23 명시적 요청 —
                  "[리바랩스]사용성테스트 raw data.xlsx가 표지에 절대 같이 생성되면 안 된다").
                  fileName 인자 자체는 여전히 남아있다 — 다운로드 파일명(예: "리바랩스_
                  결과보고서.pdf")을 만드는 데는 필요하기 때문(lib/pdf/assemble.ts) — 표지
                  "본문"에만 안 쓴다는 뜻이다. */}
              <Text style={{ fontSize: 9.5, color: colors.subtext, marginTop: 28 }}>
                {generatedAt.replace(/-/g, ".")}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: "center" }}>
            <Image src={LOGO_PATH} style={{ width: 100 }} />
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <TableOfContents featureNames={quantStats.featureSatisfaction.map((f) => f.name)} />

        <View break style={{ marginTop: 16 }}>
          <SectionOverview productInfo={productInfo} stats={quantStats} />
        </View>
        <SectionDemographics stats={quantStats} />
        <SectionFeatureExperience stats={quantStats} featureQuestions={featureQuestions} featureExperienceAnalysis={sectionAnalyses?.featureExperience} />
        <SectionCorePurchaseFactor
          stats={quantStats}
          recommendation={findRecommendation(recommendations, "core_purchase_factor")}
        />
        {/* SectionFourValuesTable은 자체적으로 이미 <View break>를 갖고 있다(sectionsQuant.tsx) —
            여기서 또 <View break>로 감싸면 break-View가 중첩되는데, 실제 정성 분석 데이터가
            붙은 전체 문서(20+페이지)에서 렌더링해보니 이 중첩이 표 값 라벨이 정성 카테고리
            블록 위에 겹쳐 찍히는 심각한 레이아웃 붕괴를 일으켰다(2026-08-03 실측, 정량 전용
            미리보기에서는 재현 안 됨 — 문서가 충분히 길고 정성 콘텐츠가 실제로 있어야 나타남).
            다른 모든 장(Ⅵ 이후)처럼 두 컴포넌트를 독립된 형제로 두니 해결됐다. */}
        <SectionFourValuesTable stats={quantStats} />
        <SectionFourValuesQualitative
          valueQuestions={valueQuestions}
          fourValueItemsText={sectionAnalyses?.fourValueItems}
          fourValuesAnalysis={sectionAnalyses?.fourValues}
        />
        <SectionUxQuality stats={quantStats} uxQualityAnalysis={sectionAnalyses?.uxQuality} />
        <SectionCrossAnalysis stats={quantStats} crossAnalysisText={sectionAnalyses?.crossAnalysis} />
        <SectionNpsAndImprovement
          stats={quantStats}
          overallQuestion={findQuestion(questions, "overallSatisfaction")}
          npsQuestion={findQuestion(questions, "nps")}
          improvementQuestion={findQuestion(questions, "improvementIdea")}
        />
        <SectionConclusion
          stats={quantStats}
          featureQuestions={featureQuestions}
          resultSummary={resultSummary}
          devPriorityRecommendation={findRecommendation(recommendations, "dev_priority")}
          featureRecommendations={featureRecommendations}
          customerRecommendations={recommendations.find((r) => r.section === "feature_customer_recommendations") ?? null}
          strategicInput={
            strategicInput
              ? {
                  customerRequest: strategicInput.customer_request,
                  priorityMetric: strategicInput.priority_metric,
                  draft: strategicInput.draft,
                }
              : null
          }
        />

        {/* 마지막 장표는 텍스트(연도·저작권/쪽수)를 안 넣는다(실제 발행 보고서와 동일,
            2026-07-21 확인). **2026-07-23**: 표지를 별도 <Page>로 분리하면서 이 fixed 푸터
            자체가 표지엔 존재하지 않게 됐고, 목차(2p)는 이제 이 <Page> 블록의 첫 페이지라
            일반 본문 페이지와 똑같이 쪽수·연도 텍스트를 보여준다(2026-07-23 요청: "목차
            페이지도 페이지 아래 정중앙에 페이지수를 기록해주세요") — 예전엔 "표지·목차·마지막
            페이지 텍스트 숨김"을 pageNumber<=2로 한 번에 처리했지만, 이제 마지막 페이지만
            숨기면 된다. 실측 버그: Image를 View.render()의 조건부 반환값 안에 넣으면 이미지
            자체가 통째로 누락된다(파일 크기 비교로 확인: 조건부 렌더 방식은 114KB, 항상
            렌더하는 방식은 326KB) — 그래서 Image는 항상 정적으로 렌더하고(로고만 목차·마지막
            페이지에도 작게 남는다 — 알려진 단순화), 텍스트만 Text.render()의 조건부 반환으로
            페이지별로 비운다(Text는 이 방식이 문제없이 동작함을 확인했다). */}
        {/* 쪽수 텍스트는 flex 형제(왼쪽 텍스트·오른쪽 로고 이미지)의 너비에 따라 중앙이
            밀리는 문제가 있었다(2026-07-21 지적: "-3/17-이 페이지 정중앙이 아니다") — 로고
            이미지가 고정폭(55)이라 왼쪽 flex:1 칸과 정확히 대칭이 되지 않기 때문이다.
            position:absolute로 푸터 행 전체 너비 기준 정가운데에 별도로 띄워서 좌우 요소의
            너비와 무관하게 항상 진짜 중앙에 오게 한다. */}
        <View style={styles.footerRow} fixed>
          <Text
            style={styles.footerSide}
            render={({ pageNumber, totalPages }) =>
              pageNumber === totalPages
                ? ""
                : `${new Date(generatedAt).getFullYear()} by ${productInfo?.footerBrandName || "Alphabrothers"}`
            }
          />
          <Text
            style={[styles.footerCenter, { position: "absolute", left: 0, right: 0, top: 8 }]}
            render={({ pageNumber, totalPages }) => (pageNumber === totalPages ? "" : `- ${pageNumber} -`)}
          />
          <Image src={LOGO_PATH} style={{ width: 55 }} />
        </View>
      </Page>
    </Document>
  );
}
