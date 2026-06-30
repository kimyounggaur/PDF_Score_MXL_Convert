export type JobStatus = "queued" | "processing" | "done" | "failed";

export type Stage =
  | "detect"
  | "preprocess"
  | "audiveris"
  | "render"
  | "crop"
  | "vision"
  | "apply"
  | "validate"
  | "repack"
  | "eval";

export type PdfKind = "vector" | "raster" | "mixed" | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface Correction {
  missing_chords: Array<{ measure: number; beat?: number; chord: string }>;
  missing_lyrics: Array<{ measure: number; syllable_index?: number; text: string }>;
  wrong_notes: Array<{
    measure: number;
    voice?: number;
    staff?: number;
    expected_pitch: string;
    got_pitch: string;
  }>;
  extra_or_missing_notes: Array<{ measure: number; kind: "extra" | "missing"; pitch?: string }>;
  confidence: Confidence;
  notes?: string;
}

export interface PageVerifyResult {
  page: number;
  missing_chords: Array<{ measure: number; partId: string; chord: string; beat?: number }>;
  missing_lyrics: Array<{
    measure: number;
    partId: string;
    noteIndex: number;
    text: string;
    syllabic?: "single" | "begin" | "middle" | "end";
  }>;
  wrong_notes: Array<{
    measure: number;
    partId: string;
    noteIndex: number;
    expected: string;
    got: string;
  }>;
  confidence: Confidence;
}

export interface DiffReport {
  job_id?: string;
  final_mode?: "REPORT" | "AUTO_PATCH" | "AUTO_PATCH_DOWNGRADED";
  warnings: string[];
  pages: Array<{
    page: number;
    systems?: Array<{ system: number | string; measures: number[] }>;
    applied: Array<Record<string, unknown>>;
    unapplied: Array<Record<string, unknown>>;
  }>;
  summary: {
    chords_added: number;
    lyrics_added: number;
    notes_fixed: number;
    skipped: number;
  };
  stopReason?: string;
  perSystemConfidence?: Array<{ systemId: string; confidence: Confidence }>;
}

export interface JobResponse {
  id: string;
  status: JobStatus;
  stage: Stage | null;
  pdfKind: PdfKind;
  pageCount: number | null;
  report: DiffReport | null;
  downloadUrl: string | null;
  error: string | null;
  costUsd: number;
  accuracyScore: number | null;
  needsHumanCount: number | null;
  refineIterations: number | null;
  terminationReason: string | null;
}
