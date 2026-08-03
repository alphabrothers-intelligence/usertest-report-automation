// Ⅰ~Ⅱ, Ⅳ~Ⅶ 섹션 — 정량 위주(개요, 인적사항, 핵심구매요소, 4대가치 표, UX품질, 교차분석).
// Ⅲ(기능별 고객경험평가)과 Ⅷ·Ⅸ는 정성 콘텐츠 비중이 커서 sectionsQualitative.tsx에 둔다.
import path from "node:path";
import { Fragment } from "react";
import { View, Text, Image } from "@react-pdf/renderer";
import { styles, colors } from "./theme";
import { RichText } from "./richText";
import {
  VerticalBarChart,
  VerticalBarChartWithAverage,
  RadarChart,
  RankCompositionChart,
  CanvasQuadrantChart,
  PriorityLegendTable,
  PriorityDetailNotes,
  GroupedBarChart,
  RadarChartOverlay,
  GROUP_SERIES_PALETTE,
  UX_GROUP_PALETTE,
  CrossTabStackedBar,
  AGE_BRACKET_COLORS,
  computeNiceRadarRange,
  computeBarWithAverageRange,
  computeRadarLabelMargins,
  mergeRadarLabelMargins,
  maxRadarSizeForColumn,
  RADAR_AXIS_LABEL_FONT_SIZE,
  TransposedRankTable,
} from "./charts";
import type { QuantStats } from "@/lib/quant/compute";
import type { ProductInfo } from "@/lib/productInfo/types";
import { splitCrossAnalysisText } from "@/lib/pipeline/sectionAnalysis";

export type { ProductInfo };

// "영역별 참고 지표" 9칸 다이어그램은 알파브라더스 FGI 원본 평가기준 이미지를 그대로 쓴다
// (2026-07-24 사용자 제공, `data/사분면그래프_평가기준.png` → public/images로 복사. data/는
// gitignore·미배포라 public/images에 둔다 — nps-scale.png와 같은 사유). 코드로 그리던
// CanvasPriorityReference보다 고화질이고 FGI 원본과 100% 동일하다. 사분면 경계·9칸 판정 기준의
// 단일 출처(FGI, CLAUDE.md 참고).
const PRIORITY_REF_PATH = path.join(process.cwd(), "public", "images", "quadrant-priority-reference.png");

/** A4 폭(595.28pt) - 좌우 페이지 여백(theme.ts styles.page.paddingHorizontal 40*2). 실용성/
 * 즐거움처럼 레이더 차트 2개를 한 행에 나란히 놓을 때, 각 열이 실제로 쓸 수 있는 폭을 역산할
 * 때 쓴다(maxRadarSizeForColumn 참고) — 그래프 크기를 이 폭 기준으로 클램프하지 않으면 긴
 * 축 라벨이 옆 열로 넘쳐 반대쪽 레이더 라벨과 겹친다(2026-07-23 실측). */
const PAGE_CONTENT_WIDTH = 515;

/**
 * 28번 컬럼(핵심 요인) raw data 응답값은 "성취 및 보상 요소 (걸음 수 보상, 미션 보상 등)"처럼
 * 설문 선택지 원문에 괄호 설명이 붙어있다 — 실제 발행 보고서는 이 괄호를 떼고 "성취 및 보상
 * 요소"만 표/차트에 쓴다(2026-07-21 실측 대조). `stats.keyFactorDistribution.label`
 * 자체(그리고 golden 체크의 기대값)는 raw data 원문을 그대로 유지해야 하므로, 짧게 보여줄
 * 필요가 있는 화면(차트 x축, 표 셀)에서만 이 함수로 걸러서 쓴다 — 계산 레이어를 안 건드리는
 * 이유는 CLAUDE.md의 "정량 계산 결과는 편집하지 않는다" 원칙 때문.
 */
export function shortenLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function SectionHeader({ numeral, title }: { numeral: string; title: string }) {
  return (
    <View id={`section-${numeral}`} style={styles.sectionHeader} wrap={false}>
      <Text style={styles.sectionHeaderBadge}>{numeral}</Text>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
    </View>
  );
}

/** 장(章) 안의 하위 절 제목 — 실제 발행 보고서의 "1 |  제목" 번호 박스 헤더 형식(2026-07-21
 * 실측 대조). SectionHeader(장 전체 배너)보다 한 단계 작은 소제목 단위로, Ⅵ·Ⅶ장처럼 "결과"와
 * "결과 분석"이 뚜렷이 나뉘는 장에서 쓴다. */
export function SubsectionHeader({ number, title }: { number: number; title: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        borderWidth: 1,
        borderColor: colors.navy,
        marginTop: 10,
        marginBottom: 8,
      }}
      wrap={false}
    >
      <View
        style={{
          width: 26,
          backgroundColor: colors.headerBadgeBg, // 원본은 번호 칸을 연한 라벤더로 칠한다(2026-07-23 지적)
          borderRightWidth: 1,
          borderRightColor: colors.navy,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 6,
        }}
      >
        <Text style={{ fontSize: 10, fontWeight: "bold", color: colors.navy }}>{number}</Text>
      </View>
      <View style={{ flex: 1, justifyContent: "center", paddingVertical: 6, paddingHorizontal: 10 }}>
        <Text style={{ fontSize: 9.5, fontWeight: "bold" }}>{title}</Text>
      </View>
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
  // 설문 문항은 실제 raw data 헤더에서 도출한 stats.surveyQuestions를 그대로 쓴다(2026-07-23,
  // "문항은 반드시 raw data 기반이어야 한다"). computeQuantStats가 headerRow로 이미 구성해 둔다.
  const surveyRows = stats.surveyQuestions;
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
      <SubsectionHeader number={1} title="제품 소개" />

      {/* 원본 3페이지: "기업 개요"·"제품 및 서비스 개요"는 라벨 셀이 연한 파랑(#dfe6f7)인
          제대로 된 표다(2026-07-22 원본 대조 — 기존 FieldRow "라벨: 값" 단순 나열을 표로
          교체). 값이 없으면 "입력 필요"로 남긴다(AI가 임의로 채우지 않음, 5.0절). */}
      <OverviewTable
        title="기업 개요"
        rows={[
          [
            { label: "기업명", value: productInfo?.companyName },
            { label: "홈페이지", value: productInfo?.homepage },
          ],
          [
            { label: "대표자", value: productInfo?.representative },
            { label: "업무 담당자", value: productInfo?.contactPerson },
          ],
        ]}
      />
      <View style={{ marginTop: 8 }}>
        <OverviewTable
          title="제품 및 서비스 개요"
          rows={[
            [{ label: "서비스 명", value: productInfo?.serviceName, wide: true }],
            [{ label: "서비스 요약", value: productInfo?.serviceSummary, wide: true, alignLeft: true }],
            [
              { label: "사업 영역", value: productInfo?.businessArea },
              { label: "산업 분야", value: productInfo?.industry },
            ],
            [
              { label: "운영 환경", value: productInfo?.operatingEnvironment },
              { label: "사업화 단계", value: productInfo?.businessStage },
            ],
            // 원본 3페이지 "주요 기능" 행(기능 스크린샷 + 기능명·설명 목록). 이미지 첨부 흐름이
            // 아직 없어 자동으로 못 채우므로(알려진 갭), 담당자가 직접 작성해 넣도록 빈 칸으로
            // 크게 비워 둔다(2026-07-22 요청).
            [{ label: "주요 기능", value: productInfo?.mainFeatures, wide: true, alignLeft: true, minHeight: 150 }],
          ]}
        />
      </View>

      <View break>
        <SubsectionHeader number={2} title="사용성 테스트 진행 일정" />
      </View>
      {/* 원본 4페이지: 진행 일정은 불릿 목록(• 일 시 / • 테스트 대상 / • 담당자). 값은 담당자가
          자유 입력한다(raw data엔 없는 정보). */}
      <OverviewBullet label="일  시" value={productInfo?.testPeriod} />
      <OverviewBullet label="테스트 대상" value={productInfo?.testTarget} />
      <OverviewBullet label="담당자" value={productInfo?.testManager} />

      <SubsectionHeader number={3} title="사용성 테스트 설문 항목" />
      <SurveyQuestionTable stages={surveyStages} totalCount={surveyRows.length} />
    </View>
  );
}

