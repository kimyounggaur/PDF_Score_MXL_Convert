import { readFile } from "node:fs/promises";
import type { Correction } from "@/shared/types";
import { calculateCost, type ApiCostLogEntry, type ClaudeUsage, type CostBreakdown } from "./cost";

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
  cost: CostBreakdown;
  usage: ClaudeUsage;
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
  page?: number;
  imagePath: string;
  measuresJson: object;
  measureNumbers: number[];
}

export interface VisionClient {
  createMessage(input: Record<string, unknown>): Promise<{ content: unknown[]; usage?: ClaudeUsage }>;
}

export interface VisionBudget {
  jobId?: string;
  jobCostLimitUsd: number;
  wrongNotesEscalateThreshold: number;
  getPersistedCostUsd?: () => Promise<number>;
  recordCost?: (entry: ApiCostLogEntry) => Promise<void>;
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

export function estimateCostUsd(model: VisionModel, usage?: ClaudeUsage): number {
  return calculateCost(model, usage).totalUsd;
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
  const cost = calculateCost(model, response.usage);
  return {
    correction: parsed.correction,
    model,
    costUsd: cost.totalUsd,
    cost,
    usage: response.usage ?? {},
    raw: parsed.raw,
    escalated: false
  };
}

export async function verifyAllSystems(
  systems: SystemInput[],
  budget: VisionBudget,
  injectedClient?: VisionClient
): Promise<{ results: VerifyResult[]; totalCostUsd: number; stoppedEarly: boolean }> {
  const results: VerifyResult[] = [];
  let totalCostUsd = 0;

  async function currentCostUsd(): Promise<number> {
    return budget.getPersistedCostUsd ? await budget.getPersistedCostUsd() : totalCostUsd;
  }

  async function recordResult(sys: SystemInput, result: VerifyResult): Promise<void> {
    totalCostUsd += result.costUsd;
    if (!budget.recordCost || !budget.jobId) return;
    await budget.recordCost({
      jobId: budget.jobId,
      pageNum: sys.page ?? null,
      systemId: sys.id,
      model: result.model,
      usage: result.usage,
      costUsd: result.costUsd,
      breakdown: result.cost
    });
  }

  for (const sys of systems) {
    if ((await currentCostUsd()) >= budget.jobCostLimitUsd) {
      return { results, totalCostUsd, stoppedEarly: true };
    }
    let result = await verifySystem(
      sys.imagePath,
      sys.measuresJson,
      { measureNumbers: sys.measureNumbers, model: "claude-sonnet-4-6" },
      injectedClient
    );
    await recordResult(sys, result);
    const wrongCount = result.correction.wrong_notes.length;
    if (
      (result.correction.confidence === "low" || wrongCount >= budget.wrongNotesEscalateThreshold) &&
      (await currentCostUsd()) < budget.jobCostLimitUsd
    ) {
      const escalated = await verifySystem(
        sys.imagePath,
        sys.measuresJson,
        { measureNumbers: sys.measureNumbers, model: "claude-opus-4-8" },
        injectedClient
      );
      await recordResult(sys, escalated);
      result = { ...escalated, escalated: true };
      console.log(`[escalate] system=${sys.id} -> opus`);
    }
    results.push(result);
  }

  return { results, totalCostUsd, stoppedEarly: false };
}
