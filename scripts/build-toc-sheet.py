"""NOTION_STAGE_MAPPING.xlsx 의 '표준목차' 시트만 다시 쓴다.

    python3 scripts/build-toc-sheet.py

리바랩스 목차를 뼈대로 5종 발행 보고서를 대조해 만든 표준안.
단계매핑·레이아웃 시트는 건드리지 않는다 — 레이아웃 시트에는 담당자가 직접 넣은
예시 이미지가 있어서 openpyxl 로 열었다 저장하면 전부 날아간다. 그래서 여기서는
xlsx 안의 XML 을 직접 고친다.
"""
import re
import zipfile
from pathlib import Path

XLSX = Path(__file__).resolve().parent.parent / "docs" / "NOTION_STAGE_MAPPING.xlsx"
SHEET = "표준목차"

HEADERS = ["장", "장 제목", "절", "절 제목", "포함 구분", "삽입 위치", "단계코드",
           "판정 신호 (raw data에 이런 문항이 있으면)", "판정 조건",
           "미충족 시 처리", "레이아웃 코드", "제품군 실적"]

# 장이 들어갈 자리. 조건부 장이 빠지면 번호는 당겨지지만 순서는 이 표대로 고정이다.
SLOT = {
    "I":    "문서 시작",
    "II":   "개요 뒤",
    "III":  "인적 사항 뒤",
    "IV":   "기능별 고객 경험 평가 뒤 · 핵심구매요소 앞",
    "V":    "기능별(또는 고객 여정) 뒤",
    "VI":   "핵심구매요소 뒤",
    "VII":  "4대 가치 뒤 · 종합 만족도 앞",
    "VIII": "모든 조사 장 뒤 · 종합 만족도 앞",
    "IX":   "교차 분석(또는 4대 가치) 뒤",
    "X":    "문서 끝",
}

