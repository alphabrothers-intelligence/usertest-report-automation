#!/usr/bin/env python3
"""Build common, software, and physical-product usability-test HWPX forms."""

from __future__ import annotations

import html
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "hwpx-templates"
TMP = ROOT / "tmp" / "hwpx-template-build"
SKILL = Path("/Users/a111-04-2310-01/.codex/skills/hwpxskill")
BUILD = ROOT / "scripts" / "_hwpx_build_local.py"

COMMON = [
    ("1. 조사 개요", [
        "[필수 입력] 제품/서비스명 · 조사 목적 · 조사 기간 · 조사 장소 · 조사 방식",
        "[필수 입력] 참여자 수 · 핵심 타깃 · 과업 수 · 척도 · 데이터 출처",
        "[검수 필요] 표본 조건, 결측치 처리, 척도 방향이 원자료와 일치하는지 확인",
    ]),
    ("2. 참여자 특성", [
        "[차트] 성별 · 연령 · 사용 경험 · 관련 제품/서비스 이용 행태",
        "[해석] 표본의 대표성 및 결과 해석 시 유의사항",
    ]),
    ("3. 과업/기능별 사용 경험", [
        "[반복 블록] 과업명 → 성공률/완료시간/만족도 → 관찰 근거 → 사용자 발화 → 해석",
        "[검수 필요] 지표마다 산식·분모·표본 수·이상치 여부를 함께 표시",
        "[검토 필요 배지] 기준 미달, 표본 부족, 정성-정량 불일치 사유를 해당 그래프 옆에 직접 표시",
    ]),
    ("4. 핵심 구매 요소", [
        "[차트] 중요 요소 순위와 응답 비율",
        "[해석] 선택에 영향을 주는 핵심 요인과 제품 전략 시사점",
    ]),
    ("5. 4대 가치 평가", [
        "[공통 필수] 기능성 · 사용성 · 신뢰성 · 매력성(프로젝트 정의에 따라 명칭 확정)",
        "[차트] 가치별 평균/분포 · 기준선 · 표본 수",
        "[검수 필요] 네 가치의 문항 매핑과 점수 환산 방식 확인",
    ]),
    ("6. 종합 만족도 및 NPS", [
        "[공통 필수] 종합 만족도 평균/분포와 NPS(추천·중립·비추천 비율 포함)",
        "[검수 필요] NPS 산식, 0~10점 원문항, 유효 응답 수 확인",
    ]),
    ("7. 정성 의견 및 워드클라우드", [
        "[공통 운영] 긍정 · 부정 · 중립/기타 의견을 분리하고 대표 발화를 병기",
        "[워드클라우드] 충분한 자유응답이 있을 때만 표시; 불용어·동의어 통합 기준 공개",
        "[검수 필요] 개인정보/회사명 마스킹, 맥락 왜곡 여부 확인",
    ]),
    ("8. 개선 아이디어", [
        "[공통 필수] 문제 → 근거 → 개선 제안 → 기대 효과 → 우선순위",
        "[우선순위] 심각도 · 빈도 · 사업 영향 · 구현 난이도를 분리 표시",
        "[검수 필요] 자동 생성 제안은 담당자가 채택/수정/제외 중 하나를 결정",
    ]),
    ("9. 종합 결론 및 실행 권고", [
        "[요약] 유지할 강점 · 즉시 개선 · 추가 검증 · 중장기 과제",
        "[검수 필요] 근거 없는 단정, 작은 표본의 일반화, 원자료와 다른 수치 확인",
    ]),
]

SW_EXTRA = [
    ("SW 특화 A. 정보구조와 탐색", [
        "[지표] 과업 성공률 · 경로 이탈 · 클릭/탭 수 · 탐색 시간 · 오류 회복",
        "[산출물] 핵심 사용자 흐름, 막힘 구간, 화면/단계별 개선안",
    ]),
    ("SW 특화 B. 인터랙션과 화면 품질", [
        "[평가] 용어 이해 · 버튼/상태 피드백 · 가독성 · 접근성 · 일관성",
        "[증거] 화면 캡처와 관찰/발화를 개선 제안에 연결",
    ]),
    ("SW 특화 C. 중요도-만족도 및 UX 품질", [
        "[선택 차트] 중요도×만족도 사분면, SUS/UEQ 등 실제 조사에 포함된 지표만 표시",
        "[검수 필요] 조사하지 않은 표준척도를 임의 생성하지 않음",
    ]),
]

