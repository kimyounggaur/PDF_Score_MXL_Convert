import { describe, expect, it } from "vitest";
import { calculateCost, normalizeUsage } from "./cost";

describe("Claude cost calculation", () => {
  it("calculates input, output, cache-write, and cache-read costs from API usage", () => {
    const cost = calculateCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000
      },
      cache_read_input_tokens: 1_000_000
    });

    expect(cost.inputUsd).toBeCloseTo(3, 8);
    expect(cost.outputUsd).toBeCloseTo(15, 8);
    expect(cost.cacheWriteUsd).toBeCloseTo(9.75, 8);
    expect(cost.cacheReadUsd).toBeCloseTo(0.3, 8);
    expect(cost.totalUsd).toBeCloseTo(28.05, 8);
    expect(cost.tokens.cacheCreationInputTokens5m).toBe(1_000_000);
    expect(cost.tokens.cacheCreationInputTokens1h).toBe(1_000_000);
  });

  it("prices legacy flat cache_creation_input_tokens as 5 minute cache writes", () => {
    const cost = calculateCost("claude-opus-4-8", {
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 20_000
    });

    expect(cost.inputUsd).toBeCloseTo(0.5, 8);
    expect(cost.outputUsd).toBeCloseTo(1.25, 8);
    expect(cost.cacheWriteUsd).toBeCloseTo(0.0625, 8);
    expect(cost.cacheReadUsd).toBeCloseTo(0.01, 8);
    expect(cost.totalUsd).toBeCloseTo(1.8225, 8);
  });

  it("normalizes missing usage fields to zero", () => {
    expect(normalizeUsage({ input_tokens: 12 })).toEqual({
      inputTokens: 12,
      outputTokens: 0,
      cacheCreationInputTokens5m: 0,
      cacheCreationInputTokens1h: 0,
      cacheReadInputTokens: 0
    });
  });
});
