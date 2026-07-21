// Ⅰ~Ⅱ, Ⅳ~Ⅶ 섹션 — 정량 위주(개요, 인적사항, 핵심구매요소, 4대가치 표, UX품질, 교차분석).
// Ⅲ(기능별 고객경험평가)과 Ⅷ·Ⅸ는 정성 콘텐츠 비중이 커서 sectionsQualitative.tsx에 둔다.
import { View, Text } from "@react-pdf/renderer";
import { styles, colors } from "./theme";
import { BarChart, DivergingBarChart } from "./charts";
import type { QuantStats } from "@/lib/quant/compute";
import type { ProductInfo } from "@/lib/productInfo/types";
import { buildSurveyQuestionRows } from "@/lib/pipeline/surveyQuestions";

export type { ProductInfo };

export function SectionHeader({ numeral, title }: { numeral: string; title: string }) {
  return (
    <View id={`section-${numeral}`} style={styles.sectionHeader} wrap={false}>
      <Text style={styles.sectionHeaderBadge}>{numeral}</Text>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
    </View>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 3 }}>
      <Text style={{ width: 90, fontSize: 8.5, color: colors.subtext }}>{label}</Text>
      {value ? (
        <Text style={{ fontSize: 8.5 }}>{value}</Text>
      ) : (
        <Text style={styles.placeholder}>입력 필요</Text>
      )}
    </View>
  );
}

/** Ⅰ. 개요 — PRD 5.0절 제품 정보. 전부 선택 입력이라 채워지지 않은 필드는 "입력 필요"로
 * 남긴다(AI가 임의로 채우지 않는다는 원칙, 5.0절). v1.4부터 채팅에서 직접 입력하거나
 * 기업소개 파일에서 추출해 채울 수 있다(lib/productInfo/). 2026-07-20: 실제 발행 보고서
 * 양식에 맞춰 "2. 사용성 테스트 진행 일정"·"3. 사용성 테스트 설문 항목" 소목차를 추가했다 —
 * 전자는 제품정보 카드에서 함께 입력받는 선택 필드(테스트 진행 일정은 raw data에 없는 정보라
 * 자동 계산 불가), 후자는 WALLA 59컬럼 스키마에서 결정론적으로 구성한다
 * (lib/pipeline/surveyQuestions.ts 참고 — 특정 발행 보고서의 설문설계 문서를 그대로
 * 베끼지 않는 이유가 그 파일 주석에 있다).
 */
