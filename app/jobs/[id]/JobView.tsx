"use client";

import Link from "next/link";
import { AlertTriangle, Download, RotateCcw } from "lucide-react";
import { useJobPolling } from "./useJobPolling";
import { ProgressSteps } from "@/components/ProgressSteps";
import { ScorePreview } from "@/components/ScorePreview";
import { DiffReport } from "@/components/DiffReport";
import { AccuracyBadge } from "@/components/AccuracyBadge";
import { CostTracker } from "@/components/CostTracker";

export function JobView({ id }: { id: string }) {
  const job = useJobPolling(id);

  if (!job) {
    return (
      <main className="app-shell">
        <section className="panel section">
          <p className="muted">잡 상태를 불러오는 중입니다.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="job-shell">
        <section className="panel section">
          <div className="button-row">
            <h1 style={{ marginRight: "auto" }}>변환 작업</h1>
            <AccuracyBadge pdfKind={job.pdfKind} preprocessQuality={job.report?.warnings?.length ? "warning" : "good"} accuracyScore={job.accuracyScore} />
            <Link className="button secondary" href="/">
              <RotateCcw size={16} aria-hidden />
              새 작업
            </Link>
          </div>
          <p className="muted">{id}</p>
        </section>

        {job.status === "failed" ? (
          <section className="panel section">
            <h2>
              <AlertTriangle size={20} aria-hidden /> 변환 실패
            </h2>
            <p className="error">{job.error}</p>
            <CostTracker jobId={id} status={job.status} />
            {job.downloadUrl ? (
              <p>
                <a className="button" href={job.downloadUrl} download>
                  <Download size={16} aria-hidden />
                  MXL 다운로드
                </a>
              </p>
            ) : null}
          </section>
        ) : (
          <div className="job-grid">
            <aside className="panel section">
              <ProgressSteps stage={job.stage} status={job.status} />
              <div className="metric-grid">
                <div className="metric">
                  <span className="muted">페이지</span>
                  <strong>{job.pageCount ?? "-"}</strong>
                </div>
                <div className="metric">
                  <span className="muted">비용</span>
                  <strong>${job.costUsd.toFixed(4)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">검수</span>
                  <strong>{job.needsHumanCount ?? 0}</strong>
                </div>
                <div className="metric">
                  <span className="muted">종료</span>
                  <strong>{job.terminationReason ?? job.status}</strong>
                </div>
              </div>
              <CostTracker jobId={id} status={job.status} />
              {job.downloadUrl ? (
                <p>
                  <a className="button" href={job.downloadUrl} download>
                    <Download size={16} aria-hidden />
                    MXL 다운로드
                  </a>
                </p>
              ) : null}
            </aside>
            <section className="panel section preview-box">
              <h2>미리보기</h2>
              {job.downloadUrl ? <ScorePreview mxlUrl={job.downloadUrl} /> : <p className="muted">결과 파일을 기다리는 중입니다.</p>}
            </section>
            <section className="panel section" style={{ gridColumn: "1 / -1" }}>
              <DiffReport report={job.report} />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
