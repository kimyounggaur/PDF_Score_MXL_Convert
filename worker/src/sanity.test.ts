import { describe, expect, it } from "vitest";
import { musicalSanity } from "./sanity";

const BEFORE = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
const BAD_DURATION = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note></measure></part></score-partwise>`;

describe("musical sanity", () => {
  it("rejects changed measure duration sums", () => {
    const report = musicalSanity(BEFORE, BAD_DURATION);
    expect(report.ok).toBe(false);
    expect(report.checks.some((check) => check.name === "measure-duration-sums" && !check.ok)).toBe(true);
  });
});
