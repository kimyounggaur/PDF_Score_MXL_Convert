import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yauzl from "yauzl";
import { repackMxl } from "./mxl";

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("zip open failed"));
      else resolve(zip);
    });
  });
}

describe("mxl repack", () => {
  it("writes mimetype as the first stored ZIP entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mxl-test-"));
    const out = join(dir, "score.mxl");
    await repackMxl("<score-partwise version=\"4.0\"></score-partwise>", out);
    const bytes = await readFile(out);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");

    const zip = await openZip(out);
    const first = await new Promise<yauzl.Entry>((resolve, reject) => {
      zip.readEntry();
      zip.once("entry", resolve);
      zip.once("error", reject);
    });

    expect(first.fileName).toBe("mimetype");
    expect(first.compressionMethod).toBe(0);
    zip.close();
  });
});
