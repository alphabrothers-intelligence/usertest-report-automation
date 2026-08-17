"use client";

import { useEffect, useState } from "react";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { WorkspaceResponse } from "./model";

type LoadState = "loading" | "ready" | "error";

export function useHwpxPreviewWorkspace(sourceFileUrl?: string) {
  const [workspace, setWorkspace] = useState<ReportWorkspaceSeed | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const endpoint = sourceFileUrl
      ? `/api/report-workspace?source=${encodeURIComponent(sourceFileUrl)}`
      : "/api/report-workspace/demo";
    const abortController = new AbortController();

    void fetch(endpoint, { cache: "no-store", signal: abortController.signal })
      .then(async (response) => {
        const payload = await response.json() as WorkspaceResponse;
        if (!response.ok || !payload.ok || !payload.workspace) {
          throw new Error(payload.error ?? "보고서 데이터를 불러오지 못했습니다.");
        }
        return payload.workspace;
      })
      .then((loadedWorkspace) => {
        setWorkspace(loadedWorkspace);
        setState("ready");
      })
      .catch((reason: unknown) => {
        if (abortController.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "보고서 데이터를 불러오지 못했습니다.");
        setState("error");
      });

    return () => abortController.abort();
  }, [sourceFileUrl]);

  return { workspace, state, error };
}
