"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CircleDollarSign } from "lucide-react";
import type { JobCostResponse, JobStatus } from "@/shared/types";

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function CostTracker({ jobId, status }: { jobId: string; status: JobStatus }) {
  const [cost, setCost] = useState<JobCostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/cost`, { cache: "no-store" });
        const data = (await res.json()) as JobCostResponse | { error?: string };
        if (cancelled) return;
        const responseError = (data as { error?: string }).error;
        if (!res.ok || responseError) {
          setError(responseError ?? "비용 정보를 불러오지 못했습니다.");
          return;
        }
        setCost(data as JobCostResponse);
        setError(null);
        if (status === "done" || status === "failed") {
          if (timer) clearInterval(timer);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void tick();
    timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId, status]);

  const percent = useMemo(() => {
    if (!cost?.limitRatio) return 0;
    return Math.min(100, Math.max(0, cost.limitRatio * 100));
  }, [cost]);
  const warning = Boolean(cost?.limitRatio && cost.limitRatio >= 0.8);

  return (
    <section className="cost-tracker" aria-label="Claude API 비용">
      <div className="cost-header">
        <span className="cost-title">
          <CircleDollarSign size={18} aria-hidden />
          Claude API 비용
        </span>
        {warning ? (
          <span className="cost-warning">
            <AlertTriangle size={14} aria-hidden />
            한도 근접
          </span>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="cost-total">
        <strong>{money(cost?.totalCost ?? 0)}</strong>
        <span className="muted">{cost?.limitUsd ? `/ ${money(cost.limitUsd)}` : "한도 미설정"}</span>
      </div>

      <div className="cost-meter" data-warning={warning}>
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="cost-breakdown">
        <div>
          <span className="muted">Sonnet</span>
          <strong>{money(cost?.breakdown.sonnet ?? 0)}</strong>
        </div>
        <div>
          <span className="muted">Opus</span>
          <strong>{money(cost?.breakdown.opus ?? 0)}</strong>
        </div>
      </div>

      <div className="cost-log">
        {(cost?.pageLog ?? []).slice(0, 6).map((entry) => (
          <div className="cost-log-row" key={entry.id}>
            <span>p{entry.pageNum ?? "-"}</span>
            <span>{entry.model.includes("opus") ? "Opus" : "Sonnet"}</span>
            <span>{compactTokens(entry.inputTokens + entry.outputTokens + entry.cacheCreationInputTokens5m + entry.cacheCreationInputTokens1h + entry.cacheReadInputTokens)} tok</span>
            <strong>{money(entry.costUsd)}</strong>
          </div>
        ))}
        {cost && cost.pageLog.length === 0 ? <p className="muted">아직 기록된 Claude 호출이 없습니다.</p> : null}
      </div>
    </section>
  );
}
