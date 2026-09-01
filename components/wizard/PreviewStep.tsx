"use client";

/**
 * 마법사 2단계 — **레이아웃 미리보기 + 보고서 열기.**
 *
 * 예전에는 여기가 "목차 확인 → 정량 검토 → 응답 분석" 세 화면이었다. 세 번 다 "확인했으니
 * 다음"을 누르는 게이트였는데, 담당자 결정(2026-08-31)으로 전부 없앴다 — 검토는 게이트가
 * 아니라 표시이고, 고칠 수 있는 곳은 어차피 보고서 웹뷰이기 때문이다. 요주의 지표는
 * 웹뷰의 해당 도표 옆으로 옮겼다(`ReviewFlagNotice`).
 *
 * **의견 분석을 기다리지 않는다.** 업로드 직후 정량·정성을 같이 시작해서, 정량이 끝나는 즉시
 * (수 초) 이 화면을 띄운다. 실무자가 카드를 훑는 동안 정성이 뒤에서 돌고, 다 끝나기 전에
 * 보고서로 넘어가도 된다 — 넘어간 화면이 job 을 이어서 돌린다(`useQualitativeJob`).
 */
import { useRouter } from "next/navigation";
import { QuestionLayoutCards } from "@/components/QuestionLayoutCards";
import { useQualitativeJob } from "@/components/wizard/useQualitativeJob";

export function PreviewStep({
  fileUrl,
  qualitativeJobId,
  qualitativeError,
}: {
  fileUrl: string;
  qualitativeJobId: string | null;
  qualitativeError: string | null;
}) {
  const router = useRouter();
  const job = useQualitativeJob(qualitativeJobId);

  const openReport = () => {
    const job_ = qualitativeJobId && !job.isFinished ? `&job=${encodeURIComponent(qualitativeJobId)}` : "";
    router.push(`/viewer?source=${encodeURIComponent(fileUrl)}${job_}`);
  };

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
              기다리지 않아도 됩니다. 아래 레이아웃을 훑어보고 보고서를 열면, 의견 분석은 그
              화면에서 계속 진행되고 끝나면 알려드립니다.
            </p>
            {job.networkNotice && <p className="mt-1 text-[13px] text-amber-800">{job.networkNotice}</p>}
          </>
        )}
      </div>

      <QuestionLayoutCards source={fileUrl} onGenerate={openReport} />
    </div>
  );
}