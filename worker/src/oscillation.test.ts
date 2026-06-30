import { describe, expect, it } from "vitest";
import { OscillationTracker } from "./oscillation";

describe("oscillation tracking", () => {
  it("detects A to B to A measure state loops", () => {
    const tracker = new OscillationTracker();
    tracker.record(1, "P1:1", "A");
    tracker.record(2, "P1:1", "B");
    tracker.record(3, "P1:1", "A");
    expect(tracker.isOscillating("P1:1")).toBe(true);
    expect(tracker.oscillatingMeasures()).toEqual(["P1:1"]);
  });
});
