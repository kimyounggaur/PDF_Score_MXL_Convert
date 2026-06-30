import { describe, expect, it } from "vitest";
import { applyCorrections } from "./apply";

const XML = `<score-partwise><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;

describe("apply corrections", () => {
  it("keeps XML unchanged in REPORT mode", () => {
    const result = applyCorrections(XML, [{
      page: 1,
      missing_chords: [{ measure: 1, partId: "P1", chord: "Cmaj7" }],
      missing_lyrics: [],
      wrong_notes: [],
      confidence: "high"
    }], "REPORT");

    expect(result.musicXml).toBe(XML);
    expect(result.items[0]?.applied).toBe(false);
  });

  it("patches a simple pitch in AUTO_PATCH mode", () => {
    const result = applyCorrections(XML, [{
      page: 1,
      missing_chords: [],
      missing_lyrics: [],
      wrong_notes: [{ measure: 1, partId: "P1", noteIndex: 0, expected: "D#5", got: "C4" }],
      confidence: "high"
    }], "AUTO_PATCH");

    expect(result.musicXml).toContain("<step>D</step>");
    expect(result.musicXml).toContain("<alter>1</alter>");
    expect(result.musicXml).toContain("<octave>5</octave>");
  });
});
