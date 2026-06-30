import type { DiffReport as DiffReportType } from "@/shared/types";

export function DiffReport({ report }: { report: DiffReportType | null }) {
  if (!report) {
    return (
      <div>
        <h2>리포트</h2>
        <p className="muted">아직 리포트가 없습니다.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="button-row">
        <h2 style={{ marginRight: "auto" }}>리포트</h2>
        <span className="badge teal">{report.final_mode ?? "REPORT"}</span>
        {report.stopReason ? <span className="badge amber">{report.stopReason}</span> : null}
      </div>
      <div className="badge-row">
        <span className="badge green">코드 {report.summary?.chords_added ?? 0}</span>
        <span className="badge green">가사 {report.summary?.lyrics_added ?? 0}</span>
        <span className="badge green">음표 {report.summary?.notes_fixed ?? 0}</span>
        <span className="badge amber">스킵 {report.summary?.skipped ?? 0}</span>
      </div>
      {report.warnings?.length ? (
        <div className="report-list" style={{ marginTop: 14 }}>
          {report.warnings.map((warning) => (
            <div className="report-item" key={warning}>
              <strong>경고</strong>
              <p className="muted">{warning}</p>
            </div>
          ))}
        </div>
      ) : null}
      {report.pages?.length ? (
        <div className="report-list" style={{ marginTop: 14 }}>
          {report.pages.map((page) => (
            <details className="report-item" key={page.page}>
              <summary>페이지 {page.page}</summary>
              <pre>{JSON.stringify(page, null, 2)}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
