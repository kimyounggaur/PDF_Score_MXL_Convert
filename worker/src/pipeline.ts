import { Worker } from "bullmq";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffReport, JobStatus, PdfKind, Stage } from "@/shared/types";
import { storageBucket } from "@/lib/server/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { detectPdfKind } from "./pdfKind";
import { preprocessForOmr } from "./preprocess";
import { runAudiveris } from "./audiveris";
import { renderPages } from "./render";
import { parseMusicXml, unzipMxl } from "./musicxml";
import { sliceSystems } from "./systems";
import { verifyAllSystems, type SystemInput } from "./vision";
import { getPersistedJobCostUsd, recordApiCost } from "./costLog";
import { toPageVerifyResults } from "./adapt";
import { applyCorrections } from "./apply";
import { musicalSanity } from "./sanity";
import { validateMusicXml } from "./validate";
import { repackMxl } from "./mxl";
import { getRedisConnection, OMR_QUEUE_NAME } from "./queue";

export interface PipelineResult {
  resultMxlPath: string;
  report: DiffReport;
  costUsd: number;
  pdfKind: PdfKind;
  pageCount: number;
  accuracyScore: number | null;
  terminationReason: "converged" | "max_iterations" | "oscillation" | "validation_failed" | "no_improvement" | "cost_limit";
}

export async function setStage(jobId: string, stage: Stage, status: JobStatus = "processing"): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("jobs").update({ status, stage }).eq("id", jobId);
}

async function updateJob(jobId: string, values: Record<string, unknown>): Promise<void> {
  await getSupabaseAdmin().from("jobs").update(values).eq("id", jobId);
}

async function downloadSource(jobId: string, jobDir: string): Promise<{ sourcePath: string; localPath: string }> {
  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase.from("jobs").select("source_path").eq("id", jobId).single();
  if (jobError) throw jobError;
  const sourcePath = String(job.source_path);
  const { data, error } = await supabase.storage.from(storageBucket()).download(sourcePath);
  if (error) throw error;
  const localPath = path.join(jobDir, "input.pdf");
  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  return { sourcePath, localPath };
}

async function uploadResult(jobId: string, mxlPath: string): Promise<string> {
  const resultPath = `results/${jobId}/score.mxl`;
  const bytes = await readFile(mxlPath);
  const { error } = await getSupabaseAdmin().storage.from(storageBucket()).upload(resultPath, bytes, {
    contentType: "application/vnd.recordare.musicxml",
    upsert: true
  });
  if (error) throw error;
  return resultPath;
}

function emptyReport(jobId: string): DiffReport {
  return {
    job_id: jobId,
    final_mode: "REPORT",
    warnings: [],
    pages: [],
    summary: { chords_added: 0, lyrics_added: 0, notes_fixed: 0, skipped: 0 }
  };
}

