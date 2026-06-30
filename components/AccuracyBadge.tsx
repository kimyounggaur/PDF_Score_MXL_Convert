import { Gauge, ScanLine } from "lucide-react";
import type { PdfKind } from "@/shared/types";

export function AccuracyBadge({
  pdfKind,
  preprocessQuality,
  accuracyScore
}: {
  pdfKind: PdfKind;
  preprocessQuality: "good" | "warning";
  accuracyScore?: number | null;
}) {
  return (
    <div className="badge-row" aria-label="정확도 상태">
      <span className="badge teal">
        <ScanLine size={14} aria-hidden />
        {pdfKind}
      </span>
      <span className={preprocessQuality === "good" ? "badge green" : "badge amber"}>{preprocessQuality === "good" ? "품질 좋음" : "품질 주의"}</span>
      {typeof accuracyScore === "number" ? (
        <span className="badge teal">
          <Gauge size={14} aria-hidden />
          {(accuracyScore * 100).toFixed(1)}%
        </span>
      ) : null}
    </div>
  );
}
