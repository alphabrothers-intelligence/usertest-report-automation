"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { SurveyList } from "@/components/survey/SurveyList";
import { SurveyEditor } from "@/components/survey/SurveyEditor";
import type { SurveyDraft } from "@/lib/survey/types";

/** 고칠 때마다 저장하면 글자마다 요청이 나간다 — 손을 멈추고 이만큼 지나면 저장한다. */
const SAVE_DELAY_MS = 800;

type SaveState = "saved" | "saving" | "error";

/**
 * 설문 문항 화면. id가 없으면 목록 + 새로 만들기, 있으면 그 문항 편집.
 * 만들 때 서버에 저장되고(POST /api/survey/generate), 이후 고친 내용은 자동 저장된다(PUT).
 */
export function SurveyStudio({ initialId }: { initialId: string | null }) {
  const router = useRouter();
  const [id, setId] = useState(initialId);
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [loading, setLoading] = useState(initialId !== null);
  const [status, setStatus] = useState<"idle" | "uploading" | "generating">("idle");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** 서버에서 막 받은 draft는 다시 저장하지 않는다. */
  const pristine = useRef(true);

  useEffect(() => {
    if (!initialId) return;
    fetch(`/api/survey/${initialId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        pristine.current = true;
        setDraft(payload.draft);
        setFileName(payload.sourceFileName ?? "");
      })
      .catch(() => setError("저장된 설문 문항을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [initialId]);

  useEffect(() => {
    if (!id || !draft) return;
    if (pristine.current) {
      pristine.current = false;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/survey/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [id, draft]);

  async function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "hwp") {
      setError("HWP(구버전) 파일은 읽을 수 없습니다. 한글에서 '다른 이름으로 저장 → PDF'로 저장해 올려 주세요(HWPX도 됩니다).");
      return;
    }
    setError(null);
    setFileName(file.name);
    try {
      setStatus("uploading");
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        // 브라우저는 hwpx의 type을 비워 보낸다 — 업로드 허용 목록과 맞춰 명시한다.
        ...(ext === "hwpx" ? { contentType: "application/hwp+zip" } : {}),
      });
      setStatus("generating");
      const response = await fetch("/api/survey/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: blob.url, fileName: file.name }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? "설문 문항을 만들지 못했습니다.");
      // 새로 만든 문항은 이미 저장돼 있다 — 주소만 그 문항으로 바꾼다.
      pristine.current = true;
      setId(payload.id);
      setDraft(payload.draft);
      router.replace(`/survey?id=${payload.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설문 문항을 만들지 못했습니다.");
    } finally {
      setStatus("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = status !== "idle";

  return (
    <div className="flex min-h-screen bg-[#f4f5f8]">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-6 py-10 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#356df3]">
                {draft ? <Link href="/survey" className="hover:underline">설문 문항 목록</Link> : "설문 문항 생성"}
              </p>
              <h1 className="mt-1 text-[30px] font-bold tracking-[-0.035em] text-[#1d2433]">
                {draft ? `${draft.companyName || "기업명 없음"} 설문 문항` : "사전요청서로 설문 문항 만들기"}
              </h1>
              <p className="mt-1 text-[15px] text-[#6b778a]">
                {draft
                  ? `${fileName ? `‘${fileName}’에서 만든 문항입니다. ` : ""}고친 내용은 자동으로 저장됩니다.`
                  : "기업이 보낸 사전요청서를 올리면 표준 구성에 맞춘 문항을 만듭니다. 고친 뒤 다음 단계에서 기획안을 만듭니다."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {draft && <SaveBadge state={saveState} />}
              {!draft && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="rounded-lg bg-[#356df3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2a5bd6] disabled:opacity-50"
                >
                  사전요청서 올리기
                </button>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".hwpx,.hwp,.pdf,.docx,.txt"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          </header>

          {busy && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#dfe4ec] bg-white px-5 py-4 text-[15px] text-[#1d2433]">
              <span className="size-4 animate-spin rounded-full border-2 border-[#356df3] border-t-transparent" />
              {status === "uploading" ? `‘${fileName}’ 올리는 중…` : `‘${fileName}’을 읽고 문항을 설계하는 중… (보통 1~2분 걸립니다)`}
            </div>
          )}
          {error && <p className="mb-6 rounded-xl border border-[#f3c4bd] bg-[#fff4f2] px-5 py-4 text-[15px] text-[#b42318]">{error}</p>}
          {loading && <p className="text-[15px] text-[#6b778a]">불러오는 중…</p>}

          {!initialId && !draft && !busy && (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#cdd5e1] bg-white px-6 py-12 text-center hover:border-[#356df3]"
              >
                <span className="text-[17px] font-semibold text-[#1d2433]">사전요청서 파일을 선택하세요</span>
                <span className="text-[14px] text-[#6b778a]"><b className="text-[#356df3]">PDF 권장</b> — 표와 스캔본까지 가장 정확하게 읽습니다. HWPX · DOCX · TXT도 됩니다. HWP(구버전)는 PDF로 저장해 올려 주세요.</span>
              </button>
              <SurveyList />
            </>
          )}

          {draft && <SurveyEditor draft={draft} onChange={setDraft} surveyId={id} />}
        </div>
      </main>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const label = { saved: "저장됨", saving: "저장 중…", error: "저장 실패 — 다시 고치면 재시도합니다" }[state];
  return <span className={`text-[13px] ${state === "error" ? "font-semibold text-[#b42318]" : "text-[#6b778a]"}`}>{label}</span>;
}
