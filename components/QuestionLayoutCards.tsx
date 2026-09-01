"use client";

/**
 * **문항별 레이아웃 미리보기.** 설문 문항 하나가 보고서에서 어떤 그래프·표·정성 블록으로
 * 나오는지를 카드 한 장으로 보여준다(담당자 요청 2026-08-31).
 *
 * **다시 그리지 않는다 — 실제 보고서 렌더러(`BlockView`)를 그대로 쓴다.** 미리보기용으로
 * 따로 그리면 "미리보기는 이런데 실제는 다르다"가 되어 미리보기의 존재 이유가 사라진다
 * (`QuantReviewStep`도 같은 이유로 `BlockView`를 재사용한다).
 *
 * 카드를 나누는 기준은 **문항 헤더**다. `headingBlock({variant:"question"})`이 나오면 새 카드가
 * 시작되고 다음 문항 헤더까지가 그 문항의 레이아웃이다 — 빌더가 이미 문항 단위로 블록을
 * 내고 있으므로 새 매핑을 만들지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BlockView } from "@/components/report-web-document/ReportBlockView";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";

/** 블록 종류 → 담당자가 알아볼 이름. 카드 상단 칩에 쓴다. */
const KIND_LABEL: Record<ReportBlock["kind"], string> = {
  heading: "제목",
  chart: "막대그래프",
  "stacked-bar": "누적 막대그래프",
  "grouped-bar": "그룹 막대그래프",
  "rank-composition": "순위 구성 막대",
  "journey-line": "시점 추이 꺾은선",
  waterfall: "변화량 워터폴",
  radar: "레이더 차트",
  quadrant: "중요도-만족도 사분면",
  "priority-reference": "우선순위 참고 지표",
  nps: "NPS 척도",
  polarity: "긍정·부정 비율 도넛",
  table: "표",
  "row-group": "항목별 표",
  "rich-static": "서술 블록",
  text: "안내 문구",
};

type Card = {
  key: string;
  /** 장 번호만. 장 필터의 기준이다. */
  numeral: string;
  chapter: string;
  section: string;
  /** 문항 원문. 문항에 딸리지 않는 절 단위 도표는 그 도표의 제목이 들어간다. */
  title: string;
  /** 문항 카드인가, 절 전체에 걸리는 도표 카드인가. */
  perQuestion: boolean;
  blocks: ReportBlock[];
};

/**
 * **헤더가 나오면 새 카드.** 문항 헤더면 문항 카드, 절·소절 헤더면 절 단위 카드다.
 *
 * 처음엔 절 헤더를 빵 부스러기로만 쓰고 카드를 안 열었는데, 그러면 **문항이 하나도 없는 장이
 * 통째로 사라졌다** — Ⅸ장 종합 결과 및 제언은 블록 6개가 전부 절 헤더 아래라 제목 없는 카드로
 * 떨어지고 문항 필터에도 걸렸다(2026-08-31 담당자 지적). 헤더는 종류를 가리지 않고 카드를 연다.
 */
function toCards(sections: ReportSectionContent[]): Card[] {
  const cards: Card[] = [];
  for (const section of sections) {
    const chapter = `${section.numeral}. ${section.title}`;
    let sectionTitle = "";
    let current: Card | null = null;

    const open = (title: string, perQuestion: boolean) => {
      current = {
        key: `${section.numeral}-${cards.length}`,
        numeral: section.numeral,
        chapter,
        // 절 카드는 제목이 곧 절 이름이라 빵 부스러기에 같은 말을 두 번 쓰지 않는다.
        section: title === sectionTitle ? "" : sectionTitle,
        title,
        perQuestion,
        blocks: [],
      };
      cards.push(current);
    };

    for (const block of section.blocks) {
      if (block.kind === "heading") {
        if (block.variant === "numbered") sectionTitle = block.text;
        open(block.text, block.variant === "question");
        continue;
      }
      if (!current) open(sectionTitle, false);
      current!.blocks.push(block);
    }
  }
  // 블록이 하나도 없는 카드(뒤에 바로 다른 헤더가 온 절 헤더 등)는 보여줄 레이아웃이 없다.
  return cards.filter((card) => card.blocks.length > 0);
}

/**
 * 미리보기는 **형식을 보는 화면이지 내용을 읽는 화면이 아니다**(담당자 확인 2026-08-31).
 * 정성 블록 하나에 카테고리 10여 개와 인용문 수십 줄이 들어 있어서, 그대로 두면 카드 한 장이
 * 화면 몇 개를 넘어가 정작 "어떤 형식으로 나오는가"가 안 보인다.
 *
 * 그래서 **HTML을 자르지 않고 높이만 접는다.** 잘라내면 실제 렌더러와 다른 결과를 보여주게
 * 되어 미리보기의 존재 이유가 사라진다 — 앞의 두세 항목만 보여도 형식은 그대로 드러난다.
 */
// 460으로 잡았더니 결과 요약 표(항목 | 주요 의견)가 첫 행 도중에 잘려 **항목 라벨이 사라졌다**
// — 세로 가운데 정렬이라 라벨이 잘린 아래쪽에 있었다. 형식을 보여주려고 접는 건데 형식이
// 안 보이면 뜻이 없다. 표 한 행과 정성 카테고리 두세 개가 들어가는 높이로 올렸다.
const CLAMP_HEIGHT = 700;

