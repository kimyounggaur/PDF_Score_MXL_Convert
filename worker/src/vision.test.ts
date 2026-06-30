import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EMPTY_CORRECTION, parseClaudeCorrection, verifyAllSystems } from "./vision";

describe("vision correction parsing", () => {
  it("prefers strict tool_use input", () => {
    const correction = {
      missing_chords: [{ measure: 3, chord: "Cmaj7" }],
      missing_lyrics: [],
      wrong_notes: [],
      extra_or_missing_notes: [],
      confidence: "high"
    };
    const parsed = parseClaudeCorrection({ content: [{ type: "tool_use", input: correction }] });
    expect(parsed.correction).toEqual(correction);
    expect(parsed.raw).toBeNull();
  });

  it("falls back to fenced JSON text when tool_use is absent", () => {
    const parsed = parseClaudeCorrection({
      content: [{ type: "text", text: "```json\n{\"missing_chords\":[],\"missing_lyrics\":[],\"wrong_notes\":[],\"extra_or_missing_notes\":[],\"confidence\":\"medium\"}\n```" }]
    });
    expect(parsed.correction.confidence).toBe("medium");
  });

  it("escalates low confidence systems and respects the cost limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vision-test-"));
    const image = join(dir, "system.png");
    await writeFile(image, "fake");
    const calls: string[] = [];
    const client = {
      async createMessage(input: { model: string }) {
        calls.push(input.model);
        return {
          content: [{
            type: "tool_use",
            input: { ...EMPTY_CORRECTION, confidence: input.model.includes("opus") ? "high" : "low" }
          }],
          usage: { input_tokens: 100, output_tokens: 10 }
        };
      }
    };

    const result = await verifyAllSystems(
      [{ id: "p1-s1", imagePath: image, measuresJson: {}, measureNumbers: [1] }],
      { jobCostLimitUsd: 1, wrongNotesEscalateThreshold: 1 },
      client
    );

    expect(calls).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
    expect(result.results[0]?.escalated).toBe(true);
  });
});