/** 원본 3페이지의 "기업 개요"·"제품 및 서비스 개요" 표 — 상단에 제목 배너(연한 파랑),
 * 아래로 라벨 셀(연한 파랑 #dfe6f7)·값 셀(흰색) 행들. 한 행에 1개(wide) 또는 2개의
 * 라벨-값 쌍을 넣는다. */
function OverviewTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value?: string | null; wide?: boolean; alignLeft?: boolean; minHeight?: number }[][];
}) {
  const LABEL_BG = "#dfe6f7";
  return (
    // 표 전체를 wrap={false}로 묶지 않고(2026-07-23 페이지 넘김 유연화), 각 행만 wrap={false}로
    // 원자 단위로 둔다 — "주요 기능"처럼 큰 빈 칸이 있는 행도 통째로 다음 페이지로 넘어가되,
    // 표 자체는 페이지 경계에서 행 단위로 자연스럽게 쪼개진다.
    <View style={styles.table}>
      <View style={{ backgroundColor: LABEL_BG, padding: 5, borderBottomWidth: 1, borderBottomColor: colors.border }} wrap={false}>
        <Text style={{ fontSize: 9, fontWeight: "bold", textAlign: "center", color: colors.navy }}>{title}</Text>
      </View>
      {rows.map((cells, ri) => (
        <View
          key={ri}
          wrap={false}
          style={ri === rows.length - 1 ? { flexDirection: "row" } : { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          {cells.map((c, ci) => (
            <Fragment key={ci}>
              <View
                style={{
                  width: 90,
                  backgroundColor: LABEL_BG,
                  justifyContent: "center",
                  padding: 5,
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 8.5, fontWeight: "bold", textAlign: "center" }}>{c.label}</Text>
              </View>
              {c.value ? (
                <Text
                  style={{
                    flex: 1,
                    fontSize: 8.5,
                    lineHeight: 1.4,
                    textAlign: c.alignLeft ? "left" : "center",
                    padding: 5,
                    minHeight: c.minHeight,
                    borderRightWidth: ci < cells.length - 1 ? 1 : 0,
                    borderRightColor: colors.border,
                  }}
                >
                  {c.value}
                </Text>
              ) : (
                <Text
                  style={{
                    flex: 1,
                    fontSize: 8.5,
                    color: colors.subtext,
                    textAlign: c.alignLeft ? "left" : "center",
                    padding: 5,
                    minHeight: c.minHeight,
                    borderRightWidth: ci < cells.length - 1 ? 1 : 0,
                    borderRightColor: colors.border,
                  }}
                >
                  입력 필요
                </Text>
              )}
            </Fragment>
          ))}
        </View>
      ))}
    </View>
  );
}

function OverviewBullet({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 3, marginLeft: 4 }}>
      <Text style={{ fontSize: 8.5 }}>• </Text>
      <Text style={{ fontSize: 8.5, fontWeight: "bold" }}>{label} : </Text>
      {value ? (
        <Text style={{ fontSize: 8.5, flex: 1 }}>{value}</Text>
      ) : (
        <Text style={{ fontSize: 8.5, color: colors.subtext }}>입력 필요</Text>
      )}
    </View>
  );
}

/** 원본 4~5페이지의 설문 항목 표 — 단계(병합 셀) | Q번호 | 주요 활동 3열 + "총 N 문항" 푸터.
 * 단계 열은 rowspan이 없어 flex 가중치(문항 수)로 병합 셀처럼 흉내낸다. */
