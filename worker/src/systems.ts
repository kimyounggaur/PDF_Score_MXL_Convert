import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ParsedScore } from "./musicxml";
import { mapPagesToMeasures, type PageMeasureMap } from "./musicxml";
import type { RenderedPage } from "./render";

export interface SystemBox {
  systemId: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  measureRange: { partId: string; from: string; to: string }[];
  source: "musicxml" | "image";
}

interface RowCluster {
  start: number;
  end: number;
}

function clusterRows(rows: number[], gap = 12): RowCluster[] {
  const clusters: RowCluster[] = [];
  for (const row of rows) {
    const last = clusters.at(-1);
    if (!last || row - last.end > gap) {
      clusters.push({ start: row, end: row });
    } else {
      last.end = row;
    }
  }
  return clusters;
}

async function detectSystemBoxes(page: RenderedPage): Promise<Array<{ y: number; h: number }>> {
  const image = sharp(page.fullPngPath).grayscale();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const raw = await image.raw().toBuffer();
  const darkRows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 1) {
      if (raw[y * width + x]! < 120) dark += 1;
    }
    if (dark > width * 0.18) darkRows.push(y);
  }
  const lineClusters = clusterRows(darkRows, 3);
  const systemClusters = clusterRows(
    lineClusters.map((cluster) => Math.round((cluster.start + cluster.end) / 2)),
    80
  );
  if (systemClusters.length === 0) {
    return [{ y: 0, h: height }];
  }
  return systemClusters.map((cluster) => {
    const padding = 48;
    const y = Math.max(0, cluster.start - padding);
    const bottom = Math.min(height, cluster.end + padding);
    return { y, h: Math.max(1, bottom - y) };
  });
}

function measureRangeForPage(pageMap: PageMeasureMap | undefined): SystemBox["measureRange"] {
  const grouped = new Map<string, string[]>();
  for (const measure of pageMap?.measures ?? []) {
    const list = grouped.get(measure.partId) ?? [];
    list.push(measure.measureNumber);
    grouped.set(measure.partId, list);
  }
  return [...grouped.entries()].map(([partId, measures]) => ({
    partId,
    from: measures[0] ?? "1",
    to: measures.at(-1) ?? measures[0] ?? "1"
  }));
}

export async function sliceSystems(
  pages: RenderedPage[],
  score: ParsedScore,
  jobDir: string,
  opts: { method?: "musicxml" | "image" | "auto" } = {}
): Promise<SystemBox[]> {
  const systemsDir = path.join(jobDir, "systems");
  await mkdir(systemsDir, { recursive: true });
  const pageMaps = mapPagesToMeasures(score, pages.length);
  const systems: SystemBox[] = [];

  for (const page of pages) {
    const metadata = await sharp(page.fullPngPath).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const boxes = opts.method === "musicxml" ? [{ y: 0, h: height }] : await detectSystemBoxes(page);
    let index = 0;
    for (const box of boxes) {
      index += 1;
      const systemId = `p${page.pageNumber}-s${index}`;
      const imagePath = path.join(systemsDir, `system-${systemId}.png`);
      const bbox = { x: 0, y: box.y, w: width, h: box.h };
      await sharp(page.fullPngPath).extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }).png().toFile(imagePath);
      systems.push({
        systemId,
        page: page.pageNumber,
        bbox,
        measureRange: measureRangeForPage(pageMaps.find((map) => map.pageNumber === page.pageNumber)),
        source: opts.method === "musicxml" ? "musicxml" : "image"
      });
    }
  }

  await writeFile(path.join(jobDir, "coords.json"), JSON.stringify({ systems, pages: pageMaps }, null, 2));
  return systems;
}
