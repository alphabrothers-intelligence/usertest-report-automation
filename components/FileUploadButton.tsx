"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";

export interface UploadedFile {
  url: string;
  name: string;
}

export function FileUploadButton({
  onUploaded,
  disabled,
}: {
  onUploaded: (file: UploadedFile) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      onUploaded({ url: blob.url, name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        title="raw data 첨부"
        aria-label="raw data 첨부"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-lg text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
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
        accept=".xlsx"
        onChange={handleChange}
        className="hidden"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
