"use client";

import { useId, useState } from "react";

/** 웹 문서에서만 쓰는 이미지 첨부 슬롯. 원본 파일의 이미지 도형 위치와는 아직 분리된 POC다. */
export function ReportImageUploadSlots({
  storageKey,
  emptyLabel = "이미지 첨부",
  maxImages = 6,
  variant = "product",
}: {
  storageKey: string;
  emptyLabel?: string;
  maxImages?: number;
  variant?: "product" | "wordcloud";
}) {
  const inputId = useId();
  const [images, setImages] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) as string[] : [];
    } catch {
      return [];
    }
  });

  function save(next: string[]) {
    setImages(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 화면 상태는 유지 */ }
  }

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, maxImages - images.length));
    Promise.all(selected.map((file) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }))).then((next) => save([...images, ...next])).catch(() => undefined);
  }

  const hasImages = images.length > 0;
  const canAdd = images.length < maxImages;
  // data-print-keep: 담당자가 붙인 이미지(워드클라우드·제품 사진)는 보고서 내용이므로 인쇄된다.
  // 첨부/삭제 컨트롤만 인쇄에서 빠진다(globals.css 인쇄 규칙) — 복사 제외와 인쇄 제외는 다르다.
  return <div className={`rivalabs-image-slots rivalabs-image-slots--${variant}`} data-count={Math.min(images.length, maxImages)} data-copy-ignore data-print-keep>
    {images.map((image, index) => <figure key={image} className="rivalabs-image-preview">
      <img src={image} alt={`첨부 이미지 ${index + 1}`} />
      <button type="button" className="rivalabs-image-remove" onClick={() => save(images.filter((_, imageIndex) => imageIndex !== index))} aria-label={`${index + 1}번 이미지 삭제`}>×</button>
    </figure>)}
    {canAdd ? <label className={`rivalabs-image-add ${hasImages ? "rivalabs-image-add--overlay" : ""}`} htmlFor={inputId}>
      <span>＋</span>
      <strong>{emptyLabel}</strong>
      {variant === "wordcloud" ? <small>권장 1:1 · PNG/JPG<br />이 칸에 맞춰 자동 배치</small> : <small>{hasImages ? `이미지 추가 (${images.length}/${maxImages})` : "1~6장 · 이미지 수에 따라 자동 배치"}</small>}
      <input id={inputId} type="file" accept="image/*" multiple={maxImages > 1} onChange={(event) => onFiles(event.target.files)} />
    </label> : null}
  </div>;
}