function SurveyQuestionTable({
  stages,
  totalCount,
}: {
  stages: { stage: string; questions: string[] }[];
  totalCount: number;
}) {
  let qno = 0;
  return (
    // 표 전체를 wrap={false}로 묶지 않는다(2026-07-23) — 그러면 한 페이지에 다 못 들어갈 때
    // 표 통째로 다음 페이지로 밀려 앞 페이지에 소제목만 남는 어색한 빈 공간이 생긴다. 대신
    // 표는 자연스럽게 페이지 경계에서 쪼개지게 두되, **각 단계 블록에만 wrap={false}**를 줘서
    // 한 단계(단계 셀+그 문항들)가 페이지 중간에서 잘리지 않고 통째로 넘어가게 한다. 문항이
    // 많은 raw data에서도 표가 여러 페이지에 걸쳐 자연스럽게 이어진다.
    <View style={styles.table}>
      {/* 헤더 행 */}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }} wrap={false}>
        <Text style={{ width: 90, backgroundColor: colors.chartBannerBg, fontSize: 8, fontWeight: "bold", textAlign: "center", padding: 5, borderRightWidth: 1, borderRightColor: colors.border, color: colors.navy }}>
          단계
        </Text>
        <Text style={{ width: 34, backgroundColor: colors.chartBannerBg, fontSize: 8, fontWeight: "bold", textAlign: "center", padding: 5, borderRightWidth: 1, borderRightColor: colors.border, color: colors.navy }}>
          문항
        </Text>
        <Text style={{ flex: 1, backgroundColor: colors.chartBannerBg, fontSize: 8, fontWeight: "bold", textAlign: "center", padding: 5, color: colors.navy }}>
          주요 활동
        </Text>
      </View>
      {/* **문항 단위 행 흐름 구조**(2026-07-23 재수정): 예전엔 단계를 하나의 wrap={false}
          블록으로 묶었는데, 문항이 많은 단계(예: 사용자 경험 품질평가 8문항)가 남은 페이지
          공간에 안 들어가면 그 블록 통째로 다음 페이지로 밀려 앞 페이지에 큰 빈 공간이 생겼다
          (2026-07-23 지적: "이런 페이지 넘김은 옳지 않다"). 이제 **문항 한 줄씩** 흐르게 해서
          페이지를 꽉 채우고, 단계가 페이지 경계를 넘어가면 그 자리에서 자연스럽게 쪼개진다.
          단계 라벨은 그 단계의 첫 문항 행에만 넣고(위쪽 정렬), 단계 셀은 그룹 내부에선 아래
          테두리 없이 파란 배경으로 이어지다 단계 끝에서만 구분선을 그어 "병합된 열"처럼 보이게
          한다 — 단계가 페이지를 넘어가면 다음 페이지엔 라벨 없는 파란 칸이 이어져(같은 단계
          연속임을 시각적으로 유지) 페이지가 낭비되지 않는다. */}
      {stages.flatMap((stage, si) =>
        stage.questions.map((q, qi) => {
          qno += 1;
          const isStageLast = qi === stage.questions.length - 1;
          const isVeryLast = si === stages.length - 1 && isStageLast;
          return (
            <View key={`${si}-${qi}`} wrap={false} style={{ flexDirection: "row" }}>
              {/* 단계 셀 — 그룹 내부는 아래 테두리 없이 이어지고, 단계 끝 행에만 구분선 */}
              <View
                style={{
                  width: 90,
                  backgroundColor: "#eef2fb",
                  alignItems: "center",
                  paddingHorizontal: 4,
                  paddingTop: qi === 0 ? 6 : 0,
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                  borderBottomWidth: isStageLast && !isVeryLast ? 1 : 0,
                  borderBottomColor: colors.border,
                }}
              >
                {qi === 0 ? (
                  <Text style={{ fontSize: 7.5, fontWeight: "bold", textAlign: "center" }}>{stage.stage}</Text>
                ) : null}
              </View>
              {/* Q번호 + 주요 활동 — 매 문항 행마다 아래 구분선(맨 마지막 행 제외) */}
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  borderBottomWidth: isVeryLast ? 0 : 1,
                  borderBottomColor: colors.border,
                }}
              >
                {/* 행 세로 여백을 줄여(5→3) 표준 문항 수(약 31개)가 "총 문항" 푸터까지 한
                    페이지에 다 들어가게 한다(2026-07-23, 4줄+푸터만 다음 페이지로 넘쳐 여백이
                    생기던 문제). 문항이 훨씬 많은 raw data는 여전히 문항 단위로 자연스럽게
                    다음 페이지로 이어진다. */}
                <Text style={{ width: 34, fontSize: 7.5, fontWeight: "bold", textAlign: "center", paddingVertical: 3, paddingHorizontal: 5, borderRightWidth: 1, borderRightColor: colors.border }}>
                  Q{qno}
                </Text>
                <Text style={{ flex: 1, fontSize: 7.5, paddingVertical: 3, paddingHorizontal: 5, lineHeight: 1.3 }}>{q}</Text>
              </View>
            </View>
          );
        }),
      )}
      {/* 총 문항 푸터 */}
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.chartBannerBg, padding: 5 }}>
        <Text style={{ fontSize: 8.5, fontWeight: "bold", textAlign: "center", color: colors.navy }}>총 {totalCount} 문항</Text>
      </View>
    </View>
  );
}

/** Ⅱ. 인적사항 및 특성조사 — 실제 발행 보고서 형식(질문 텍스트 + "[ 응답 결과 ]" 세로 막대그래프
 * 한 세트씩, 2026-07-21 실측 대조). 질문 문구는 lib/pipeline/surveyQuestions.ts와 동일해야
 * Ⅰ장 설문 항목 표와 어긋나지 않는다. */
