"use client";

import dynamic from "next/dynamic";

const ScorePreviewInner = dynamic(() => import("./ScorePreviewInner").then((mod) => mod.ScorePreviewInner), {
  ssr: false,
  loading: () => <p className="muted">악보 렌더러를 불러오는 중입니다.</p>
});

export function ScorePreview({ mxlUrl }: { mxlUrl: string }) {
  return <ScorePreviewInner mxlUrl={mxlUrl} />;
}
