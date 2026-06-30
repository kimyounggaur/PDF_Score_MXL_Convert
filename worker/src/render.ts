import { execFile } from "node:child_process";
import { mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export interface RenderedPage {
  pageNumber: number;
  fullPngPath: string;
  visionPngPath: string;
  width: number;
  height: number;
}

function pageNumberFromName(name: string): number {
  const match = /(\d+)\.png$/i.exec(name);
  return Number(match?.[1] ?? 1);
}

export async function renderPages(
  inputPdfPath: string,
  jobDir: string,
  opts: { dpi?: number; visionMaxEdge?: number } = {}
): Promise<RenderedPage[]> {
  const pagesDir = path.join(jobDir, "pages");
  const visionDir = path.join(pagesDir, "vision");
  await mkdir(pagesDir, { recursive: true });
  await mkdir(visionDir, { recursive: true });

  const prefix = path.join(pagesDir, "page");
  await execFileAsync("pdftoppm", ["-png", "-r", String(opts.dpi ?? 300), inputPdfPath, prefix], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });

  const files = (await readdir(pagesDir))
    .filter((file) => /^page-\d+\.png$/i.test(file))
    .sort((a, b) => pageNumberFromName(a) - pageNumberFromName(b));

  const rendered: RenderedPage[] = [];
  for (const file of files) {
    const pageNumber = pageNumberFromName(file);
    const fullPngPath = path.join(pagesDir, file);
    const visionPngPath = path.join(visionDir, file);
    const metadata = await sharp(fullPngPath).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const maxEdge = Math.max(width, height);
    const limit = opts.visionMaxEdge ?? 1568;
    if (maxEdge > limit) {
      await sharp(fullPngPath)
        .resize(width >= height ? { width: limit } : { height: limit })
        .png()
        .toFile(visionPngPath);
    } else {
      await copyFile(fullPngPath, visionPngPath);
    }
    const visionMetadata = await sharp(visionPngPath).metadata();
    rendered.push({
      pageNumber,
      fullPngPath,
      visionPngPath,
      width: visionMetadata.width ?? width,
      height: visionMetadata.height ?? height
    });
  }

  return rendered;
}
