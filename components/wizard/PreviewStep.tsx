"use client";

/**
 * 마법사 2단계 — **레이아웃 미리보기 + 보고서 열기.**
 *
 * 예전에는 여기가 "목차 확인 → 정량 검토 → 응답 분석" 세 화면이었다. 세 번 다 "확인했으니
 * 다음"을 누르는 게이트였는데, 담당자 결정(2026-08-31)으로 전부 없앴다 — 검토는 게이트가
 * 아니라 표시이고, 고칠 수 있는 곳은 어차피 보고서 웹뷰이기 때문이다. 요주의 지표는
 * 웹뷰의 해당 도표 옆으로 옮겼다(`ReviewFlagNotice`).
 *
 * **정성 분석은 업로드 직후 이미 시작돼 있다.** 정량이 끝나는 즉시(수 초) 이 화면을 띄우므로,
 * 실무자가 카드를 훑는 동안 몇 문항은 이미 끝난다 — 그만큼 다음 화면에서 기다리는 시간이 짧다.
 *
 * **여기서 보고서로 바로 넘어가지는 않는다**(2026-09-02 되돌림). 예전엔 정성이 안 끝나도 웹뷰로
 * 넘겼는데, 완성된 보고서 모양인데 의견만 비어 있어 담당자가 다 됐다고 착각했다. 지금은
 * `GeneratingStep`(생성 중 화면)을 거쳐 **완성본만** 연다.
 */
import { QuestionLayoutCards } from "@/components/QuestionLayoutCards";
import { useQualitativeJob } from "@/components/wizard/useQualitativeJob";

export function PreviewStep({
  fileUrl,
  qualitativeJobId,
  qualitativeError,
  onGenerate,
}: {
  fileUrl: string;
  qualitativeJobId: string | null;
  qualitativeError: string | null;
  /** 라우팅은 부모(마법사)가 한다 — 이 화면은 다음 단계가 무엇인지 몰라도 된다. */
  onGenerate: () => void;
}) {
  const job = useQualitativeJob(qualitativeJobId);

  return (
    <div className="w-full">
      <div className="mb-4 rounded-lg border border-[#dde5ef] bg-[#f8fafc] px-4 py-3 text-sm">
        {qualitativeError ? (
          <p className="text-[#b54141]">
            의견 분석을 시작하지 못했습니다 ({qualitativeError}). 정량 결과만으로 보고서를 만들 수 있습니다.
          </p>
        ) : job.isFinished ? (
          <p className="font-semibold text-emerald-800">의견 분석까지 끝났습니다. 바로 보고서를 여세요.</p>
        ) : (
          <>
            <p className="flex items-center gap-2 font-semibold text-[#354158]">
              <span className="size-2 animate-pulse rounded-full bg-[#356df3]" />
              의견 분석이 뒤에서 진행 중입니다{job.total > 0 ? ` · ${job.done}/${job.total} 문항` : ""}
            </p>
            <p className="mt-1 text-[13px] text-[#78869a]">
              아래 레이아웃을 훑어보시는 동안 계속 진행됩니다. 보고서를 만들면 남은 분석이
              끝날 때까지 기다렸다가 완성본을 엽니다.
            </p>
            {job.networkNotice && <p className="mt-1 text-[13px] text-amber-800">{job.networkNotice}</p>}
          </>
        )}
      </div>

      <QuestionLayoutCards source={fileUrl} onGenerate={onGenerate} />
    </div>
  );
}