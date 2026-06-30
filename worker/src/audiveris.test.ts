import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectAudiverisOutputs, isZipSignature } from "./audiveris";

describe("audiveris helpers", () => {
  it("detects MXL zip signatures", () => {
    expect(isZipSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZipSignature(Buffer.from("not a zip"))).toBe(false);
  });

  it("collects multiple MXL outputs and OMR project files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audiveris-test-"));
    const nested = join(dir, "input");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(nested, { recursive: true }));
    await writeFile(join(nested, "input.mxl"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await writeFile(join(nested, "movement-2.mxl"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await writeFile(join(nested, "input.omr"), "omr");

    const result = await collectAudiverisOutputs(dir);

    expect(result.mxlPaths).toHaveLength(2);
    expect(result.omrPaths).toHaveLength(1);
    expect(result.multipleOutputs).toBe(true);
    expect(result.primaryMxl.endsWith(".mxl")).toBe(true);
  });

  it("throws when Audiveris produced no MXL files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audiveris-empty-"));
    await expect(collectAudiverisOutputs(dir)).rejects.toThrow(/No MXL outputs/);
  });
});