PHYSICAL_EXTRA = [
    ("실제품 특화 A. 사용 단계와 물리적 조작", [
        "[평가] 개봉 · 준비 · 조립/착용 · 작동 · 세척/보관 · 폐기 단계별 경험",
        "[지표] 과업 성공률 · 소요시간 · 오류 · 도움 요청 · 반복 시도",
    ]),
    ("실제품 특화 B. 인체·감각·안전 경험", [
        "[평가] 크기/무게 · 그립/착용감 · 힘의 크기 · 촉감 · 소음 · 냄새 · 발열 · 안전",
        "[검수 필요] 안전 관련 의견과 관찰은 빈도가 낮아도 별도 표시",
    ]),
    ("실제품 특화 C. 패키지·설명서·내구 인식", [
        "[평가] 포장 이해 · 표시 가독성 · 설명서 · 품질/내구 신뢰 · 보관성",
        "[증거] 제품 사진의 관찰 지점과 개선 제안을 번호로 연결",
    ]),
]

VARIANTS = {
    "01_공통_기본_사용성테스트_보고서_양식.hwpx": (
        "공통 기본 사용성테스트 결과보고서", "SW와 실제품에 공통 적용하는 최소 필수 구조", COMMON
    ),
    "02_SW_사용성테스트_보고서_양식.hwpx": (
        "SW 사용성테스트 결과보고서", "리바랩스와 기존 공양식 구조를 반영한 SW 확장형", COMMON + SW_EXTRA
    ),
    "03_실제품_사용성테스트_보고서_양식.hwpx": (
        "실제품 사용성테스트 결과보고서", "케어클 구조를 반영한 물리 제품 확장형", COMMON + PHYSICAL_EXTRA
    ),
}


def p(pid: int, text: str = "", char: int = 0, page_break: bool = False, para: int = 0) -> str:
    safe = html.escape(text)
    size = {7: (2000, 2000, 1700, 1200), 8: (1400, 1400, 1190, 840), 9: (1000, 1000, 850, 600), 10: (1000, 1000, 850, 600), 11: (900, 900, 765, 540)}.get(char, (1000, 1000, 850, 600))
    return f'''  <hp:p id="{pid}" paraPrIDRef="{para}" styleIDRef="0" pageBreak="{1 if page_break else 0}" columnBreak="0" merged="0">
    <hp:run charPrIDRef="{char}"><hp:t>{safe}</hp:t></hp:run>
    <hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="{size[0]}" textheight="{size[1]}" baseline="{size[2]}" spacing="{size[3]}" horzpos="0" horzsize="42520" flags="393216"/></hp:linesegarray>
  </hp:p>'''


def section_xml(title: str, subtitle: str, sections: list[tuple[str, list[str]]]) -> str:
    paras: list[str] = []
    pid = 1100000000
    first = p(pid, "")
    first = first.replace(
        '<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>',
        '''<hp:run charPrIDRef="0">
      <hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">
        <hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>
        <hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>
        <hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>
        <hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr>
        <hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>
        <hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>
        <hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>
      </hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>
    </hp:run>'''
    )
    paras.append(first)
    for text, char in [
        ("USABILITY TEST REPORT", 5), (title, 7), (subtitle, 13),
        ("프로젝트명  [입력]", 9), ("조사 기간  [입력]", 9), ("작성일/작성자  [입력]", 9),
        ("양식 원칙", 8),
        ("공통 필수 항목은 삭제하지 않고, 조사하지 않은 항목은 ‘미조사’와 사유를 표시합니다.", 10),
        ("자동 생성 수치와 해석은 반드시 원자료 및 담당자 검수를 거친 뒤 확정합니다.", 10),
        ("※ 기준 자료: 케어클·리바랩스 사용성테스트 결과보고서 및 기존 공양식", 11),
    ]:
        pid += 1
        paras.append(p(pid, text, char))
    for heading, bodies in sections:
        pid += 1
        paras.append(p(pid, heading, 8, page_break=True))
        for body in bodies:
            pid += 1
            char = 10 if body.startswith("[검수") or body.startswith("[공통") else 0
            paras.append(p(pid, "• " + body, char))
        pid += 1
        paras.append(p(pid, "[보고서 반영 영역]", 9))
        for label in ("핵심 결과:  [입력/자동 생성]", "근거 및 해석:  [입력/자동 생성]", "담당자 검수 메모:  [확정/수정/제외]"):
            pid += 1
            paras.append(p(pid, label, 0))
    return '''<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">
''' + "\n".join(paras) + "\n</hs:sec>\n"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    for index, (filename, (title, subtitle, sections)) in enumerate(VARIANTS.items(), start=1):
        xml_path = TMP / f"section-{index}.xml"
        xml_path.write_text(section_xml(title, subtitle, sections), encoding="utf-8")
        subprocess.run([
            "python3", str(BUILD), "--template", "report", "--section", str(xml_path),
            "--title", title, "--creator", "알파브라더스", "--output", str(OUT / filename),
        ], check=True)


if __name__ == "__main__":
    main()