export async function runPipeline(jobId: string): Promise<PipelineResult> {
  const workRoot = process.env.WORK_DIR ?? path.join(process.cwd(), "work");
  const jobDir = path.join(workRoot, jobId);
  await mkdir(jobDir, { recursive: true });
  const report = emptyReport(jobId);

  try {
    await setStage(jobId, "detect", "processing");
    const { localPath } = await downloadSource(jobId, jobDir);
    const pdfKind = await detectPdfKind(localPath);
    await updateJob(jobId, { pdf_kind: pdfKind.kind, report: { ...report, warnings: pdfKind.hint ? [pdfKind.hint] : [] } });

    await setStage(jobId, "preprocess");
    const preprocess = await preprocessForOmr({ pdfPath: localPath, kind: pdfKind.kind, jobDir });
    report.warnings.push(...preprocess.qualityReport.pages.flatMap((page) => page.warnings.map((warning) => `page ${page.page}: ${warning}`)));
    await updateJob(jobId, { preprocess: preprocess.qualityReport });

    await setStage(jobId, "audiveris");
    const audiveris = await runAudiveris(localPath, jobDir);
    if (audiveris.multipleOutputs) {
      report.warnings.push(`Audiveris produced ${audiveris.mxlPaths.length} MXL files; using the first as primary.`);
    }

    await setStage(jobId, "render");
    const pages = await renderPages(localPath, jobDir, { dpi: 300, visionMaxEdge: Number(process.env.VISION_IMAGE_MAX_EDGE ?? 1568) });
    await updateJob(jobId, { page_count: pages.length });

    const parsedDir = path.join(jobDir, "parsed");
    const musicXmlPath = await unzipMxl(audiveris.primaryMxl, parsedDir);
    const originalXml = await readFile(musicXmlPath, "utf8");
    const score = await parseMusicXml(musicXmlPath);

    await setStage(jobId, "crop");
    const systemBoxes = await sliceSystems(pages, score, jobDir, { method: (process.env.SYSTEM_SLICE_MODE as "auto") ?? "auto" });

    await setStage(jobId, "vision");
    let costUsd = 0;
    const systemInputs: SystemInput[] = systemBoxes.map((box) => ({
      id: box.systemId,
      page: box.page,
      imagePath: path.join(jobDir, "systems", `system-${box.systemId}.png`),
      measuresJson: box,
      measureNumbers: box.measureRange.flatMap((range) => [Number(range.from), Number(range.to)]).filter(Number.isFinite)
    }));
    const vision =
      process.env.ANTHROPIC_API_KEY && systemInputs.length > 0
        ? await verifyAllSystems(systemInputs, {
            jobId,
            jobCostLimitUsd: Number(process.env.JOB_COST_LIMIT_USD ?? 2),
            getPersistedCostUsd: () => getPersistedJobCostUsd(jobId),
            recordCost: recordApiCost,
            wrongNotesEscalateThreshold: 2
          })
        : { results: [], totalCostUsd: 0, stoppedEarly: false };
    costUsd = vision.totalCostUsd;
    if (!process.env.ANTHROPIC_API_KEY) report.warnings.push("ANTHROPIC_API_KEY missing; skipped Claude Vision correction.");
    if (vision.stoppedEarly) {
      report.stopReason = "cost_limit";
      report.warnings.push("Claude cost limit reached; skipped remaining Vision calls and returned the latest safe result.");
    }

    await setStage(jobId, "apply");
    const pageResults = toPageVerifyResults(
      vision.results.map((result, index) => ({ systemId: systemBoxes[index]?.systemId ?? "", correction: result.correction })),
      { systems: systemBoxes.map((box) => ({ systemId: box.systemId, page: box.page, measureRange: box.measureRange })) },
      score
    );
    const applied = applyCorrections(originalXml, pageResults, process.env.APPLY_MODE === "AUTO_PATCH" ? "AUTO_PATCH" : "REPORT");

    await setStage(jobId, "validate");
    const correctedXmlPath = path.join(jobDir, "corrected", "score.musicxml");
    await mkdir(path.dirname(correctedXmlPath), { recursive: true });
    await writeFile(correctedXmlPath, applied.musicXml);
    const sanity = musicalSanity(originalXml, applied.musicXml);
    const validation = await validateMusicXml(correctedXmlPath);
    const finalXml = sanity.ok && validation.ok ? applied.musicXml : originalXml;
    if (!sanity.ok || !validation.ok) {
      report.final_mode = "AUTO_PATCH_DOWNGRADED";
      report.warnings.push("Correction failed validation; returned Audiveris baseline.");
    }

    await setStage(jobId, "repack");
    const finalMxlPath = path.join(jobDir, "corrected", "score.mxl");
    await repackMxl(finalXml, finalMxlPath);
    const resultMxlPath = await uploadResult(jobId, finalMxlPath);

    await setStage(jobId, "eval");
    const finalStatus: JobStatus = vision.stoppedEarly ? "failed" : "done";
    const result: PipelineResult = {
      resultMxlPath,
      report,
      costUsd,
      pdfKind: pdfKind.kind,
      pageCount: pages.length,
      accuracyScore: null,
      terminationReason: vision.stoppedEarly ? "cost_limit" : "converged"
    };
    await updateJob(jobId, {
      status: finalStatus,
      stage: "eval",
      result_mxl_path: resultMxlPath,
      report,
      error: vision.stoppedEarly ? "Claude cost limit reached; additional API calls were blocked." : null,
      needs_human_count: 0,
      accuracy_score: null
    });
    return result;
  } catch (error) {
    await updateJob(jobId, {
      status: "failed",
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
    });
    throw error;
  } finally {
    if (process.env.KEEP_WORK_DIR !== "true") {
      await rm(jobDir, { recursive: true, force: true });
    }
  }
}

export function startWorker(): Worker {
  return new Worker(
    OMR_QUEUE_NAME,
    async (job) => {
      await runPipeline(String(job.data.jobId));
    },
    {
      connection: getRedisConnection(),
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
      lockDuration: Number(process.env.WORKER_LOCK_DURATION_MS ?? 30 * 60 * 1000)
    }
  );
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const worker = startWorker();
  worker.on("ready", () => console.log(`[worker] listening queue=${OMR_QUEUE_NAME}`));
  worker.on("failed", (job, error) => console.error(`[worker] job=${job?.id} failed`, error));
}
