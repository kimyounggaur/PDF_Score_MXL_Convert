import { readFile } from "node:fs/promises";
import type { Correction } from "@/shared/types";

export const EMPTY_CORRECTION: Correction = {
  missing_chords: [],
  missing_lyrics: [],
  wrong_notes: [],
  extra_or_missing_notes: [],
  confidence: "high"
};

export type VisionModel = "claude-sonnet-4-6" | "claude-opus-4-8";

export interface VerifyResult {
  correction: Correction;
  model: VisionModel;
  costUsd: number;
  raw: string | null;
  escalated: boolean;
}

export interface VerifyOpts {
  measureNumbers: number[];
  model?: VisionModel;
  maxRetries?: number;
}

export interface SystemInput {
  id: string;
  imagePath: string;
  measuresJson: object;
  measureNumbers: number[];
}

export interface VisionClient {
  createMessage(input: Record<string, unknown>): Promise<{ content: unknown[]; usage?: Record<string, number> }>;
}

export const VERIFY_TOOL = {
  name: "report_corrections",
  description: "Compare original score image against Audiveris data and report only clear errors.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      missing_chords: { type: "array" },
      missing_lyrics: { type: "array" },
      wrong_notes: { type: "array" },
      extra_or_missing_notes: { type: "array" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: "string" }
    },
    required: ["missing_chords", "missing_lyrics", "wrong_notes", "extra_or_missing_notes", "confidence"]
  }
} as const;

function isCorrection(value: unknown): value is Correction {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.missing_chords) &&
    Array.isArray(record.missing_lyrics) &&
    Array.isArray(record.wrong_notes) &&
    Array.isArray(record.extra_or_missing_notes) &&
    ["high", "medium", "low"].includes(String(record.confidence))
  );
}

export function parseClaudeCorrection(response: { content: unknown[] }): { correction: Correction; raw: string | null } {
  const toolUse = response.content.find(
    (block): block is { type: "tool_use"; input: unknown } =>
      Boolean(block) && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use"
  );
  if (toolUse && isCorrection(toolUse.input)) {
    return { correction: toolUse.input, raw: null };
  }

  const raw = response.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
    )
    .map((block) => block.text)
    .join("\n");

  const jsonText = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (isCorrection(parsed)) {
      return { correction: parsed, raw };
    }
  } catch {
    // Fall through to empty correction.
  }

  return { correction: { ...EMPTY_CORRECTION, confidence: "low", notes: "Failed to parse Claude correction" }, raw };
}

export function estimateCostUsd(model: VisionModel, usage?: Record<string, number>): number {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const inputRate = model === "claude-opus-4-8" ? 5 : 3;
  const outputRate = model === "claude-opus-4-8" ? 25 : 15;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

async function defaultVisionClient(): Promise<VisionClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return {
    async createMessage(input: Record<string, unknown>) {
      return client.messages.create(input as never) as never;
    }
  };
}

export async function verifySystem(
  systemImagePath: string,
  measuresJsonForSystem: object,
  opts: VerifyOpts,
  injectedClient?: VisionClient
): Promise<VerifyResult> {
  const model = opts.model ?? "claude-sonnet-4-6";
  const imageB64 = (await readFile(systemImagePath)).toString("base64");
  const client = injectedClient ?? (await defaultVisionClient());
  const response = await client.createMessage({
    model,
    max_tokens: 4096,
    tools: [VERIFY_TOOL],
    tool_choice: { type: "tool", name: "report_corrections" },
    system: [
      {
        type: "text",
        text: "The image is ground truth. Report only clear Audiveris errors. If unsure, stay silent and lower confidence.",
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: imageB64 } },
          {
            type: "text",
            text: `Measures in this system: ${opts.measureNumbers.join(", ")}\nAudiveris JSON:\n${JSON.stringify(
              measuresJsonForSystem
            )}`
          }
        ]
      }
    ]
  });
  const parsed = parseClaudeCorrection(response);
  return {
    correction: parsed.correction,
    model,
    costUsd: estimateCostUsd(model, response.usage),
    raw: parsed.raw,
    escalated: false
  };
}

export async function verifyAllSystems(
  systems: SystemInput[],
  budget: { jobCostLimitUsd: number; wrongNotesEscalateThreshold: number },
  injectedClient?: VisionClient
): Promise<{ results: VerifyResult[]; totalCostUsd: number; stoppedEarly: boolean }> {
  const results: VerifyResult[] = [];
  let totalCostUsd = 0;

  for (const sys of systems) {
    if (totalCostUsd >= budget.jobCostLimitUsd) {
      return { results, totalCostUsd, stoppedEarly: true };
    }
    let result = await verifySystem(
      sys.imagePath,
      sys.measuresJson,
      { measureNumbers: sys.measureNumbers, model: "claude-sonnet-4-6" },
      injectedClient
    );
    totalCostUsd += result.costUsd;
    const wrongCount = result.correction.wrong_notes.length;
    if (
      (result.correction.confidence === "low" || wrongCount >= budget.wrongNotesEscalateThreshold) &&
      totalCostUsd < budget.jobCostLimitUsd
    ) {
      const escalated = await verifySystem(
        sys.imagePath,
        sys.measuresJson,
        { measureNumbers: sys.measureNumbers, model: "claude-opus-4-8" },
        injectedClient
      );
      totalCostUsd += escalated.costUsd;
      result = { ...escalated, escalated: true };
      console.log(`[escalate] system=${sys.id} -> opus`);
    }
    results.push(result);
  }

  return { results, totalCostUsd, stoppedEarly: false };
}