# 장, 장 제목, 절, 절 제목, 포함 구분, 단계코드, 판정 신호, 판정 조건, 미충족 시, 레이아웃, 실적
ROWS = [
    ("I", "개요", "1", "제품 소개", "필수", "—",
     "회사명 · 제품명 · 주요 기능 (raw data 아님)",
     "담당자 입력 또는 기업소개 파일 추출", "입력 요청 후 대기", "L10|L9b", "5/5"),
    ("I", "개요", "2", "사용성 테스트 진행 일정", "필수", "—",
     "테스트 기간 · 대상 · 담당자 (raw data 아님)",
     "담당자 입력", "입력 요청 후 대기", "L10", "5/5"),
    ("I", "개요", "3", "사용성 테스트 설문 항목", "필수", "—",
     "raw data 헤더 전체",
     "항상 생성. 헤더에서 결정론적으로 구성한다", "—", "L9b", "5/5"),

    ("II", "인적 사항 및 특성·경험 조사", "1", "인적 사항 조사 결과", "필수", "S1",
     "나이 / 성별 / 직업 / 거주 형태 / 이용 빈도 / 경험 수준",
     "인적 문항이 1개 이상.\n"
     "장 제목은 데이터에 따라 갈린다 —\n"
     "· 경험 문항(2절 타사 경험 또는 경험 수준 척도)이 있으면 '인적 사항 및 특성·경험 조사'\n"
     "· 없으면 '인적 사항 및 특성 조사'",
     "장 드롭", "L10|L10b|L1|L2|L9|L20", "raw 5/5 · 출력 4/5 (투블럭 생략)"),
    ("II", "인적 사항 및 특성·경험 조사", "2", "타사 서비스 경험 조사", "조건부", "S3",
     "○○ 외에 다른 서비스를 사용해 본 경험이 있으십니까? /\n"
     "이용해본 서비스명 / 경험하신 서비스의 장점 · 단점 / 타사 만족도",
     "타사 관련 문항이 1개 이상.\n"
     "원본 4종이 서로 달라 규칙으로 못 뽑는다 — 여기로 고정한다\n"
     "· 케어클 Ⅱ 인적사항 p7~8 / 이젠오토 Ⅱ 인적사항 p8\n"
     "· 정리습관만 Ⅲ-2 별도 절 / 리바랩스는 raw에 있으나 미출력",
     "절 드롭", "L10b|L1|L9|L14|L8|L11", "raw 4/5 · 출력 3/5 (리바랩스 미출력)"),

    ("III", "기능별 고객 경험 평가", "1", "기능별 고객 경험 조사 결과", "필수", "S2",
     "'○○' 기능의 만족도는 몇 점입니까? +\n위와 같이 평가한 이유는 무엇입니까?",
     "기능 만족도 척도 문항이 1개 이상.\n"
     "기능마다 아래 블록을 그대로 반복한다 (기능 수 = 블록 수). 전부 필수다\n"
     "① 요약: 평균·표준편차(L9) → 만족도 분포도(L1b) → 주요 키워드(L12)\n"
     "   → 감정 분석 도넛(L8) + 극성 건수 표(L8t) → 응답 요약 3박스(L11a)\n"
     "② 상세: 극성별 정성 서술(L11). 카테고리 소제목 + 인용문 + 인사이트\n"
     "③ 절 마무리 — 원본 p27~28. 뒤 4개는 순위 대상이 기능일 때만 붙는다\n"
     "   기능별 만족도 조사 결과 그래프(L1a) + 기능별 만족도 순위 종합표(L9a)\n"
     "   기능 중요 순위 구성 누적막대(L5) + 기능별 중요 순위 종합표(L9a)\n"
     "   기능별 상대 중요도-만족도 그래프(L6) + 영역별 참고 지표(L6a)\n"
     "   순위 계열 4종은 기능 목록에 중요 순위가 있을 때만 붙는다\n"
     "   문구로 어느 목록인지 가른다. 응답 형식(단일선택/순위)은 보지 않는다 —\n"
     "   · 기능 중 중요하다고 생각되는 순위를 1위부터 N위까지 → 기능 목록. 여기\n"
     "     (리바랩스 Q12, 투블럭 Q7)\n"
     "   · 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 → 구매요소 목록. 5장으로\n"
     "     (케어클 Q25 는 1~8위 순위 응답이지만 문구가 핵심 요인이라 5장이다)\n"
     "\n"
     "   L6·L6a 는 같은 목록에 만족도까지 있어야 그린다\n"
     "   항목명 대조는 어절 포함관계로 한다 — 만족도 헤더의 짧은 이름과 순위\n"
     "   응답의 긴 이름이 다를 수 있다 (실시간 거점형 vs 실시간 위치 기반 거점형 콘텐츠)\n"
     "   항목 수 N 은 데이터가 정한다. 6개로 고정하지 않는다\n"
     "극성은 긍정·부정·중립 3분할로 고정한다 (2분할 L8a 는 쓰지 않는다)\n"
     "이유 문항이 기능당 2개 이상이면 합쳐서 한 입력으로 쓴다 (투블럭)\n"
     "L12 워드클라우드는 응답자 수와 무관하게 항상 만든다 (케어클 27명 실증)\n"
     "항목이 기능이 아니라 태스크 플로우면(정리습관) 만족도 내림차순이 아니라\n"
     "플로우 순서를 유지하고 표 제목을 '단계별'로 바꾼다\n"
     "\n"
     "레이아웃은 어떤 raw data 든 동일하다. 빠지는 경우는 둘로 나뉜다 —\n"
     "· 원천 부재(raw 에 이유 문항이 없음): L12·L8·L8t·L11a·L11 이 빠지고 수치만\n"
     "  남는다. 단 5종 전부 기능마다 이유 문항이 있어 실제로는 안 일어난다\n"
     "· 생성 실패(이유 문항은 있는데 LLM 호출 실패): 자리를 유지하고 '생성 실패'\n"
     "  로 표시한다. 절대 드롭하지 않는다 — 보고서 모양이 그날 사정에 따라\n"
     "  달라지면 안 되기 때문",
     "장 드롭 (척도 문항 자체가 없을 때만)",
     "L10|L10a|L10b|L9|L1b|L12|L8|L8t|L11a|L11|L1a|L9a|L5|L6|L6a", "5/5"),
    ("III", "기능별 고객 경험 평가", "2", "기능별 고객 경험 분석", "필수", "S2",
     "1절에서 나온 결과를 재료로 쓴다 (새 문항 아님)",
     "기능 간 비교 해석 1페이지. 개별 기능 서술이 아니다. 전문 텍스트 (표 아님)\n"
     "구성 —\n"
     "① 배너 제목\n"
     "   순위 있음: '기능별 중요 순위 및 만족도 종합 해석'\n"
     "   순위 없음: '기능별 만족도 종합 해석'\n"
     "② [종합 해석] 불릿 + 화살표 인사이트\n"
     "   · 만족도 최고 · 최저 기능\n"
     "   · 중요도 대비 만족도가 부족한 기능 (순위 있을 때만)\n"
     "   · 정성에서 반복 등장한 공통 불만\n"
     "③ 우선순위 그룹 — 사분면 판정을 그대로 가져온다\n"
     "   순위 있음: 우선 개선 기능 / 차우선 개발 기능 / 비우선 개발 기능 3단계\n"
     "   순위 없음: 개선 우선 기능 / 유지 기능 2단계 (만족도 상·하위로 가른다)\n"
     "   항목마다 (상대 중요도 +2.96, 만족도 6.35) 병기. 순위 없으면 만족도만\n"
     "   항목 아래 해석 1줄 + 니즈 1~2줄\n"
     "\n"
     "순위 문항이 없어도 절은 유지한다 — 순위 기반 요소만 빠지고\n"
     "만족도 기반으로 대체해서 낸다 (이젠오토 · 정리습관)\n"
     "사분면 그래프 자체는 5장 2절에서 그리고 여기서는 참조만 한다",
     "절 드롭 (1절 수치만 출력)",
     "L10a|L24", "5/5"),

    ("IV", "고객 여정 기반 경험 평가", "1", "고객 여정 기반 경험 평가 조사 결과",
     "조건부", "S4",
     "처음 받아보셨을 때 / 1주 후 / 2주 후 같은 시점 표현",
     "시점 문항이 3개 이상. 컬럼 순서가 곧 시간 순서다", "장 드롭",
     "L10|L10a|L1|L13|L9", "1/5 (케어클만)"),
    ("IV", "고객 여정 기반 경험 평가", "2", "고객 여정 기반 경험 평가 결과 분석",
     "조건부", "S4", "시점별 이유 문항",
     "1절이 생성됐고 이유 문항이 있음", "절 드롭", "L10a|L11", "1/5 (케어클만)"),

    ("V", "핵심구매요소", "1", "핵심구매요소 조사 결과", "필수", "S5",
     "가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하십니까? /\n"
     "핵심구매요소별 만족도는 몇 점입니까?",
     "핵심 요인 문항이 1개 이상이면 장을 만든다\n"
     "\n"
     "① 항상 (5/5) — 응답 형식이 달라도 1위 응답 비율 하나로 통일\n"
     "   단일선택형(리바랩스·이젠오토·정리습관): 그 선택이 곧 1위\n"
     "   순위형(케어클·투블럭): 1위 컬럼만 집계. 분모는 유효 응답 수(빈칸 제외)\n"
     "   · 1위 응답 비율 세로 막대(L1)\n"
     "   · No / 핵심 기능 / 순위 / 비율 4열 표(L9)\n"
     "   실측 대조(케어클): 우리 59.3/18.5/11.1/7.4/3.7 vs 원본 p36 60/16/12/8\n"
     "\n"
     "② 구매요소 목록에 중요 순위가 있을 때 (2/5 — 케어클·투블럭)\n"
     "   · 순위 구성 누적막대(L5) + 핵심구매요소별 중요 순위 종합표(L9a)\n"
     "\n"
     "③ 구매요소별 만족도 문항까지 있을 때 (1/5 — 투블럭 Q9~Q14)\n"
     "   · 핵심구매요소별 평균 만족도 막대·표(L1a·L9a)\n"
     "   · 핵심구매요소별 상대 중요도-만족도 그래프(L6) + 영역별 참고 지표(L6a)\n"
     "   투블럭 원본이 이 구조 그대로다 — 3장 기능 목록과 대상만 다르고 형태는 같다\n"
     "\n"
     "리바랩스 원본 p30 에 ②③ 이 없는 것은 양식이 금지해서가 아니라 그 데이터를\n"
     "묻지 않았기 때문이다. 조건이 성립하면 그린다 (2026-08-19 담당자 확정)",
     "장 드롭 (핵심 요인 문항 자체가 없을 때만)",
     "L10|L10a|L1|L9|L5|L9a|L1a|L6|L6a", "5/5"),
    ("V", "핵심구매요소", "2", "핵심구매요소 분석", "필수", "S5",
     "1절 결과 + 선택 이유 문항 (새 문항 아님)",
     "전문 텍스트 1페이지. 원본 p31\n"
     "배너 제목 '핵심구매요소 중요 순위 및 만족도 종합 해석'\n"
     "불릿 + 하위 불릿만 쓴다. 3장 2절과 달리 우선순위 3단계 그룹은 없다\n"
     "· 1위 요인의 응답 수와 비율, 그것이 뜻하는 바\n"
     "· 상위 3개 요인의 누적 비율과 축 해석\n"
     "· 중위권 · 최하위 요인의 위치\n"
     "· 주관식에서 반복된 불만과 우선 과제 제안",
     "절 드롭 (1절 수치만 출력)", "L10a|L24", "5/5"),

    ("VI", "4대 가치 만족도", "1", "4대 가치 조사 결과", "필수", "S6",
     "기능적 / 심미적 / 경제적 / 사회적 가치 영역에 대한 만족도",
     "가치 척도 문항이 1개 이상. 가치 이름은 헤더에서 그대로 뽑는다", "장 드롭",
     "L10|L10a|L1a|L9|L10b", "5/5 (정리습관은 커스텀 축)"),
    ("VI", "4대 가치 만족도", "2", "4대 가치 조사 결과 분석", "필수", "S6",
     "가치별 이유 문항", "이유 서술 문항이 있고 정성 분석이 성공",
     "절 드롭 (수치만 출력)", "L10a|L8|L11", "4/5 (투블럭 이유 문항 없음)"),

    ("VII", "사용자 경험 품질 평가", "1", "사용자 경험 품질 평가 결과", "조건부", "S7",
     "실용성N) / 즐거움N) 접두가 붙은 문항",
     "같은 계열(실용성 또는 즐거움)의 척도 문항이 3개 이상 (3개 미만이면 레이더가 성립 안 함)",
     "장 드롭", "L10|L10a|L4|L9", "1/5 (리바랩스만)"),
    ("VII", "사용자 경험 품질 평가", "2", "사용자 경험 품질 평가 결과 분석",
     "조건부", "S7", "—", "1절이 생성됨", "절 드롭", "L10a|L11", "1/5 (리바랩스만)"),

    ("VIII", "교차 분석", "1", "교차 분석 결과 및 분석", "조건부", "S1 x S2·S6",
     "인적 범주형 문항 + 만족도 척도 문항",
     "인적 범주가 2종 이상이고 각 그룹 응답자가 5명 이상", "장 드롭",
     "L10|L10a|L3|L4a|L9", "1/5 (리바랩스만)"),

    ("IX", "종합 만족도 및 NPS 지수", "1", "종합 만족도 및 NPS 지수", "필수", "S8",
     "전반적인 만족도(종합 점수) / 추천할 의향이 얼마나 있습니까",
     "종합 또는 추천 문항이 1개 이상.\n"
     "사용 의향과 추천 의향이 둘 다면 L22 요약표를 2개 만든다 (이젠오토)",
     "장 드롭", "L10|L10a|L1|L7|L22|L9|L19|L11", "5/5"),
    ("IX", "종합 만족도 및 NPS 지수", "2", "개선 아이디어", "필수", "S9",
     "어떤 부분에서 개선이 필요하다고 느끼셨나요?",
     "개선 서술 문항이 있음", "절 드롭", "L10a|L11b", "5/5"),
    ("IX", "종합 만족도 및 NPS 지수", "3", "기업 측 요청 질문", "조건부", "S9E",
     "가격 수용도 등 기업이 별도로 넣은 문항",
     "표준 단계 어디에도 안 붙는 문항이 남아 있음", "절 드롭",
     "L10b|L1a|L8|L11", "1/5 (투블럭만)"),

    ("X", "종합 결과 및 제언", "1", "사용성테스트 결과 요약", "필수", "전 단계", "—",
     "항상 생성. 앞 장의 수치를 다시 모아 쓴다\n"
     "L6·L6a 는 앞에서 사분면이 하나라도 그려졌을 때만 다시 넣는다\n"
     "· 기능 목록(3장) 또는 구매요소 목록(5장) 어느 쪽이든 성립하면 넣는다\n"
     "· 둘 다 성립하면 기능 목록 쪽을 쓴다. 둘 다 없으면 L23 요약 표만 낸다",
     "L6·L6a 만 제외. 절은 유지",
     "L10|L10a|L23|L9|L6|L6a", "5/5"),
    ("X", "종합 결과 및 제언", "2", "개선 전략 제언", "필수", "전 단계", "—",
     "정성 분석이 성공했을 때", "요약만 출력", "L10a|L23|L18",
     "4/5 (정리습관 없음)"),
    ("X", "종합 결과 및 제언", "3", "기능별 고객 제언 종합", "조건부", "S2",
     "기능 만족도 + 기능별 이유 문항",
     "기능별 부정 카테고리를 뽑을 수 있을 때", "절 드롭", "L21",
     "3/5 (리바랩스 · 케어클 · 이젠오토)"),
]

