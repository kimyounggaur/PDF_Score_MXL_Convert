import { XMLParser } from "fast-xml-parser";

export interface SanityReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parse(xml: string): any {
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(xml);
}

function score(doc: any): any {
  return doc["score-partwise"] ?? doc["score-timewise"] ?? doc;
}

function parts(doc: any): any[] {
  return asArray(score(doc).part);
}

function measureList(part: any): any[] {
  return asArray(part.measure);
}

function noteList(measure: any): any[] {
  return asArray(measure.note);
}

function noteCount(doc: any): number {
  return parts(doc).reduce(
    (sum, part) => sum + measureList(part).reduce((inner, measure) => inner + noteList(measure).length, 0),
    0
  );
}

function pitchValues(doc: any): Array<{ step: string; alter: number; octave: number }> {
  const values: Array<{ step: string; alter: number; octave: number }> = [];
  for (const part of parts(doc)) {
    for (const measure of measureList(part)) {
      for (const note of noteList(measure)) {
        if (note.pitch) {
          values.push({
            step: String(note.pitch.step),
            alter: Number(note.pitch.alter ?? 0),
            octave: Number(note.pitch.octave)
          });
        }
      }
    }
  }
  return values;
}

function durationChecks(doc: any): { ok: boolean; detail?: string } {
  for (const part of parts(doc)) {
    let divisions = 1;
    let beats = 4;
    let beatType = 4;
    for (const measure of measureList(part)) {
      if (measure.attributes?.divisions) divisions = Number(measure.attributes.divisions);
      if (measure.attributes?.time?.beats) beats = Number(measure.attributes.time.beats);
      if (measure.attributes?.time?.["beat-type"]) beatType = Number(measure.attributes.time["beat-type"]);
      const expected = divisions * beats * (4 / beatType);
      const actual = noteList(measure).reduce((sum, note) => sum + Number(note.duration ?? 0), 0);
      if (Number.isFinite(expected) && actual !== expected) {
        return { ok: false, detail: `measure ${measure.number ?? "?"}: duration ${actual} != ${expected}` };
      }
    }
  }
  return { ok: true };
}

export function musicalSanity(beforeXml: string, afterXml: string): SanityReport {
  const before = parse(beforeXml);
  const after = parse(afterXml);
  const beforeParts = parts(before);
  const afterParts = parts(after);

  const checks: SanityReport["checks"] = [];
  checks.push({
    name: "part-count-preserved",
    ok: beforeParts.length === afterParts.length,
    detail: `${beforeParts.length} -> ${afterParts.length}`
  });

  const beforeMeasures = beforeParts.map((part) => measureList(part).map((measure) => String(measure.number)));
  const afterMeasures = afterParts.map((part) => measureList(part).map((measure) => String(measure.number)));
  checks.push({
    name: "measure-counts-preserved",
    ok: JSON.stringify(beforeMeasures) === JSON.stringify(afterMeasures),
    detail: `${JSON.stringify(beforeMeasures)} -> ${JSON.stringify(afterMeasures)}`
  });

  const durations = durationChecks(after);
  checks.push({ name: "measure-duration-sums", ok: durations.ok, detail: durations.detail });

  checks.push({
    name: "note-count-preserved",
    ok: noteCount(before) === noteCount(after),
    detail: `${noteCount(before)} -> ${noteCount(after)}`
  });

  const invalidPitch = pitchValues(after).find(
    (pitch) => !/^[A-G]$/.test(pitch.step) || !Number.isInteger(pitch.octave) || pitch.alter < -2 || pitch.alter > 2
  );
  checks.push({ name: "pitch-values-valid", ok: !invalidPitch, detail: invalidPitch ? JSON.stringify(invalidPitch) : undefined });

  return { ok: checks.every((check) => check.ok), checks };
}
