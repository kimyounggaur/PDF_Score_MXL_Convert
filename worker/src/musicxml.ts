import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import yauzl from "yauzl";

export interface MeasureRef {
  measureNumber: string;
  partId: string;
  index: number;
  startsNewSystem: boolean;
  startsNewPage: boolean;
  node: unknown;
}

export interface ParsedScore {
  scoreType: "partwise" | "timewise";
  parts: { partId: string; measures: MeasureRef[] }[];
  rootDoc: unknown;
  millimeters?: number;
  tenths?: number;
}

export interface PageMeasureMap {
  pageNumber: number;
  measures: { partId: string; measureNumber: string }[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attrYes(value: unknown): boolean {
  return value === "yes" || value === true;
}

export async function unzipMxl(mxlPath: string, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(mxlPath, { lazyEntries: true }, (error, file) => {
      if (error || !file) reject(error ?? new Error("Unable to open MXL"));
      else resolve(file);
    });
  });

  const entries: string[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.readEntry();
    zip.on("entry", (entry) => {
      const target = path.normalize(path.join(outDir, entry.fileName));
      if (!target.startsWith(path.normalize(outDir))) {
        reject(new Error(`Unsafe MXL entry path: ${entry.fileName}`));
        return;
      }
      if (/\/$/.test(entry.fileName)) {
        void mkdir(target, { recursive: true }).then(() => zip.readEntry(), reject);
        return;
      }
      void mkdir(path.dirname(target), { recursive: true })
        .then(
          () =>
            new Promise<void>((entryResolve, entryReject) => {
              zip.openReadStream(entry, (streamError, stream) => {
                if (streamError || !stream) {
                  entryReject(streamError ?? new Error("Unable to read MXL entry"));
                  return;
                }
                stream
                  .pipe(createWriteStream(target))
                  .on("close", () => {
                    entries.push(entry.fileName);
                    entryResolve();
                  })
                  .on("error", entryReject);
              });
            })
        )
        .then(() => zip.readEntry(), reject);
    });
    zip.on("end", resolve);
    zip.on("error", reject);
  });

  const containerPath = path.join(outDir, "META-INF", "container.xml");
  const container = await readFile(containerPath, "utf8");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const doc = parser.parse(container);
  const rootfiles = asArray(doc.container?.rootfiles?.rootfile);
  const rootfile = rootfiles[0]?.["full-path"];
  if (!rootfile || typeof rootfile !== "string") {
    throw new Error("MXL container.xml does not define a rootfile");
  }

  const xmlPath = path.join(outDir, rootfile);
  if (!entries.includes(rootfile)) {
    throw new Error(`MXL rootfile was not found in archive: ${rootfile}`);
  }
  return xmlPath;
}

export async function parseMusicXml(musicxmlPath: string): Promise<ParsedScore> {
  const xml = await readFile(musicxmlPath, "utf8");
  const extractionParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    preserveOrder: false
  });
  const orderParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    preserveOrder: true
  });
  const doc = extractionParser.parse(xml);
  const rootDoc = orderParser.parse(xml);
  const score = doc["score-partwise"] ?? doc["score-timewise"];
  const scoreType = doc["score-partwise"] ? "partwise" : "timewise";
  if (!score) {
    throw new Error("Unsupported MusicXML root. Expected score-partwise or score-timewise.");
  }

  const defaults = score.defaults?.scaling;
  const parts = asArray(score.part).map((part: any) => {
    const partId = String(part.id ?? part["@_id"] ?? "P1");
    const measures = asArray(part.measure).map((measure: any, index) => {
      const print = asArray(measure.print)[0] as Record<string, unknown> | undefined;
      return {
        measureNumber: String(measure.number ?? index + 1),
        partId,
        index,
        startsNewSystem: attrYes(print?.["new-system"]),
        startsNewPage: attrYes(print?.["new-page"]),
        node: measure
      };
    });
    return { partId, measures };
  });

  return {
    scoreType,
    parts,
    rootDoc,
    millimeters: defaults?.millimeters ? Number(defaults.millimeters) : undefined,
    tenths: defaults?.tenths ? Number(defaults.tenths) : undefined
  };
}

export function mapPagesToMeasures(score: ParsedScore, pageCount: number): PageMeasureMap[] {
  const pages: PageMeasureMap[] = Array.from({ length: Math.max(pageCount, 1) }, (_, index) => ({
    pageNumber: index + 1,
    measures: []
  }));

  for (const part of score.parts) {
    let page = 1;
    for (const measure of part.measures) {
      if (measure.startsNewPage && measure.index > 0) {
        page = Math.min(page + 1, pages.length);
      }
      pages[page - 1]!.measures.push({ partId: part.partId, measureNumber: measure.measureNumber });
    }
  }

  return pages.filter((page) => page.measures.length > 0);
}
