"use client";

import { useEffect, useState } from "react";
import type { JobResponse } from "@/shared/types";

export function useJobPolling(id: string, intervalMs = 2500): JobResponse | null {
  const [job, setJob] = useState<JobResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      const data = (await res.json()) as JobResponse;
      if (cancelled) return;
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        if (timer) clearInterval(timer);
      }
    }

    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [id, intervalMs]);

  return job;
}
