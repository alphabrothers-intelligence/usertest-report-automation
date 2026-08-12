"""hwpx 전용 스타일/레이아웃 상수. lib/pdf/theme.ts는 건드리지 않고, 그 색상·폰트 크기
값만 참고해 hwpx(OWPML) 쪽 단위로 옮겨 적은 것 -- react-pdf(StyleSheet, pt 단위)와
hwpx(HWPUNIT = 1/7200 inch = pt*100) 단위계가 달라서 값을 그대로 재사용(import)할 수는
없다. theme.ts가 바뀌면 이 파일도 사람이 손으로 다시 맞춰야 한다(공유 소스가 아님).

또한 여기엔 "채워 넣은 텍스트가 원본 셀 크기보다 길어서 잘리는" 문제(2026-08-04 사용자
실측 보고)를 완화하기 위한 셀 높이 자동 계산 유틸도 둔다. hwpx 표 셀은 react-pdf의
flexbox와 달리 높이가 고정 숫자(cellSz height)라 내용이 넘치면 잘려 보인다 -- 이건
"PDF 렌더러와 합치기"로는 못 고치고(엔진이 다름) hwpx 쪽에 내용 길이 기반 높이 추정을
새로 넣어야 한다.
"""

from __future__ import annotations

import math

HWPUNIT_PER_PT = 100  # 1pt = 100 HWPUNIT (7200 HWPUNIT = 1inch, 72pt = 1inch)

# lib/pdf/theme.ts의 colors 상수를 그대로 옮김(2026-07-22 원본 PDF 150dpi 픽셀 샘플링 값).
COLORS = {
    "navy": "#315c9c",
    "navy_light": "#5c73aa",
    "header_badge_bg": "#dfeaf5",
    "chart_banner_bg": "#c0cdef",
    "teal": "#90f7d5",
    "teal_dark": "#159a78",
    "q_underline": "#42c7f1",
    "amber": "#f59e0b",
    "red": "#ef4444",
    "text": "#18181b",
    "subtext": "#52525b",
    "border": "#d4d4d8",
    "bg_alt": "#f4f4f5",
    "white": "#ffffff",
}

# lib/pdf/theme.ts의 fontSize(pt) 값을 HWPUNIT charPr height로 옮김.
FONT_SIZE_PT = {
    "section_header": 11,
    "subheading": 10,
    "q_heading": 10.5,
    "body": 9,
    "small": 8,
    "table_cell": 8,
}


def pt_to_hwpunit(pt: float) -> int:
    return round(pt * HWPUNIT_PER_PT)


# 셀 안에 실제로 몇 줄이 필요한지 추정하는 계수. 정확한 한글 워드랩 엔진이 아니라 어림값 --
# 완벽한 재현이 목적이 아니라 "확실히 잘리는 것"만 막는 안전망이다. CJK 글자는 정사각형에
# 가까워 폭 ≈ 글자 높이, 라틴/숫자/공백은 그 절반 정도로 가정한다.
_CJK_RANGES = (
    (0xAC00, 0xD7A3),  # 한글 음절
    (0x1100, 0x11FF),  # 한글 자모
    (0x3130, 0x318F),
    (0x4E00, 0x9FFF),  # 한자
    (0x3000, 0x303F),  # CJK 기호
)


def _is_wide_char(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in _CJK_RANGES)


def estimate_text_width_hwpunit(text: str, font_height_hwpunit: int) -> float:
    wide = sum(1 for c in text if _is_wide_char(c))
    narrow = len(text) - wide
    return wide * font_height_hwpunit + narrow * font_height_hwpunit * 0.55


def estimate_required_cell_height(
    text: str,
    *,
    cell_width_hwpunit: int,
    cell_margin_lr_hwpunit: int = 1020,  # 실측 원본 기본값(left+right 510+510)
    cell_margin_tb_hwpunit: int = 282,  # 실측 원본 기본값(top+bottom 141+141)
    font_height_hwpunit: int = 900,
    line_height_ratio: float = 1.4,  # 실측: vertsize 900 + spacing 360 ≈ 1260 (900*1.4)
) -> int:
    """이 텍스트가 줄바꿈 후 필요로 하는 셀 높이(HWPUNIT)를 추정한다.

    hwpx 셀은 react-pdf처럼 내용에 맞춰 자동으로 안 늘어나므로(고정 cellSz height),
    실제로 몇 줄이 되는지 미리 계산해서 필요하면 높이를 키워줘야 텍스트가 안 잘린다.
    """
    usable_width = max(cell_width_hwpunit - cell_margin_lr_hwpunit, font_height_hwpunit)
    lines = 1
    line_width = 0.0
    for ch in text:
        if ch == "\n":
            lines += 1
            line_width = 0.0
            continue
        w = font_height_hwpunit if _is_wide_char(ch) else font_height_hwpunit * 0.55
        if line_width + w > usable_width and line_width > 0:
            lines += 1
            line_width = 0.0
        line_width += w
    line_height = font_height_hwpunit * line_height_ratio
    return math.ceil(lines * line_height + cell_margin_tb_hwpunit)