function PreviewBlock({ block }: { block: ReportBlock }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    // rich-static 은 마운트 뒤 useEffect 로 innerHTML 을 넣으므로 첫 측정만으로는 늘 0이다.
    const check = () => setClipped(inner.scrollHeight > CLAMP_HEIGHT + 4);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative" style={clipped ? { maxHeight: CLAMP_HEIGHT, overflow: "hidden" } : undefined}>
      <div ref={innerRef}>
        <BlockView block={block} onChange={() => {}} />
      </div>
      {clipped && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-t from-white via-white/90 to-transparent">
          <span className="pb-1 text-[12px] text-[#71717a]">실제 보고서에는 이 형식으로 계속 이어집니다</span>
        </div>
      )}
    </div>
  );
}

/**
 * **거르는 장치를 두지 않는다**(담당자 확인 2026-08-31). 장 필터·문항 필터·내용 펼치기 버튼을
 * 달았다가 전부 뺐다 — 이 화면에서 실무자가 하는 일은 "대충 훑고 넘어가기" 하나이고, 고르는
 * 버튼이 늘어날수록 그 하나가 흐려진다. 내용은 **항상 접어서** 형식만 보여준다.
 */
export function QuestionLayoutCards({
  dataset,
  source,
  onGenerate,
}: {
  dataset?: string;
  source?: string;
  /** 없으면 버튼을 감춘다(단독으로 열어보는 경우). */
  onGenerate?: () => void;
}) {
  const [sections, setSections] = useState<ReportSectionContent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = source
      ? `/api/report-workspace?source=${encodeURIComponent(source)}`
      : `/api/report-workspace/demo?dataset=${dataset ?? "rivalabs"}`;
    fetch(url)
      .then((response) => response.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? "불러오지 못했습니다.");
        setSections(json.workspace.sections);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [dataset, source]);

  const cards = useMemo(() => (sections ? toCards(sections) : []), [sections]);

  if (error) return <p className="p-8 text-sm text-[#b91c1c]">{error}</p>;
  if (!sections) return <p className="p-8 text-sm text-[#71717a]">보고서를 만드는 중…</p>;

  return (
    <div className="mx-auto max-w-[900px] px-5 py-8">
      <h1 className="text-xl font-bold text-[#18181b]">문항별 레이아웃 미리보기</h1>
      <p className="mt-1 text-sm text-[#71717a]">
        설문 문항 하나가 보고서에서 어떤 그래프·표로 나오는지 카드로 봅니다. 실제 보고서와 같은
        렌더러로 그리므로 <strong className="font-semibold text-[#52525b]">여기 보이는 형식이 그대로 나옵니다</strong> —
        글 내용은 예시일 뿐이라 길면 접어서 보여줍니다.
      </p>

      <p className="mt-3 text-[13px] text-[#a1a1aa]">문항 {cards.length}개 · 위에서 아래로 보고서 순서 그대로입니다.</p>

      <div className="mt-5 space-y-5">
        {cards.map((card) => (
          <article key={card.key} className="overflow-hidden rounded-xl border border-[#e4e4e7] bg-white">
            <header className="border-b border-[#f4f4f5] bg-[#fafbfd] px-5 py-3">
              <p className="text-[12px] text-[#71717a]">
                {card.chapter}
                {card.section ? ` · ${card.section}` : ""}
              </p>
              <h2 className="mt-0.5 text-[15px] font-bold leading-snug text-[#18181b]">
                {card.title || <span className="text-[#a1a1aa]">(제목 없음)</span>}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${card.perQuestion ? "bg-[#dfe6f7] text-[#315c9c]" : "bg-[#e8f0e9] text-[#3f6b45]"}`}
                >
                  {card.perQuestion ? "설문 문항" : "절 단위 종합"}
                </span>
                {[...new Set(card.blocks.map((block) => KIND_LABEL[block.kind]))].map((label) => (
                  <span key={label} className="rounded bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]">
                    {label}
                  </span>
                ))}
              </div>
            </header>
            {/* 문서 폭이 A4 기준이라 카드 안에서는 이미지·SVG 높이만 눌러 담는다
                (QuantReviewStep이 쓰는 것과 같은 방식). */}
            <div className="px-5 py-4 [&_[data-copy-ignore]]:hidden [&_img]:mx-auto [&_img]:max-h-[360px] [&_svg]:mx-auto [&_svg]:w-full [&_svg]:max-h-[420px]">
              {card.blocks.map((block) => (
                <PreviewBlock key={block.id} block={block} />
              ))}
            </div>
          </article>
        ))}
      </div>

      {/* 이 화면에서 실무자가 할 일은 하나뿐이라 버튼도 하나만 둔다. 스크롤 어디에 있든
          누를 수 있게 아래에 고정한다 — 카드를 끝까지 봐야 넘어갈 수 있는 화면이 아니다. */}
      {onGenerate && (
        <div className="sticky bottom-0 -mx-5 mt-6 border-t border-[#e4e4e7] bg-white/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onGenerate}
            className="w-full rounded-lg bg-[#356df3] px-6 py-3 text-[15px] font-bold text-white hover:bg-[#2d60da]"
          >
            이 구성으로 보고서 생성하기
          </button>
          <p className="mt-2 text-center text-[12px] text-[#a1a1aa]">
            생성한 뒤 모든 내용을 직접 고칠 수 있고, 최종본을 PDF·DOCX로 내려받습니다.
          </p>
        </div>
      )}
    </div>
  );
}