export function SectionDemographics({ stats }: { stats: QuantStats }) {
  const d = stats.demographics;
  // 원본 설문지의 선택지 순서를 재현한다. categoryDistribution의 기본 "응답 수 내림차순"
  // 정렬은 통계에는 맞지만, 차트의 막대 순서가 원본과 달라져 시각 fidelity를 떨어뜨린다.
  const inReferenceOrder = <T extends { label: string }>(rows: T[], order: string[]) =>
    [...rows].sort((a, b) => {
      const ai = order.findIndex((label) => a.label.replace(/\s+/g, "").includes(label));
      const bi = order.findIndex((label) => b.label.replace(/\s+/g, "").includes(label));
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
  const gender = inReferenceOrder(d.gender, ["남성", "여성"]);
  const walkTime = inReferenceOrder(d.avgWalkTime, ["15분미만", "15분이상30분미만", "30분이상1시간미만", "1시간이상2시간미만", "2시간이상"]);
  const walkFrequency = inReferenceOrder(d.walkFrequencyPerWeek, ["전혀하지않는다", "1~2일", "3~4일", "5~6일", "매일"]);
  const genderByAge = inReferenceOrder(d.genderByAgeBracket, ["남성", "여성"]);
  return (
    <View break>
      <SectionHeader numeral="II" title="인적 사항 및 특성 조사" />
      <Text style={[styles.qHeading, { marginTop: 6 }]}>Q1. 나이를 입력해주세요</Text>
      <VerticalBarChart items={d.ageDistribution.map((g) => ({ label: g.label, value: g.percentage }))} max={100} yMax={40} unit="%" />

      <Text style={styles.qHeading}>Q2. 성별을 선택해주세요</Text>
      <VerticalBarChart
        items={gender.map((g) => ({ label: g.label, value: g.percentage }))}
        max={100}
        yMax={80}
        unit="%"
        footer={
          <CrossTabStackedBar
            rows={genderByAge.map((r) => ({ label: r.label, segments: r.segments }))}
            categories={[...genderByAge[0]?.segments.map((s) => s.name) ?? []]}
            maxValue={Math.max(1, ...genderByAge.map((r) => r.segments.reduce((sum, s) => sum + s.count, 0)))}
            colorMap={AGE_BRACKET_COLORS}
            axisTitle="응답자 수"
            embedded
          />
        }
      />

      {/* 원본은 Q1·Q2(성별×연령 교차표 포함)를 한 페이지에, Q3~Q5를 다음 페이지에
          고정한다. 자동 흐름에 맡기면 Q3 제목만 앞 페이지 하단에 붙는 현상이 생긴다. */}
      <View break>
        <Text style={styles.qHeading}>Q3. 현재 사용하시는 스마트폰 운영체제를 선택해주세요</Text>
      <VerticalBarChart items={d.os.map((g) => ({ label: g.label, value: g.percentage }))} max={100} yMax={60} unit="%" />

      <Text style={styles.qHeading}>Q4. 하루 평균 걷는 시간은 어느 정도인가요?</Text>
      <VerticalBarChart
        items={walkTime.map((g) => ({ label: g.label, value: g.percentage }))}
        max={100}
        yMax={40}
        unit="%"
      />

      <Text style={styles.qHeading}>Q5. 일주일에 몇 일 정도 산책을 하시나요?</Text>
      <VerticalBarChart
        items={walkFrequency.map((g) => ({ label: g.label, value: g.percentage }))}
        max={100}
        yMax={40}
        unit="%"
      />

      {/* 원본 리바랩스 보고서의 Ⅱ장은 Q1~Q5로 끝난다. raw data에 있는 "유사 서비스
          이용 경험"은 이후 분석에서 사용할 수 있는 보조 지표이지만, 이 위치에 별도 단락으로
          넣으면 원본에는 없는 페이지가 생긴다. 원본 재현 PDF에서는 표시하지 않는다. */}
      </View>
    </View>
  );
}

/** Ⅳ. 핵심구매요소 — 실제 발행 보고서 형식(핵심 요인 응답 분포 + 순위표, 순위 구성비 누적
 * 막대, 상대중요도 순위 종합표, 중요도-만족도 사분면 그래프, 2026-07-21 실측 대조). */
export function SectionCorePurchaseFactor({
  stats,
  recommendation,
}: {
  stats: QuantStats;
  recommendation: string | null;
}) {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const satisfactionByName = new Map(stats.featureSatisfaction.map((f) => [f.name, f.mean]));
  return (
    <View break>
      <SectionHeader numeral="IV" title="핵심구매요소" />
      <Text style={styles.subheading}>가장 영향을 미치는 핵심 요인</Text>
      <VerticalBarChart
        items={stats.keyFactorDistribution.map((k) => ({ label: shortenLabel(k.label), value: k.percentage }))}
        max={100}
        unit="%"
        title="[ 핵심구매요소 조사 결과 ]"
      />
      <View style={[styles.table, { marginTop: 6 }]}>
        <View style={styles.tableRow}>
          <Text style={[styles.tableHeaderCell, { flex: 0.5 }]}>No</Text>
          <Text style={[styles.tableHeaderCell, { flex: 2 }]}>핵심 기능</Text>
          <Text style={styles.tableHeaderCell}>순위</Text>
          <Text style={styles.tableHeaderCell}>비율</Text>
        </View>
        {stats.keyFactorDistribution.map((k, i) => (
          <View
            key={k.label}
            style={i === stats.keyFactorDistribution.length - 1 ? styles.tableRowLast : styles.tableRow}
          >
            <Text style={[styles.tableCell, { flex: 0.5 }]}>{i + 1}</Text>
            <Text style={[styles.tableCell, { flex: 2 }]}>{shortenLabel(k.label)}</Text>
            <Text style={styles.tableCell}>{i + 1}위</Text>
            <Text style={styles.tableCell}>{k.percentage}%</Text>
          </View>
        ))}
      </View>

      <Text style={styles.subheading}>기능 중요도 순위 구성</Text>
      <RankCompositionChart
        compositions={stats.rankPositionComposition}
        candidateNames={stats.featureSatisfaction.map((f) => f.name)}
      />

      <Text style={styles.subheading}>기능별 중요 순위 종합</Text>
      <Text style={[styles.small, { marginBottom: 4 }]}>
        상대 중요도: 중요 순위 응답을 0점 기준 +5~-5점 점수로 환산한 값
      </Text>
      <TransposedRankTable
        rowLabel="기능"
        valueLabel="상대 중요도"
        items={ranked.map((r) => ({ name: r.name, value: r.score }))}
      />

      {/* 원본 28페이지: 이 절은 "기능별 상대 중요도-만족도 그래프" **파란 배너 제목 하나**로
          시작한다(2026-07-22 원본 재대조) — 기존엔 그 위에 검은 굵은 소제목까지 있어 제목이
          둘이었다(중복). **배너에 걸려있던 `break`는 제거했다(2026-07-25)** — 무조건 새
          페이지로 넘기는 바람에 바로 위 "기능별 중요 순위 종합" 표 페이지에 공간이 남아도
          못 쓰고, 배너+차트가 있는 새 페이지도 절반만 채운 채 끝나는 큰 낭비가 실측 확인됐다.
          대신 배너+차트를 하나의 `wrap={false}`로만 묶어서(고아 방지는 그대로 유지) 앞
          표 페이지에 공간이 남으면 거기서 이어지고, 안 남으면 통째로만 다음 페이지로 넘어가게
          했다 — CLAUDE.md 페이지 넘김 원칙(`break`는 무조건 새 페이지, `wrap={false}`는
          안 쪼개짐만 보장)을 따른 선택. */}
      <View wrap={false}>
        <View style={{ backgroundColor: colors.chartBannerBg, paddingVertical: 4, marginBottom: 6 }}>
          <Text style={{ fontSize: 9, fontWeight: "bold", textAlign: "center", color: colors.navy }}>
            기능별 상대 중요도-만족도 그래프
          </Text>
        </View>
        <View style={{ alignItems: "center" }}>
          {/* 캔버스 기반(CanvasQuadrantChart) — 실제 폰트 ctx.measureText()로 라벨 폭을 정확히
              재므로 라벨이 셀을 벗어나지 않는다. **크기: 원본은 셀이 정사각형이라 플롯 영역도
              정사각형이어야 한다(2026-07-22 원본 재대조 — 기존 482×453은 셀이 가로로 약간 넓어
              텍스트가 칸 경계를 넘어 보였다)**. renderQuadrantChart의 좌우 여백 합 54, 상하 50을
              빼면 플롯이 (w-54)×(h-50) 이므로 w=h+4일 때 정사각형 — 460×456으로 플롯 406×406
              정사각형을 만든다. */}
          <CanvasQuadrantChart
            items={ranked.map((r) => ({
              name: r.name,
              importance: r.score,
              satisfaction: satisfactionByName.get(r.name) ?? 0,
            }))}
            width={460}
            height={456}
          />
        </View>
      </View>

      {/* "영역별 참고 지표": 원본 28페이지는 이미지(좌)와 우선순위표+판정기준(우)을 나란히
          배치한다(2026-07-25 원본 재대조로 확인) — 이전엔 "Image를 flex 형제 열에 두면 옆
          열이 붕괴해 범례가 사라지는 실측 버그"(2026-07-24)를 피하려 위/아래로 쌓았었는데,
          이번엔 이미지 폭을 고정 pt(200, flex 아님)로 주고 실제 렌더로 재확인한 결과 옆 열이
          붕괴하지 않고 정상적으로 나란히 렌더링됐다 — 그 버그는 flex 기반 폭이 원인이었던
          것으로 추정된다. 제목+이미지+우측표를 하나의 wrap={false}로 묶었다(이미지 폭을
          200으로 줄인 뒤로는 전체 블록 높이가 짧아져 사분면 차트 뒤 남은 공간에 통째로 들어감,
          실측 확인). */}
      <View wrap={false}>
        <View style={{ backgroundColor: colors.bgAlt, paddingVertical: 3, marginTop: 3, marginBottom: 4 }}>
          <Text style={{ fontSize: 9, fontWeight: "bold", textAlign: "center" }}>영역별 참고 지표</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <View style={{ alignItems: "center" }}>
            <Image src={PRIORITY_REF_PATH} style={{ width: 200 }} />
          </View>
          <View style={{ flex: 1 }}>
            <PriorityLegendTable />
            <View style={{ marginTop: 6 }}>
              <PriorityDetailNotes />
            </View>
          </View>
        </View>
      </View>

      {/* 2026-07-22엔 제목+본문을 wrap={false}로 묶어 고아 제목을 막았는데, 실제 정성 분석이
          붙은 recommendation 텍스트는 여러 문단+불릿으로 꽤 길어서(2026-08-03 실측) 그 전체를
          한 페이지에 억지로 욱여넣으려다 Ⅴ장에서 겪은 것과 같은 레이아웃 붕괴 위험이 있다 —
          제목만 wrap={false}로 남기고 본문은 자연스럽게 흐르게 둔다. */}
      <Text style={[styles.subheading, { marginTop: 4, marginBottom: 3 }]} wrap={false}>해석</Text>
      <RichText value={recommendation ?? "제언이 아직 생성·승인되지 않았습니다."} />
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
  const average = Math.round((rows.reduce((a, r) => a + r.mean, 0) / rows.length) * 100) / 100;
  const valueMeans = rows.map((r) => r.mean);
  const [chartMin, chartMax] = computeBarWithAverageRange(valueMeans, average);
  return (
    <View break>
      <SectionHeader numeral="V" title="4대 가치 만족도" />
      <VerticalBarChartWithAverage
        items={rows.map((r) => ({ label: r.label, value: r.mean }))}
        min={chartMin}
        max={chartMax}
        unit="점"
        title="[ 4대 가치 만족도 종합 결과 ]"
        average={average}
        yAxisTitle="만족도 평균"
        legendBarLabel="가치별 만족도 평균"
        legendAverageLabel="전체 가치 만족도 평균"
      />
      <View style={[styles.table, { marginTop: 6 }]}>
        <View style={styles.tableRow}>
          <Text style={styles.tableHeaderCell}>가치</Text>
          <Text style={styles.tableHeaderCell}>평균</Text>
          <Text style={styles.tableHeaderCell}>표준편차</Text>
        </View>
        {rows.map((r, i) => (
          <View key={r.label} style={i === rows.length - 1 ? styles.tableRowLast : styles.tableRow}>
            <Text style={styles.tableCell}>{r.label}</Text>
            <Text style={styles.tableCell}>{r.mean.toFixed(2)}</Text>
            <Text style={styles.tableCell}>{r.sd.toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Ⅵ. 사용자 경험 품질 평가 (6.7절: 정성 파이프라인 미적용, 정량만) — 실제 발행 보고서 형식
 * (전체 8축 + 실용성/즐거움 4축씩 방사형 차트 3개, 2026-07-21 실측 대조). 축 값 범위에 맞춰
 * 확대한 min~max로 그려야 값 차이가 눈에 보인다(0~10 전체 스케일로 그리면 다 비슷해 보임 —
 * 실제 보고서도 4.00~6.50처럼 확대된 축을 쓴다). */
/** 실용성/즐거움 4항목 점수를 실제 문항명과 함께 표로 보여준다(실제 발행 보고서 형식,
 * 2026-07-21). 그룹 내 최댓값/최솟값 하이라이트(파란/주황 고정)는 건드리지 않는다 — 그룹
 * 헤더 셀 배경(headerColor)만 그 그룹의 레이더 차트와 같은 색을 쓰도록 호출부에서
 * UX_GROUP_PALETTE로 넘긴다(2026-07-21, "표 컬럼 색도 그래프 색으로 맞춰라" 요청). */
function UxScoreTable({
  label,
  headerColor,
  items,
}: {
  label: string;
  headerColor: string;
  items: { name: string; mean: number }[];
}) {
  const maxVal = Math.max(...items.map((i) => i.mean));
  const minVal = Math.min(...items.map((i) => i.mean));
  return (
    // wrap={false} 필수 — 없으면 표 한 줄(헤더 행/점수 행)이 페이지 경계에서 반으로 잘려
    // 헤더만 이전 페이지에 남고 값은 다음 페이지로 넘어가는 게 실측 확인됐다(2026-07-22).
    <View style={[styles.table, { flexDirection: "row", marginBottom: 3 }]} wrap={false}>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 8,
            fontWeight: "bold",
            textAlign: "center",
            backgroundColor: headerColor,
            padding: 3,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          {label}
        </Text>
        {/* "점수" 라벨 셀 배경(#f2f2f2)도 실제 보고서 39페이지 픽셀 샘플링 값이다
            (2026-07-22) — 기존엔 배경이 아예 없었다(흰색). */}
        <Text style={{ fontSize: 8, textAlign: "center", padding: 3, backgroundColor: "#f2f2f2" }}>점수</Text>
      </View>
      {items.map((item) => {
        // 최댓값/최솟값 하이라이트 색도 같은 방식으로 실측 보정(#dbeafe/#fde4d0 →
        // #dee5f6/#fee6d8, 톤은 거의 같지만 원본과 정확히 맞췄다).
        const cellBg = item.mean === maxVal ? "#dee5f6" : item.mean === minVal ? "#fee6d8" : undefined;
        return (
          <View key={item.name} style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: colors.border }}>
            <Text
              style={{
                fontSize: 7.5,
                textAlign: "center",
                backgroundColor: colors.bgAlt,
                padding: 3,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              {item.name}
            </Text>
            <Text style={{ fontSize: 8, fontWeight: "bold", textAlign: "center", padding: 3, backgroundColor: cellBg }}>
              {item.mean}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** 원본 발행 보고서 37~38페이지의 개별 문항 점수표 — "실용성1) 조작 편의성 점수" 배너 +
 * 평균/표준편차 2열 표 + "전체" 행. 그룹(실용성/즐거움)에 따라 배너 배경색을 그 그룹의 레이더
 * 색과 맞춘다(headerColor). 원본은 문항마다 "* 불편하다: 0점 / 편하다: 10점" 같은 양극 척도
 * 안내가 붙지만, 그 양극 단어는 raw data 헤더에 없어(설문 문항 원문이 필요) 일반화할 수 없으므로
 * "0~10점 척도" 일반 안내로 대체한다 — 다른 raw data에도 항상 맞는 표현. */
function UxSingleScoreTable({
  title,
  headerColor,
  mean,
  sd,
}: {
  title: string;
  headerColor: string;
  mean: number;
  sd: number;
}) {
  return (
    <View style={{ marginBottom: 8 }} wrap={false}>
      <Text style={[styles.qHeading, { marginTop: 6, marginBottom: 3 }]}>{title}</Text>
      <Text style={[styles.small, { textAlign: "right", marginBottom: 2 }]}>* 0점 ~ 10점 척도</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <Text
            style={{
              flex: 1,
              fontSize: 8,
              fontWeight: "bold",
              textAlign: "center",
              padding: 4,
              backgroundColor: headerColor,
            }}
          >
            {title} 점수
          </Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.tableHeaderCell, { flex: 1 }]}> </Text>
          <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: "center" }]}>평균</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: "center", borderRightWidth: 0 }]}>
            표준편차
          </Text>
        </View>
        <View style={styles.tableRowLast}>
          <Text style={[styles.tableCell, { flex: 1, fontWeight: "bold", textAlign: "center" }]}>전체</Text>
          <Text style={[styles.tableCell, { flex: 1, textAlign: "center" }]}>{mean}</Text>
          <Text style={[styles.tableCell, { flex: 1, textAlign: "center", borderRightWidth: 0 }]}>{sd}</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Ⅵ. 사용자 경험 품질 평가. [전체]는 그룹 구분이 없으니 색이 무엇이든 상관없어 기존 teal을
 * 그대로 둔다(2026-07-21 사용자 확인). [실용성]/[즐거움]처럼 raw data가 여러 그룹으로 나뉘는
 * 경우엔 그룹마다 다른 색을 쓴다 — `uxGroups` 배열로 일반화했다: 지금은 WALLA 표준 스키마상
 * 실용성/즐거움 2개로 고정돼 있지만(PRD 6.7절 8축=실용성4+즐거움4), 이 렌더링 코드 자체는
 * "그룹 이름이 실용성/즐거움이다" 또는 "그룹이 2개다"를 가정하지 않는다 — `stats.uxQuality`가
 * 그룹을 몇 개, 어떤 이름으로 주더라도 배열을 그대로 순회해 UX_GROUP_PALETTE에서 순서대로
 * 색을 꺼내 쓰므로, 다른 raw data에서 그룹 구성이 달라져도(이름이 다르거나 그룹이 3개 이상)
 * 같은 방식으로 동작한다.
 */
export function SectionUxQuality({ stats, uxQualityAnalysis }: { stats: QuantStats; uxQualityAnalysis?: string | null }) {
  const uxGroups = [
    { name: "실용성", items: stats.uxQuality.usability },
    { name: "즐거움", items: stats.uxQuality.fun },
  ];
  const all = uxGroups.flatMap((g) => g.items);
  const values = all.map((u) => u.mean);
  const { min, max, levels } = computeNiceRadarRange(values);
  const thinDivider = { borderTopWidth: 0.5, borderTopColor: colors.border };
  // 2026-07-22 재요청("실용성/즐거움 도표가 너무 작다 — 여백을 줄이고 그래프 크기를
  // 키우면 한 페이지 안에 3개+표까지 다 들어간다")에 따라 85→105로 확대. **2026-07-23**:
  // computeRadarLabelMargins를 가로/세로 분리 계산으로 바꾸면서(라벨 텍스트 폭이 위/아래
  // 여백에 불필요하게 반영되던 버그 수정) 캔버스 크기가 크게 줄어 페이지에 여유가 생겼다 —
  // 105→150으로 키웠는데, 오른쪽으로 뻗는 긴 라벨("게임 진행 자연스러움")의 캔버스가 열
  // 폭을 넘으면 옆 레이더 라벨과 겹치는 문제가 있어(maxRadarSizeForColumn 주석 참고)
  // 실제 사용 가능한 열 폭 기준으로 클램프한다 — 다른 raw data에서 축 라벨이 더 길어져도
  // 항상 안전하다.
  const uxColumnWidth = PAGE_CONTENT_WIDTH / uxGroups.length - 4;
  // 상한 210 — 축 라벨 줄바꿈(wrapRadarLabel) 이후 열 폭이 허용하는 최댓값(실측 ~167)까지
  // 커질 수 있게 넉넉히 잡는다(2026-07-22, "페이지 아래 여백을 쓰도록 도표를 키워달라").
  const GROUP_RADAR_SIZE = Math.min(
    210,
    ...uxGroups.map((g) => maxRadarSizeForColumn(g.items.map((u) => u.name), uxColumnWidth)),
  );
  // 실용성/즐거움처럼 같은 행에 나란히 놓이는 레이더는 그룹마다 축 라벨 길이가 달라 각자
  // 여백을 계산하면 캔버스 크기가 달라져 나란히 놓았을 때 그리드 높이가 어긋나 보인다
  // (2026-07-22 실측: "두 그래프의 높이가 안 맞아요"). 그룹별로(각자의 실제 축 개수·각도
  // 기준으로) 계산한 여백을 mergeRadarLabelMargins로 합쳐서 모든 그룹 레이더에 똑같이
  // 넘긴다 — 두 그룹 라벨을 하나의 배열로 합쳐서 계산하면 축 개수(n)가 실제와 달라져 각도
  // 계산이 틀어지므로 반드시 그룹별로 따로 계산해야 한다(2026-07-23).
  const groupLabelMargin = mergeRadarLabelMargins(
    ...uxGroups.map((g) =>
      computeRadarLabelMargins(g.items.map((u) => u.name), GROUP_RADAR_SIZE, RADAR_AXIS_LABEL_FONT_SIZE),
    ),
  );

  return (
    <View break>
      <SectionHeader numeral="VI" title="사용자 경험 품질 평가" />

      {/* 원본 37~38페이지: "1. 사용자 경험 품질 평가 결과"는 8개 문항(실용성1~4·즐거움1~4)을
          각각 개별 점수표로 나열한다. 기존엔 이 부분을 통째로 빼고 레이더(원본 39페이지, "2.
          ...결과 분석")만 그렸는데, 원본 대조 요청으로 개별 문항표를 복원했다(2026-07-22). */}
      <SubsectionHeader number={1} title="사용자 경험 품질 평가 결과" />
      {uxGroups.map((group, gi) =>
        group.items.map((item, idx) => (
          <UxSingleScoreTable
            key={`${group.name}-${idx}`}
            title={`${group.name}${idx + 1}) ${item.name}`}
            headerColor={UX_GROUP_PALETTE[gi % UX_GROUP_PALETTE.length].header}
            mean={item.mean}
            sd={item.sd}
          />
        )),
      )}

      {/* 원본은 개별 문항표(37~38p)와 레이더 분석(39p)이 페이지가 나뉜다 — 분석 소절을 새
          페이지에서 시작한다. */}
      <View break>
        <SubsectionHeader number={2} title="사용자 경험 품질 평가 결과 분석" />
      </View>
      <Text style={[styles.subheading, { marginTop: 2, marginBottom: 2 }]}>[전체]</Text>
      <View style={{ alignItems: "center" }}>
        <RadarChart
          axes={all.map((u) => ({ label: u.name, value: u.mean }))}
          min={min}
          max={max}
          gridLevels={levels}
          size={Math.min(260, maxRadarSizeForColumn(all.map((u) => u.name), PAGE_CONTENT_WIDTH))}
        />
      </View>

      {/* [전체]와 그룹별 레이더 사이에 옅고 얇은 가로 실선(2026-07-21 요청) — 실제 발행
          보고서(39페이지)를 직접 대조해보니 그룹(실용성/즐거움)끼리는 세로선 없이 그냥
          나란히만 배치돼 있어서, 세로선은 뺐다(2026-07-22 정정 — Ⅶ장 성별 비교는 원본에
          세로선이 있어 그대로 둔다, 서로 다른 절이라 원본 서식이 다르다). */}
      <View style={[{ marginTop: 2, paddingTop: 2 }, thinDivider]}>
        <View style={{ flexDirection: "row" }}>
          {uxGroups.map((group, i) => {
            const palette = UX_GROUP_PALETTE[i % UX_GROUP_PALETTE.length];
            return (
              <View key={group.name} style={{ flex: 1, alignItems: "center" }}>
                <Text style={[styles.subheading, { marginTop: 2, marginBottom: 1 }]}>[{group.name}]</Text>
                <RadarChart
                  axes={group.items.map((u) => ({ label: u.name, value: u.mean }))}
                  min={min}
                  max={max}
                  gridLevels={levels}
                  size={GROUP_RADAR_SIZE}
                  color={palette.chart}
                  labelMargin={groupLabelMargin}
                />
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ marginTop: 2 }}>
        {uxGroups.map((group, i) => (
          <UxScoreTable
            key={group.name}
            label={group.name}
            headerColor={UX_GROUP_PALETTE[i % UX_GROUP_PALETTE.length].header}
            items={group.items}
          />
        ))}
      </View>
      {/* 2026-08-03 신규 연결: sectionAnalyses.uxQuality(원본 40쪽 "사용자 경험 품질 평가
          종합 해석" + "사용자 경험 품질 세부 해석") — 예전엔 이 텍스트를 아예 안 읽어서
          레이더 차트만 있고 해석 문단이 없었다(웹뷰어는 이미 표시하고 있었음). */}
      {uxQualityAnalysis && (
        <View style={{ marginTop: 6 }}>
          <RichText value={uxQualityAnalysis} />
        </View>
      )}
    </View>
  );
}

export function zoomedRange(values: number[]): [number, number] {
  const min = Math.max(0, Math.floor(Math.min(...values) * 2) / 2 - 0.5);
  const max = Math.min(10, Math.ceil(Math.max(...values) * 2) / 2 + 0.5);
  return [min, max];
}

const FOUR_VALUE_LABELS = ["기능적 가치", "심미적 가치", "경제적 가치", "사회·공공적 가치"];

function fourValuesRow(g: QuantStats["crossAnalysis"]["byAgeGroup"][number]): number[] {
  return [g.fourValues.functional, g.fourValues.aesthetic, g.fourValues.economic, g.fourValues.social];
}

/** 기능별 만족도 + 4대가치 전체를 합친 그룹 평균 — "[전반적 만족도 경향]" 순위 판정에 쓴다. */
function overallGroupScore(g: QuantStats["crossAnalysis"]["byAgeGroup"][number]): number {
  const values = [...g.featureSatisfaction.map((f) => f.mean), ...fourValuesRow(g)];
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/**
 * "[전반적 만족도 경향]" 불렛 — 실제 발행 보고서(2026-07-21 대조)엔 이런 순위 비교 문장이
 * 있는데, LLM 호출 없이 규칙 기반으로 만들 수 있는 부분(어느 그룹이 전 영역에서 가장 높은/
 * 낮은 평균을 보이는지)만 구현했다. 보고서 원문의 "핵심 세그먼트"·"유지·관리형 고객군" 같은
 * 마케팅 판단 문구는 데이터만으로 안전하게 일반화할 수 없는 해석이라(다른 raw data에 그대로
 * 적용하면 근거 없는 주장이 될 위험) 의도적으로 빼뒀다 — 필요하면 recommendation.ts와 같은
 * 방식(Tier 2, AI 초안 + 체크포인트 승인)의 별도 기능으로 만들 것을 검토.
 */
function overallTrendBullets(groups: QuantStats["crossAnalysis"]["byAgeGroup"]): string[] {
  const ranked = groups
    .map((g) => ({ group: g.group, score: overallGroupScore(g) }))
    .sort((a, b) => b.score - a.score);
  return ranked.map(({ group, score }, i) => {
    if (i === 0) return `${group}: 전 영역에서 가장 높은 평균 만족도(${score}점)를 보임`;
    if (i === ranked.length - 1) return `${group}: 전 영역에서 가장 낮은 평균 만족도(${score}점)를 보임`;
    return `${group}: ${ranked[0].group}보다는 낮지만 중간 수준의 평균 만족도(${score}점)를 보임`;
  });
}

/** Ⅶ. 교차분석 — 연령대별/성별 각각 "기능별 만족도 차이"·"4대가치 만족도 차이"를 클러스터
 * 막대그래프로, 성별은 추가로 UX품질(실용성/즐거움) 레이더 오버레이까지 보여준다(실제 발행
 * 보고서 형식, 2026-07-21 실측 대조). 그룹별로 따로 그래프를 나열하던 기존 방식은 그룹 간
 * 비교가 한눈에 안 됐다 — 항목을 x축에, 그룹을 색상 시리즈로 겹쳐서 비교하기 쉽게 했다. */
export function SectionCrossAnalysis({ stats, crossAnalysisText }: { stats: QuantStats; crossAnalysisText?: string | null }) {
  // sectionAnalyses.crossAnalysis — Ⅶ장 "[전반적 만족도 경향]"+"[종합 분석]"(원본 41~42쪽).
  // 2026-08-03 신규 연결: 예전엔 규칙 기반 순위 비교("[전반적 만족도 경향]"만, "핵심 세그먼트"
  // 같은 판단 문구 없이)로 대체돼 있었는데, 이미 CROSS_ANALYSIS_SYSTEM(sectionAnalysis.ts)이
  // 이 두 블록을 다 만들어 저장하고 있었다(웹뷰어는 이미 이 텍스트를 쓰고 있었음) — LLM 텍스트가
  // 있으면 그걸 쓰고, 없을 때만(구버전 report 등) 규칙 기반 문구로 폴백한다.
  const { age: ageAnalysisText, gender: genderAnalysisText } = splitCrossAnalysisText(crossAnalysisText ?? undefined);
  // 실제 발행 보고서는 원본 컬럼 순서가 아니라 Ⅲ장 "기능별 만족도"와 같은 순서(전체 평균
  // 만족도 내림차순)로 항목을 배열한다(2026-07-21 실측 대조) — 여기서도 같은 순서를 쓴다.
  const featureNames = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean).map((f) => f.name);
  const featureValuesInOrder = (group: { featureSatisfaction: { name: string; mean: number }[] }) => {
    const byName = new Map(group.featureSatisfaction.map((f) => [f.name, f.mean]));
    return featureNames.map((name) => byName.get(name) ?? 0);
  };
  const ageGroups = stats.crossAnalysis.byAgeGroup;
  const genderGroups = stats.crossAnalysis.byGender;

  const seriesColor = (i: number) => GROUP_SERIES_PALETTE[i % GROUP_SERIES_PALETTE.length];

  const [ageFeatureMin, ageFeatureMax] = zoomedRange(ageGroups.flatMap((g) => g.featureSatisfaction.map((f) => f.mean)));
  const [ageValueMin, ageValueMax] = zoomedRange(ageGroups.flatMap(fourValuesRow));
  const [genderFeatureMin, genderFeatureMax] = zoomedRange(
    genderGroups.flatMap((g) => g.featureSatisfaction.map((f) => f.mean)),
  );
  const [genderValueMin, genderValueMax] = zoomedRange(genderGroups.flatMap(fourValuesRow));
  const genderUxValues = genderGroups.flatMap((g) => [...g.uxQuality.usability, ...g.uxQuality.fun].map((u) => u.mean));
  const {
    min: genderUxMin,
    max: genderUxMax,
    levels: genderUxLevels,
  } = genderUxValues.length ? computeNiceRadarRange(genderUxValues) : { min: 0, max: 10, levels: 6 };

  return (
    <View break>
      <SectionHeader numeral="VII" title="교차 분석" />
      <SubsectionHeader number={1} title="교차 분석 결과 및 분석" />

      <Text style={styles.subheading}>연령대별 차이</Text>
      <GroupedBarChart
        categories={featureNames}
        series={ageGroups.map((g, i) => ({
          name: g.group,
          color: seriesColor(i),
          values: featureValuesInOrder(g),
        }))}
        min={ageFeatureMin}
        max={ageFeatureMax}
        unit="점"
        title="[ 기능별 만족도 차이 ]"
      />
      <GroupedBarChart
        categories={FOUR_VALUE_LABELS}
        series={ageGroups.map((g, i) => ({ name: g.group, color: seriesColor(i), values: fourValuesRow(g) }))}
        min={ageValueMin}
        max={ageValueMax}
        unit="점"
        title="[ 4대 가치 만족도 차이 ]"
      />
      {ageAnalysisText ? (
        <RichText value={ageAnalysisText} />
      ) : (
        <>
          <Text style={[styles.body, { fontWeight: "bold", marginTop: 4 }]}>[전반적 만족도 경향]</Text>
          {overallTrendBullets(ageGroups).map((line) => (
            <Text key={line} style={styles.body}>
              • {line}
            </Text>
          ))}
        </>
      )}

      <Text style={styles.subheading} break>
        성별 차이
      </Text>
      <GroupedBarChart
        categories={featureNames}
        series={genderGroups.map((g, i) => ({
          name: g.group,
          color: seriesColor(i),
          values: featureValuesInOrder(g),
        }))}
        min={genderFeatureMin}
        max={genderFeatureMax}
        unit="점"
        title="[ 기능별 만족도 차이 ]"
      />
      <GroupedBarChart
        categories={FOUR_VALUE_LABELS}
        series={genderGroups.map((g, i) => ({ name: g.group, color: seriesColor(i), values: fourValuesRow(g) }))}
        min={genderValueMin}
        max={genderValueMax}
        unit="점"
        title="[ 4대 가치 만족도 차이 ]"
      />
      {genderAnalysisText ? (
        <RichText value={genderAnalysisText} />
      ) : (
        <>
          <Text style={[styles.body, { fontWeight: "bold", marginTop: 4 }]}>[전반적 만족도 경향]</Text>
          {overallTrendBullets(genderGroups).map((line) => (
            <Text key={line} style={styles.body}>
              • {line}
            </Text>
          ))}
        </>
      )}

      {genderGroups.length >= 2 && (
        <View>
          <Text style={styles.subheading}>[사용자 경험 품질 평가]</Text>
          {/* 그룹(실용성/즐거움) 사이에 옅고 얇은 세로 실선(2026-07-21 요청) — 위쪽엔 소제목과
              구분되는 가로 실선도 넣는다. Ⅵ장 SectionUxQuality와 같은 원칙: uxGroupDefs를
              순회해서 그리므로 그룹 이름/개수가 바뀌어도 같은 방식으로 동작한다. */}
          <View
            style={{
              flexDirection: "row",
              marginTop: 6,
              paddingTop: 8,
              borderTopWidth: 0.5,
              borderTopColor: colors.border,
            }}
          >
            {(() => {
              const genderUxGroupDefs = [
                { name: "실용성", key: "usability" },
                { name: "즐거움", key: "fun" },
              ] as const;
              // Ⅵ장과 같은 이유(2026-07-23) — 가로/세로 분리 여백 계산으로 캔버스가 작아져
              // 생긴 여유만큼 115→160으로 키우려 했는데, 실제 렌더해보니 오른쪽으로 뻗는 긴
              // 라벨("게임 진행 자연스러움")의 캔버스가 열 폭을 넘어 옆 레이더 라벨과 겹치는
              // 게 실측 확인됐다 — maxRadarSizeForColumn으로 실제 사용 가능한 열 폭 기준
              // 최댓값으로 클램프한다.
              const genderUxColumnWidth = PAGE_CONTENT_WIDTH / genderUxGroupDefs.length - 4;
              const GENDER_UX_RADAR_SIZE = Math.min(
                210,
                ...genderUxGroupDefs.map((g) =>
                  maxRadarSizeForColumn(genderGroups[0].uxQuality[g.key].map((u) => u.name), genderUxColumnWidth),
                ),
              );
              // Ⅵ장과 같은 이유(2026-07-22, 가로/세로 분리는 2026-07-23) — 실용성/즐거움 두
              // 오버레이가 나란히 있으므로 그룹별로 각자 계산한 여백을 합쳐 공통 캔버스
              // 크기를 강제한다.
              const genderUxLabelMargin = mergeRadarLabelMargins(
                ...genderUxGroupDefs.map((g) =>
                  computeRadarLabelMargins(
                    genderGroups[0].uxQuality[g.key].map((u) => u.name),
                    GENDER_UX_RADAR_SIZE,
                    RADAR_AXIS_LABEL_FONT_SIZE,
                  ),
                ),
              );
              return genderUxGroupDefs.map((groupDef, i) => (
                <View
                  key={groupDef.key}
                  style={[
                    { flex: 1, alignItems: "center" },
                    i > 0 ? { borderLeftWidth: 0.5, borderLeftColor: colors.border } : {},
                  ]}
                >
                  <Text style={[styles.body, { fontWeight: "bold", marginBottom: 4 }]}>{groupDef.name}</Text>
                  <RadarChartOverlay
                    axes={genderGroups[0].uxQuality[groupDef.key].map((u) => u.name)}
                    series={genderGroups.map((g, si) => ({
                      name: g.group,
                      color: seriesColor(si),
                      values: g.uxQuality[groupDef.key].map((u) => u.mean),
                    }))}
                    min={genderUxMin}
                    max={genderUxMax}
                    gridLevels={genderUxLevels}
                    size={GENDER_UX_RADAR_SIZE}
                    labelMargin={genderUxLabelMargin}
                  />
                </View>
              ));
            })()}
          </View>
        </View>
      )}
    </View>
  );
}
