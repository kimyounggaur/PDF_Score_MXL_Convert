import type { PageVerifyResult } from "@/shared/types";
import { applyCorrections } from "./apply";
import { repackMxl } from "./mxl";
import { musicalSanity } from "./sanity";
import { scoreState, type QualityScore } from "./score";
import type { ValidationResult } from "./validate";

export interface RefineConfig {
  maxIterations: number;
  convergeThreshold: number;
}

export interface RefineResult {
  finalXml: string;
  finalMxlPath: string;
  passes: { pass: number; adopted: number; score: QualityScore }[];
  stopReason: "converged" | "max_iterations" | "oscillation" | "validation_failed" | "no_improvement" | "cost_limit";
  needsHumanMeasures: string[];
}

export async function refine(
  originalXml: string,
  pages: PageVerifyResult[],
  cfg: RefineConfig,
  deps: {
    finalMxlPath: string;
    validateXml: (xml: string) => Promise<ValidationResult>;
    verifyPages?: (pass: number, pages: PageVerifyResult[]) => Promise<PageVerifyResult[]>;
  }
): Promise<RefineResult> {
  let bestXml = originalXml;
  let bestScore: QualityScore = { accuracy_score: 0, needs_human: 0, xsd_ok: true, sanity_ok: true };
  const passes: RefineResult["passes"] = [];
  let stopReason: RefineResult["stopReason"] = "max_iterations";

  for (let pass = 1; pass <= cfg.maxIterations; pass += 1) {
    const results = deps.verifyPages ? await deps.verifyPages(pass, pages) : pages;
    const applied = applyCorrections(bestXml, results, "AUTO_PATCH");
    const sanity = musicalSanity(bestXml, applied.musicXml);
    const validation = await deps.validateXml(applied.musicXml);
    const newScore = scoreState(applied.musicXml, results, validation, sanity);
    const adopted = applied.items.filter((item) => item.applied).length;

    if (!validation.ok || !sanity.ok) {
      stopReason = "validation_failed";
      break;
    }
    if (newScore.accuracy_score < bestScore.accuracy_score) {
      stopReason = "no_improvement";
      break;
    }
    bestXml = applied.musicXml;
    bestScore = newScore;
    passes.push({ pass, adopted, score: newScore });

    if (adopted <= cfg.convergeThreshold) {
      stopReason = "converged";
      break;
    }
  }

  await repackMxl(bestXml, deps.finalMxlPath);
  return { finalXml: bestXml, finalMxlPath: deps.finalMxlPath, passes, stopReason, needsHumanMeasures: [] };
}
