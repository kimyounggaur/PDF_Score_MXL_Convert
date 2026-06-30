import { readdir, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export interface EvalCaseResult {
  caseId: string;
  crashed: boolean;
  mv2h: { multiPitch: number; voice: number; meter: number; value: number; harmony: number; overall: number };
  tedn: number;
  accuracyScore: number;
  pdfKind: "vector" | "raster" | "unknown";
}

function emptyResult(caseId: string): EvalCaseResult {
  return {
    caseId,
    crashed: false,
    mv2h: { multiPitch: 0, voice: 0, meter: 0, value: 0, harmony: 0, overall: 0 },
    tedn: 0,
    accuracyScore: 0,
    pdfKind: "unknown"
  };
}

export async function evalCase(caseDir: string): Promise<EvalCaseResult> {
  const caseId = path.basename(caseDir);
  try {
    await stat(path.join(caseDir, "input.pdf"));
    await stat(path.join(caseDir, "ground_truth.musicxml"));
    return emptyResult(caseId);
  } catch {
    return { ...emptyResult(caseId), crashed: true };
  }
}

export async function runRegression(): Promise<EvalCaseResult[]> {
  const datasetDir = process.env.EVAL_DATASET_DIR ?? path.join(process.cwd(), "eval", "dataset");
  const entries = await readdir(datasetDir, { withFileTypes: true }).catch(() => []);
  const results = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => evalCase(path.join(datasetDir, entry.name))));
  const baselinePath = path.join(process.cwd(), "eval", "baseline.json");
  const baseline = await readFile(baselinePath, "utf8").then((text) => JSON.parse(text) as EvalCaseResult[]).catch(() => []);
  const baselineByCase = new Map(baseline.map((item) => [item.caseId, item]));
  for (const result of results) {
    const before = baselineByCase.get(result.caseId);
    if (before && result.accuracyScore < before.accuracyScore) {
      console.warn(`[eval] regression ${result.caseId}: ${before.accuracyScore} -> ${result.accuracyScore}`);
    }
  }
  await writeFile(baselinePath, `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

if (process.argv.includes("--all")) {
  const results = await runRegression();
  console.log(JSON.stringify(results, null, 2));
}