export function SectionOverview({
  productInfo,
  stats,
}: {
  productInfo?: ProductInfo | null;
  stats: QuantStats;
}) {
  const featureNames = stats.featureSatisfaction.map((f) => f.name);
  const surveyRows = buildSurveyQuestionRows(featureNames, productInfo?.serviceName);
  // 표의 "단계" 열을 좁은 고정폭 셀에 반복해서 넣으면 긴 한글 문구가 옆 셀과 겹쳐 보이는
  // 레이아웃 버그가 실측으로 확인됐다(2026-07-20) — 단계를 실제 보고서처럼 전체 너비
  // 그룹 헤더로 바꾸고, 그 아래 문항만 한 열로 나열한다(병합된 셀처럼 보이는 효과).
  const surveyStages = surveyRows.reduce<{ stage: string; questions: string[] }[]>((acc, row) => {
    const last = acc[acc.length - 1];
    if (last && last.stage === row.stage) {
      last.questions.push(row.question);
    } else {
      acc.push({ stage: row.stage, questions: [row.question] });
    }
    return acc;
  }, []);
  return (
    <View>
      <SectionHeader numeral="I" title="개요" />
      <Text style={styles.subheading}>1. 제품 소개</Text>
      <Text style={[styles.body, { fontWeight: "bold", marginTop: 2 }]}>기업 개요</Text>
      <FieldRow label="기업명" value={productInfo?.companyName} />
      <FieldRow label="홈페이지" value={productInfo?.homepage} />
      <FieldRow label="대표자" value={productInfo?.representative} />
      <FieldRow label="업무담당자" value={productInfo?.contactPerson} />
      <Text style={[styles.body, { fontWeight: "bold", marginTop: 6 }]}>제품·서비스 개요</Text>
      <FieldRow label="서비스명" value={productInfo?.serviceName} />
      <FieldRow label="서비스 요약" value={productInfo?.serviceSummary} />
      <FieldRow label="사업영역" value={productInfo?.businessArea} />
      <FieldRow label="산업분야" value={productInfo?.industry} />
      <FieldRow label="운영환경" value={productInfo?.operatingEnvironment} />
      <FieldRow label="사업화단계" value={productInfo?.businessStage} />

      <Text style={[styles.subheading, { marginTop: 8 }]}>2. 사용성 테스트 진행 일정</Text>
      <FieldRow label="테스트 진행 기간" value={productInfo?.testPeriod} />
      <FieldRow label="테스트 대상" value={productInfo?.testTarget} />
      <FieldRow label="담당자" value={productInfo?.testManager} />

      <Text style={[styles.subheading, { marginTop: 8 }]}>3. 사용성 테스트 설문 항목</Text>
      <View style={styles.table}>
        {surveyStages.map((stage) => (
          <View key={stage.stage} wrap={false}>
            <View style={{ backgroundColor: colors.bgAlt, padding: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 8, fontWeight: "bold" }}>{stage.stage}</Text>
            </View>
            {stage.questions.map((question, i) => (
              <View
                key={i}
                style={
                  stage === surveyStages[surveyStages.length - 1] && i === stage.questions.length - 1
                    ? styles.tableRowLast
                    : styles.tableRow
                }
              >
                <Text style={[styles.tableCell, { flex: 1, borderRightWidth: 0 }]}>{question}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Ⅱ. 인적사항 및 특성조사 */
export function SectionDemographics({ stats }: { stats: QuantStats }) {
  const d = stats.demographics;
  return (
    <View break>
      <SectionHeader numeral="II" title="인적사항 및 특성조사" />
      <Text style={styles.body}>
        전체 응답자 {stats.respondentCount}명 (평균 연령 {d.age.mean}세, SD {d.age.sd})
      </Text>

      <Text style={styles.subheading}>나이</Text>
      <BarChart items={d.ageDistribution.map((g) => ({ label: g.label, value: g.percentage }))} max={100} unit="%" />

      <Text style={styles.subheading}>성별</Text>
      <BarChart items={d.gender.map((g) => ({ label: g.label, value: g.percentage }))} max={100} unit="%" />

      <Text style={styles.subheading}>운영체제</Text>
      <BarChart items={d.os.map((g) => ({ label: g.label, value: g.percentage }))} max={100} unit="%" />

      <Text style={styles.subheading}>하루 평균 걷는 시간</Text>
      <BarChart
        items={d.avgWalkTime.map((g) => ({ label: g.label, value: g.percentage }))}
        max={100}
        unit="%"
      />

      <Text style={styles.subheading}>일주일 기준 산책 빈도</Text>
      <BarChart
        items={d.walkFrequencyPerWeek.map((g) => ({ label: g.label, value: g.percentage }))}
        max={100}
        unit="%"
      />

      <Text style={styles.subheading}>유사 서비스 이용 경험</Text>
      <Text style={styles.body}>
        경험 있음 {d.priorServiceExperienceRate}% · 해당 서비스 평균 만족도{" "}
        {d.priorServiceSatisfaction.mean}점(SD {d.priorServiceSatisfaction.sd})
      </Text>
    </View>
  );
}

/** Ⅳ. 핵심구매요소 */
export function SectionCorePurchaseFactor({
  stats,
  recommendation,
}: {
  stats: QuantStats;
  recommendation: string | null;
}) {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  return (
    <View break>
      <SectionHeader numeral="IV" title="핵심구매요소" />
      <Text style={styles.subheading}>기능별 상대중요도</Text>
      <DivergingBarChart
        items={ranked.map((r) => ({ label: r.name, value: r.score }))}
        maxAbs={5}
      />

      <Text style={styles.subheading}>가장 영향을 미치는 핵심 요인</Text>
      <BarChart
        items={stats.keyFactorDistribution.map((k) => ({ label: k.label, value: k.percentage }))}
        max={100}
        unit="%"
      />

      <Text style={styles.subheading}>해석</Text>
      <Text style={styles.body}>{recommendation ?? "제언이 아직 생성·승인되지 않았습니다."}</Text>
    </View>
  );
}

/** Ⅴ. 4대가치 만족도 (표만 — 정성 카테고리는 sectionsQualitative.tsx에서 문항별로 이어붙인다) */
export function SectionFourValuesTable({ stats }: { stats: QuantStats }) {
  const rows = [
    { label: "기능적 가치", ...stats.fourValues.functional },
    { label: "심미적 가치", ...stats.fourValues.aesthetic },
    { label: "경제적 가치", ...stats.fourValues.economic },
    { label: "사회·공공적 가치", ...stats.fourValues.social },
  ];
  return (
    <View break>
      <SectionHeader numeral="V" title="4대가치 만족도" />
      <BarChart items={rows.map((r) => ({ label: r.label, value: r.mean }))} max={10} unit="점" />
      <View style={[styles.table, { marginTop: 6 }]}>
        <View style={styles.tableRow}>
          <Text style={styles.tableHeaderCell}>가치</Text>
          <Text style={styles.tableHeaderCell}>평균</Text>
          <Text style={styles.tableHeaderCell}>표준편차</Text>
        </View>
        {rows.map((r, i) => (
          <View key={r.label} style={i === rows.length - 1 ? styles.tableRowLast : styles.tableRow}>
            <Text style={styles.tableCell}>{r.label}</Text>
            <Text style={styles.tableCell}>{r.mean}</Text>
            <Text style={styles.tableCell}>{r.sd}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Ⅵ. 사용자 경험 품질 평가 (6.7절: 정성 파이프라인 미적용, 정량만) */
export function SectionUxQuality({ stats }: { stats: QuantStats }) {
  return (
    <View break>
      <SectionHeader numeral="VI" title="사용자 경험 품질 평가" />
      <Text style={styles.subheading}>실용성</Text>
      <BarChart
        items={stats.uxQuality.usability.map((u) => ({ label: u.name, value: u.mean }))}
        max={10}
        unit="점"
      />
      <Text style={styles.subheading}>즐거움</Text>
      <BarChart
        items={stats.uxQuality.fun.map((u) => ({ label: u.name, value: u.mean }))}
        max={10}
        unit="점"
      />
    </View>
  );
}

/** Ⅶ. 교차분석 */
export function SectionCrossAnalysis({ stats }: { stats: QuantStats }) {
  return (
    <View break>
      <SectionHeader numeral="VII" title="교차분석" />
      <Text style={styles.subheading}>연령대별 기능 만족도</Text>
      {stats.crossAnalysis.byAgeGroup.map((g) => (
        <View key={g.group} style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 8.5, fontWeight: "bold", marginBottom: 2 }}>
            {g.group} (n={g.n})
          </Text>
          <BarChart items={g.featureSatisfaction.map((f) => ({ label: f.name, value: f.mean }))} max={10} unit="점" />
        </View>
      ))}

      <Text style={styles.subheading}>성별 기능 만족도</Text>
      {stats.crossAnalysis.byGender.map((g) => (
        <View key={g.group} style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 8.5, fontWeight: "bold", marginBottom: 2 }}>
            {g.group} (n={g.n})
          </Text>
          <BarChart items={g.featureSatisfaction.map((f) => ({ label: f.name, value: f.mean }))} max={10} unit="점" />
        </View>
      ))}
    </View>
  );
}
