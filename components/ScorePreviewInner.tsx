"use client";

import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

export function ScorePreviewInner({ mxlUrl }: { mxlUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ref.current) return;
      setError(null);
      ref.current.innerHTML = "";
      try {
        const osmd = new OpenSheetMusicDisplay(ref.current, {
          autoResize: true,
          drawingParameters: "compact"
        });
        const response = await fetch(mxlUrl, { cache: "no-store" });
        const blob = await response.blob();
        if (cancelled) return;
        await osmd.load(blob);
        if (cancelled) return;
        osmd.render();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mxlUrl]);

  return (
    <div>
      {error ? <p className="error">{error}</p> : null}
      <div className="osmd-target" ref={ref} />
    </div>
  );
}
