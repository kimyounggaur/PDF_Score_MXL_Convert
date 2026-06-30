import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PdfKind } from "@/shared/types";

const execFileAsync = promisify(execFile);

export interface PdfKindSignals {
  embeddedImageCount: number;
  hasEmbeddedFonts: boolean;
  pageObjectsAreBitmapOnly: boolean;
}

export interface PdfKindResult {
  kind: PdfKind;
  signals: PdfKindSignals;
  hint?: string;
}

export function parsePdfImagesOutput(output: string): number {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s+\d+\s+/.test(line)).length;
}

export function parsePdfFontsOutput(output: string): boolean {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !/^name\s+/i.test(line) && !/^[-\s]+$/.test(line) && !/no fonts/i.test(line));
}

export function classifyPdfSignals(signals: PdfKindSignals): PdfKind {
  if (signals.embeddedImageCount === 0 && signals.hasEmbeddedFonts) {
    return "vector";
  }
  if (signals.embeddedImageCount > 0 && !signals.hasEmbeddedFonts && signals.pageObjectsAreBitmapOnly) {
    return "raster";
  }
  return "unknown";
}

async function tryCommand(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

async function detectBitmapOnlyWithMutool(pdfPath: string): Promise<boolean> {
  const output = await tryCommand("mutool", ["info", pdfPath]);
  if (!output) {
    return false;
  }
  const imageObjects = /Images:\s*(\d+)/i.exec(output)?.[1];
  const fontObjects = /Fonts:\s*(\d+)/i.exec(output)?.[1];
  const images = Number(imageObjects ?? "0");
  const fonts = Number(fontObjects ?? "0");
  return images > 0 && fonts === 0;
}

export async function detectPdfKind(pdfPath: string): Promise<PdfKindResult> {
  const [imageOutput, fontOutput, bitmapOnly] = await Promise.all([
    tryCommand("pdfimages", ["-list", pdfPath]),
    tryCommand("pdffonts", [pdfPath]),
    detectBitmapOnlyWithMutool(pdfPath)
  ]);

  const signals: PdfKindSignals = {
    embeddedImageCount: parsePdfImagesOutput(imageOutput),
    hasEmbeddedFonts: parsePdfFontsOutput(fontOutput),
    pageObjectsAreBitmapOnly: bitmapOnly
  };
  const kind = classifyPdfSignals(signals);

  return {
    kind,
    signals,
    hint:
      kind === "vector"
        ? "Pure vector PDF detected. PDFtoMusic Pro-style direct conversion may be more accurate than raster OMR for notation-software PDFs."
        : undefined
  };
}
