import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repackMxl } from "./mxl";
import { mapPagesToMeasures, parseMusicXml, unzipMxl } from "./musicxml";

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="2"><print new-page="yes"/><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
  </part>
</score-partwise>`;

describe("musicxml parsing", () => {
  it("unpacks MXL rootfile and maps measures to pages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "musicxml-test-"));
    const mxl = join(dir, "score.mxl");
    await repackMxl(SCORE, mxl);
    const xmlPath = await unzipMxl(mxl, join(dir, "unzipped"));
    const score = await parseMusicXml(xmlPath);
    const pages = mapPagesToMeasures(score, 2);

    expect(score.scoreType).toBe("partwise");
    expect(score.parts[0]?.measures).toHaveLength(2);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.measures.map((m) => m.measureNumber)).toContain("1");
    expect(pages[1]?.measures.map((m) => m.measureNumber)).toContain("2");
  });
});
