"use client";

import { upload } from "@vercel/blob/client";

const RAW_TYPES: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};
import { useRef, useState } from "react";

export interface UploadedFile {
  url: string;
  name: string;
}

export function FileUploadButton({
  onUploaded,
  onUploadingChange,
  disabled,
}: {
  onUploaded: (file: UploadedFile) => void;
  /**
   * 여러 파일을 한 번에 첨부하면 업로드 시간이 파일마다 달라서(2026-07-20 발견: 작은 파일이
   * 먼저 끝나 컴포저에 칩으로 뜨는 동안 큰 파일은 아직 업로드 중일 수 있음), 부모가 "아직 업로드
   * 중인 파일이 있다"를 알고 전송 버튼을 막을 수 있도록 상태를 밖으로 올려준다.
   */
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    onUploadingChange?.(true);
    setError(null);
    try {
      // raw data 파일 하나 + 기업소개 파일 하나처럼 여러 개를 한 번에 첨부하는 경우를 지원한다
      // (2026-07-20 피드백). 각 파일은 독립적으로 업로드되므로 병렬로 처리한다.
      await Promise.all(
        files.map(async (file) => {
          const blob = await upload(file.name, file, {
            // raw data에 응답자 개인정보가 포함되므로 토큰 없이는 못 읽는 private 스토어를 씀 —
            // "public"으로 두면 스토어가 private로 설정된 경우 업로드 자체가 거부된다(실측 확인,
            // 2026-07-19: "Cannot use public access on a private store").
            access: "private",
            handleUploadUrl: "/api/upload",
            // 브라우저가 붙이는 형식은 OS마다 다르다(윈도 csv → application/vnd.ms-excel, 비어 있기도 함).
            // raw data는 확장자로 형식을 정해 업로드 허용 목록에서 거부되지 않게 한다.
            ...(RAW_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ? { contentType: RAW_TYPES[file.name.split(".").pop()!.toLowerCase()] } : {}),
          });
          onUploaded({ url: blob.url, name: file.name });
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        title="파일 첨부 (raw data 또는 기업소개 자료)"
        aria-label="파일 첨부"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        {uploading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
        ) : (
          <span aria-hidden>📎</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv,.pdf,.docx,.txt"
        onChange={handleChange}
        className="hidden"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
