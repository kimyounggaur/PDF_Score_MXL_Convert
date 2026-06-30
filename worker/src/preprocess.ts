import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PdfKind } from "@/shared/types";
import { renderPages } from "./render";

export interface PageQuality {
  page: number;
  dpiEstimate: number;
  interlinePx: number | null;
  contrast: number;
  skewDeg: number;
  blurVar: number;
  warnings: Array<"LOW_DPI" | "LOW_CONTRAST" | "HIGH_SKEW" | "BLURRY">;
}

export interface PreprocessResult {
  images: string[];
  originalImages: string[];
  qualityReport: { pages: PageQuality[]; overallWarning: boolean };
}

async function estimateQuality(imagePath: string, page: number): Promise<PageQuality> {
  const stats = await sharp(imagePath).stats();
  const channel = stats.channels[0];
  const contrast = channel ? channel.stdev : 0;
  const warnings: PageQuality["warnings"] = [];
  if (contrast < 20) warnings.push("LOW_CONTRAST");
  return {
    page,
    dpiEstimate: 300,
    interlinePx: null,
    contrast,
    skewDeg: 0,
    blurVar: 0,
    warnings
  };
}

export async function preprocessForOmr(input: { pdfPath: string; kind: PdfKind; jobDir: string }): Promise<PreprocessResult> {
  const originalDir = path.join(input.jobDir, "original");
  const preprocessDir = path.join(input.jobDir, "preprocessed");
  await mkdir(originalDir, { recursive: true });
  await mkdir(preprocessDir, { recursive: true });

  const dpi = input.kind === "vector" ? 400 : Number(process.env.TARGET_INPUT_DPI ?? 300);
  const pages = await renderPages(input.pdfPath, input.jobDir, { dpi, visionMaxEdge: 1568 });
  const images: string[] = [];
  const originalImages: string[] = [];
  const qualities: PageQuality[] = [];

  for (const page of pages) {
    const originalPath = path.join(originalDir, `page-${String(page.pageNumber).padStart(2, "0")}.png`);
    const processedPath = path.join(preprocessDir, `page-${String(page.pageNumber).padStart(2, "0")}.png`);
    await copyFile(page.fullPngPath, originalPath);
    await sharp(page.fullPngPath).grayscale().png().toFile(processedPath);
    images.push(processedPath);
    originalImages.push(originalPath);
    qualities.push(await estimateQuality(processedPath, page.pageNumber));
  }

  const qualityReport = { pages: qualities, overallWarning: qualities.some((page) => page.warnings.length > 0) };
  await writeFile(path.join(preprocessDir, "preprocess.json"), JSON.stringify(qualityReport, null, 2));
  return { images, originalImages, qualityReport };
}
