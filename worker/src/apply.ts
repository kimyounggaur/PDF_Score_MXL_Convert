import type { Confidence, PageVerifyResult } from "@/shared/types";

export type ApplyMode = "REPORT" | "AUTO_PATCH";

export interface AppliedItem {
  kind: "chord" | "lyric" | "note";
  measure: number;
  partId: string;
  applied: boolean;
  reason?: string;
  before?: string;
  after?: string;
  confidence?: Confidence;
}

export interface ApplyResult {
  mode: ApplyMode;
  musicXml: string;
  items: AppliedItem[];
}

function confidenceRank(confidence: Confidence): number {
  return { low: 0, medium: 1, high: 2 }[confidence];
}

function parsePitch(pitch: string): { step: string; alter?: number; octave: number } | null {
  const match = /^([A-G])([#b]{0,2})(-?\d+)$/.exec(pitch.trim());
  if (!match) return null;
  const accidental = match[2] ?? "";
  const alter = accidental.split("").reduce((sum, char) => sum + (char === "#" ? 1 : char === "b" ? -1 : 0), 0);
  return {
    step: match[1]!,
    alter: alter === 0 ? undefined : alter,
    octave: Number(match[3])
  };
}

function pitchXml(pitch: string): string {
  const parsed = parsePitch(pitch);
  if (!parsed) {
    throw new Error(`Invalid pitch: ${pitch}`);
  }
  const alter = parsed.alter === undefined ? "" : `<alter>${parsed.alter}</alter>`;
  return `<pitch><step>${parsed.step}</step>${alter}<octave>${parsed.octave}</octave></pitch>`;
}

function simpleHarmonyXml(chord: string): string {
  const root = /^[A-G](?:#|b)?/.exec(chord)?.[0] ?? "C";
  const rootStep = root[0]!;
  const rootAlter = root.includes("#") ? "<root-alter>1</root-alter>" : root.includes("b") ? "<root-alter>-1</root-alter>" : "";
  const kind = chord.slice(root.length) || "major";
  return `<harmony><root><root-step>${rootStep}</root-step>${rootAlter}</root><kind text="${kind}">${kind}</kind></harmony>`;
}

function replaceMeasure(xml: string, partId: string, measure: number, transform: (measureXml: string) => string): string | null {
  const partPattern = new RegExp(`(<part\\s+id=["']${partId}["'][^>]*>)([\\s\\S]*?)(</part>)`);
  const partMatch = partPattern.exec(xml);
  if (!partMatch) return null;
  const measurePattern = new RegExp(`(<measure\\s+number=["']${measure}["'][^>]*>)([\\s\\S]*?)(</measure>)`);
  const measureMatch = measurePattern.exec(partMatch[2]!);
  if (!measureMatch) return null;
  const fullMeasure = `${measureMatch[1]}${measureMatch[2]}${measureMatch[3]}`;
  const newMeasure = transform(fullMeasure);
  const newPartBody = partMatch[2]!.replace(fullMeasure, newMeasure);
  return xml.replace(partMatch[0], `${partMatch[1]}${newPartBody}${partMatch[3]}`);
}

function patchNote(measureXml: string, noteIndex: number, transform: (noteXml: string) => string): string | null {
  let current = -1;
  let patched = false;
  const output = measureXml.replace(/<note\b[\s\S]*?<\/note>/g, (note) => {
    current += 1;
    if (current === noteIndex) {
      patched = true;
      return transform(note);
    }
    return note;
  });
  return patched ? output : null;
}

export function applyCorrections(
  originalXml: string,
  results: PageVerifyResult[],
  mode: ApplyMode,
  opts: { minConfidence?: Confidence; maxNotePatchesPerMeasure?: number } = {}
): ApplyResult {
  const minConfidence = opts.minConfidence ?? "medium";
  const items: AppliedItem[] = [];
  let musicXml = originalXml;

  for (const result of results) {
    if (mode === "REPORT") {
      for (const item of [...result.missing_chords, ...result.missing_lyrics, ...result.wrong_notes]) {
        items.push({
          kind: "chord" in item ? "chord" : "text" in item ? "lyric" : "note",
          measure: item.measure,
          partId: item.partId,
          applied: false,
          reason: "REPORT mode",
          confidence: result.confidence
        });
      }
      continue;
    }

    for (const chord of result.missing_chords) {
      const patched = replaceMeasure(musicXml, chord.partId, chord.measure, (measureXml) =>
        measureXml.replace(/<note\b/, `${simpleHarmonyXml(chord.chord)}<note`)
      );
      if (patched) {
        musicXml = patched;
        items.push({ kind: "chord", measure: chord.measure, partId: chord.partId, applied: true, after: chord.chord });
      } else {
        items.push({ kind: "chord", measure: chord.measure, partId: chord.partId, applied: false, reason: "measure not found" });
      }
    }

    for (const lyric of result.missing_lyrics) {
      const patched = replaceMeasure(musicXml, lyric.partId, lyric.measure, (measureXml) => {
        const next = patchNote(measureXml, lyric.noteIndex, (note) =>
          note.replace("</note>", `<lyric><syllabic>${lyric.syllabic ?? "single"}</syllabic><text>${lyric.text}</text></lyric></note>`)
        );
        return next ?? measureXml;
      });
      if (patched && patched !== musicXml) {
        musicXml = patched;
        items.push({ kind: "lyric", measure: lyric.measure, partId: lyric.partId, applied: true, after: lyric.text });
      } else {
        items.push({ kind: "lyric", measure: lyric.measure, partId: lyric.partId, applied: false, reason: "note not found" });
      }
    }

    if (confidenceRank(result.confidence) < confidenceRank(minConfidence)) {
      for (const note of result.wrong_notes) {
        items.push({
          kind: "note",
          measure: note.measure,
          partId: note.partId,
          applied: false,
          reason: "low confidence",
          confidence: result.confidence
        });
      }
      continue;
    }

    for (const note of result.wrong_notes) {
      const patched = replaceMeasure(musicXml, note.partId, note.measure, (measureXml) => {
        const next = patchNote(measureXml, note.noteIndex, (noteXml) => noteXml.replace(/<pitch>[\s\S]*?<\/pitch>/, pitchXml(note.expected)));
        return next ?? measureXml;
      });
      if (patched && patched !== musicXml) {
        musicXml = patched;
        items.push({
          kind: "note",
          measure: note.measure,
          partId: note.partId,
          applied: true,
          before: note.got,
          after: note.expected
        });
      } else {
        items.push({ kind: "note", measure: note.measure, partId: note.partId, applied: false, reason: "note not found" });
      }
    }
  }

  return { mode, musicXml, items };
}