WIDTHS = [6, 26, 5, 34, 10, 34, 14, 46, 62, 24, 34, 28]
FILL = {"필수": 5, "조건부": 7}  # styles.xml 의 기존 인덱스 — 파랑 / 주황
COLS = "ABCDEFGHIJKL"


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell(ref: str, style: int, value: str) -> str:
    return (f'<c r="{ref}" s="{style}" t="inlineStr">'
            f'<is><t xml:space="preserve">{esc(value)}</t></is></c>')


def build_sheet() -> str:
    body = ['<row r="1" spans="1:12" ht="34">'
            + "".join(cell(COLS[i] + "1", 1, h) for i, h in enumerate(HEADERS))
            + "</row>"]
    for n, rec in enumerate(ROWS, start=2):
        rec = rec[:5] + (SLOT[rec[0]],) + rec[5:]
        base = FILL[rec[4]]
        styles = [base, base, 3, 4, base, 4, 3, 4, 4, 4, 4, 3]
        height = 16 * max(v.count("\n") + 1 for v in rec) + 12
        body.append(f'<row r="{n}" spans="1:12" ht="{height}">'
                    + "".join(cell(COLS[i] + str(n), styles[i], v)
                              for i, v in enumerate(rec))
                    + "</row>")

    merges, i = [], 0
    while i < len(ROWS):
        j = i
        while j + 1 < len(ROWS) and ROWS[j + 1][0] == ROWS[i][0]:
            j += 1
        if j > i:
            merges += [f'<mergeCell ref="A{i + 2}:A{j + 2}"/>',
                       f'<mergeCell ref="B{i + 2}:B{j + 2}"/>']
        i = j + 1

    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>'
                   for i, w in enumerate(WIDTHS))
    last = len(ROWS) + 1
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<dimension ref="A1:L{last}"/>'
            '<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '</sheetView></sheetViews>'
            '<sheetFormatPr baseColWidth="10" defaultRowHeight="17"/>'
            f'<cols>{cols}</cols><sheetData>{"".join(body)}</sheetData>'
            f'<autoFilter ref="A1:L{last}"/>'
            f'<mergeCells count="{len(merges)}">{"".join(merges)}</mergeCells></worksheet>')


