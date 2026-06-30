import type { Correction, PageVerifyResult } from "@/shared/types";
import type { ParsedScore } from "./musicxml";

export interface Coords {
  systems: Array<{
    systemId: string;
    page: number;
    measureRange: Array<{ partId: string; from: string; to: string }>;
  }>;
}

export function toPageVerifyResults(
  systemResults: { systemId: string; correction: Correction }[],
  coords: Coords,
  _score: ParsedScore
): PageVerifyResult[] {
  return systemResults.map(({ systemId, correction }) => {
    const system = coords.systems.find((item) => item.systemId === systemId);
    const range = system?.measureRange[0];
    const partId = range?.partId ?? "P1";
    const from = Number(range?.from ?? 1);
    const to = Number(range?.to ?? Number.MAX_SAFE_INTEGER);
    const inRange = (measure: number) => measure >= from && measure <= to;
    return {
      page: system?.page ?? 1,
      missing_chords: correction.missing_chords
        .filter((item) => inRange(item.measure))
        .map((item) => ({ ...item, partId })),
      missing_lyrics: correction.missing_lyrics
        .filter((item) => inRange(item.measure))
        .map((item) => ({
          measure: item.measure,
          partId,
          noteIndex: item.syllable_index ?? 0,
          text: item.text,
          syllabic: "single" as const
        })),
      wrong_notes: correction.wrong_notes
        .filter((item) => inRange(item.measure))
        .map((item) => ({
          measure: item.measure,
          partId,
          noteIndex: 0,
          expected: item.expected_pitch,
          got: item.got_pitch
        })),
      confidence: correction.confidence
    };
  });
}
