import type { PageVerifyResult } from "@/shared/types";
import type { SanityReport } from "./sanity";
import type { ValidationResult } from "./validate";

export interface QualityScore {
  accuracy_score: number;
  needs_human: number;
  xsd_ok: boolean;
  sanity_ok: boolean;
}

export function scoreState(
  _xml: string,
  results: PageVerifyResult[],
  validation: ValidationResult,
  sanity: SanityReport
): QualityScore {
  if (!validation.ok || !sanity.ok) {
    return { accuracy_score: 0, needs_human: results.length, xsd_ok: validation.ok, sanity_ok: sanity.ok };
  }

  let adopted = 0;
  let unresolved = 0;
  for (const result of results) {
    const weight = result.confidence === "high" ? 2 : result.confidence === "medium" ? 1 : 0.25;
    adopted += (result.missing_chords.length + result.missing_lyrics.length + result.wrong_notes.length) * weight;
    if (result.confidence === "low") {
      unresolved += 1;
    }
  }
  const denominator = adopted + unresolved + 0.0001;
  return {
    accuracy_score: adopted / denominator,
    needs_human: unresolved,
    xsd_ok: validation.ok,
    sanity_ok: sanity.ok
  };
}
