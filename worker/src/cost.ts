import type { VisionModel } from "./vision";

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens5m: number;
  cacheCreationInputTokens1h: number;
  cacheReadInputTokens: number;
}

export interface CostBreakdown {
  model: VisionModel;
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
  tokens: NormalizedUsage;
}

export interface ApiCostLogEntry {
  jobId: string;
  pageNum: number | null;
  systemId?: string;
  model: VisionModel;
  usage: ClaudeUsage;
  costUsd: number;
  breakdown: CostBreakdown;
}

// Anthropic pricing verified against official pricing docs on 2026-06-30.
// Keep these constants easy to audit; do not confuse Opus 4.x with legacy Claude 3 Opus $15/$75 pricing.
// Source: https://docs.claude.com/en/docs/about-claude/pricing
export const PRICING: Record<
  VisionModel,
  {
    inputPerMillionUsd: number;
    outputPerMillionUsd: number;
    cacheWrite5mInputMultiplier: number;
    cacheWrite1hInputMultiplier: number;
    cacheReadInputMultiplier: number;
  }
> = {
  "claude-sonnet-4-6": {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    cacheWrite5mInputMultiplier: 1.25,
    cacheWrite1hInputMultiplier: 2,
    cacheReadInputMultiplier: 0.1
  },
  "claude-opus-4-8": {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    cacheWrite5mInputMultiplier: 1.25,
    cacheWrite1hInputMultiplier: 2,
    cacheReadInputMultiplier: 0.1
  }
};

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeUsage(usage: ClaudeUsage | undefined): NormalizedUsage {
  const cache5mFromBreakdown = nonNegativeNumber(usage?.cache_creation?.ephemeral_5m_input_tokens);
  const cache1hFromBreakdown = nonNegativeNumber(usage?.cache_creation?.ephemeral_1h_input_tokens);
  const flatCacheCreationTokens = nonNegativeNumber(usage?.cache_creation_input_tokens);

  return {
    inputTokens: nonNegativeNumber(usage?.input_tokens),
    outputTokens: nonNegativeNumber(usage?.output_tokens),
    cacheCreationInputTokens5m: cache5mFromBreakdown + (cache5mFromBreakdown || cache1hFromBreakdown ? 0 : flatCacheCreationTokens),
    cacheCreationInputTokens1h: cache1hFromBreakdown,
    cacheReadInputTokens: nonNegativeNumber(usage?.cache_read_input_tokens)
  };
}

function tokensToUsd(tokens: number, perMillionUsd: number): number {
  return (tokens / 1_000_000) * perMillionUsd;
}

export function calculateCost(model: VisionModel, usage: ClaudeUsage | undefined): CostBreakdown {
  const pricing = PRICING[model];
  const tokens = normalizeUsage(usage);
  const inputUsd = tokensToUsd(tokens.inputTokens, pricing.inputPerMillionUsd);
  const outputUsd = tokensToUsd(tokens.outputTokens, pricing.outputPerMillionUsd);
  const cacheWriteUsd =
    tokensToUsd(tokens.cacheCreationInputTokens5m, pricing.inputPerMillionUsd * pricing.cacheWrite5mInputMultiplier) +
    tokensToUsd(tokens.cacheCreationInputTokens1h, pricing.inputPerMillionUsd * pricing.cacheWrite1hInputMultiplier);
  const cacheReadUsd = tokensToUsd(tokens.cacheReadInputTokens, pricing.inputPerMillionUsd * pricing.cacheReadInputMultiplier);

  return {
    model,
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd,
    tokens
  };
}