def main() -> None:
    with zipfile.ZipFile(XLSX) as z:
        names, data = z.namelist(), {n: z.read(n) for n in z.namelist()}

    wb = data["xl/workbook.xml"].decode()
    if f'name="{SHEET}"' in wb:                      # 이미 있으면 시트 XML만 교체
        rid = re.search(rf'name="{SHEET}"[^>]*r:id="(\w+)"', wb).group(1)
        rels = data["xl/_rels/workbook.xml.rels"].decode()
        target = re.search(rf'Id="{rid}"[^>]*Target="([^"]+)"', rels).group(1)
        part = "xl/" + target
    else:                                            # 없으면 새로 붙인다
        part = "xl/worksheets/sheet3.xml"
        rid = "rId" + str(max(int(x) for x in re.findall(r'Id="rId(\d+)"',
                              data["xl/_rels/workbook.xml.rels"].decode())) + 1)
        sid = max(int(x) for x in re.findall(r'sheetId="(\d+)"', wb)) + 1
        data["xl/workbook.xml"] = wb.replace(
            "</sheets>",
            f'<sheet name="{SHEET}" sheetId="{sid}" r:id="{rid}"/></sheets>').encode()
        data["xl/_rels/workbook.xml.rels"] = data["xl/_rels/workbook.xml.rels"].decode().replace(
            "</Relationships>",
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/'
            f'officeDocument/2006/relationships/worksheet" '
            f'Target="{part[3:]}"/></Relationships>').encode()
        data["[Content_Types].xml"] = data["[Content_Types].xml"].decode().replace(
            "</Types>",
            f'<Override PartName="/{part}" ContentType="application/vnd.'
            f'openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>').encode()
        names.append(part)

    data[part] = build_sheet().encode()
    with zipfile.ZipFile(XLSX, "w", zipfile.ZIP_DEFLATED) as out:
        for name in names:
            out.writestr(name, data[name])

    required = sum(1 for r in ROWS if r[4] == "필수")
    print(f"{SHEET} 시트 갱신 — {len({r[0] for r in ROWS})}장 {len(ROWS)}절 "
          f"(필수 {required} · 조건부 {len(ROWS) - required})")


if __name__ == "__main__":
    main()
    # 다른 시트를 건드리지 않았는지 확인
    with zipfile.ZipFile(XLSX) as z:
        media = sum(1 for n in z.namelist() if n.startswith("xl/media/"))
        rows2 = len(re.findall(r"<row r=", z.read("xl/worksheets/sheet2.xml").decode()))
        rows1 = len(re.findall(r"<row r=", z.read("xl/worksheets/sheet1.xml").decode()))
    assert media == 39 and rows1 == 284 and rows2 == 37, (media, rows1, rows2)
    print(f"  단계매핑 {rows1}행 · 레이아웃 {rows2}행 · 이미지 {media}개 그대로")