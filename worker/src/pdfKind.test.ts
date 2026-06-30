import { describe, expect, it } from "vitest";
import { classifyPdfSignals, parsePdfFontsOutput, parsePdfImagesOutput } from "./pdfKind";

describe("pdf kind signal parsing", () => {
  it("classifies vector PDFs when images are absent and embedded fonts exist", () => {
    const kind = classifyPdfSignals({
      embeddedImageCount: 0,
      hasEmbeddedFonts: true,
      pageObjectsAreBitmapOnly: false
    });

    expect(kind).toBe("vector");
  });

  it("classifies raster PDFs when large bitmap images exist and fonts are absent", () => {
    const kind = classifyPdfSignals({
      embeddedImageCount: 2,
      hasEmbeddedFonts: false,
      pageObjectsAreBitmapOnly: true
    });

    expect(kind).toBe("raster");
  });

  it("parses poppler outputs into stable signals", () => {
    expect(parsePdfImagesOutput("page num type width height\n1 0 image 2480 3508")).toBe(1);
    expect(parsePdfFontsOutput("name type encoding emb sub uni object ID\nABCDEE+Bravura TrueType yes yes yes 1 0")).toBe(true);
  });
});
