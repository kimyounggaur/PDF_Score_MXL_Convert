import { spawn } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface AudiverisOptions {
  sheets?: string;
  ocrLang?: string;
  constants?: Record<string, string>;
  timeoutMs?: number;
  bin?: string;
  extraArgs?: string[];
}

export interface AudiverisResult {
  mxlPaths: string[];
  primaryMxl: string;
  multipleOutputs: boolean;
  omrPaths: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  outputDir: string;
}

export interface CollectedAudiverisOutputs {
  mxlPaths: string[];
  primaryMxl: string;
  multipleOutputs: boolean;
  omrPaths: string[];
}

export function isZipSignature(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function scanByExtension(root: string, extension: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
        results.push(fullPath);
      }
    }
  }
  await visit(root);
  return results.sort((a, b) => a.localeCompare(b));
}

export async function collectAudiverisOutputs(outputDir: string): Promise<CollectedAudiverisOutputs> {
  const mxlPaths = await scanByExtension(outputDir, ".mxl");
  const omrPaths = await scanByExtension(outputDir, ".omr");
  if (mxlPaths.length === 0) {
    throw new Error(`No MXL outputs found in ${outputDir}`);
  }

  for (const mxlPath of mxlPaths) {
    const bytes = await readFile(mxlPath);
    if (!isZipSignature(bytes)) {
      throw new Error(`Audiveris output is not a zipped MXL file: ${mxlPath}`);
    }
  }

  return {
    mxlPaths,
    primaryMxl: mxlPaths[0]!,
    multipleOutputs: mxlPaths.length > 1,
    omrPaths
  };
}

function buildAudiverisArgs(inputPdfPath: string, outputDir: string, opts: AudiverisOptions): string[] {
  const args = ["-batch", "-transcribe", "-export", "-output", outputDir];
  if (opts.sheets) {
    args.push("-sheets", opts.sheets);
  }
  const ocrLang = opts.ocrLang ?? "eng";
  args.push("-constant", `org.audiveris.omr.text.Language.defaultSpecification=${ocrLang}`);
  for (const [key, value] of Object.entries(opts.constants ?? {})) {
    args.push("-constant", `${key}=${value}`);
  }
  args.push(...(opts.extraArgs ?? []), "--", inputPdfPath);
  return args;
}

export async function runAudiveris(
  inputPdfPath: string,
  jobDir: string,
  opts: AudiverisOptions = {}
): Promise<AudiverisResult> {
  const outputDir = path.join(jobDir, "audiveris-out");
  await mkdir(outputDir, { recursive: true });
  const bin = opts.bin ?? process.env.AUDIVERIS_BIN ?? "audiveris";
  const args = buildAudiverisArgs(inputPdfPath, outputDir, opts);
  const started = Date.now();

  const { exitCode, stdout, stderr } = await new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Audiveris timed out after ${opts.timeoutMs ?? 600_000}ms. Last stderr: ${stderr.slice(-200)}`));
    }, opts.timeoutMs ?? 600_000);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });

  const collected = await collectAudiverisOutputs(outputDir).catch((error) => {
    if (/No OCR is available/i.test(stderr)) {
      throw new Error(`${error.message}. Audiveris OCR unavailable: ${stderr.slice(-500)}`);
    }
    throw error;
  });

  console.log(
    `[audiveris] command="${bin} ${args.join(" ")}" exit=${exitCode} mxl=${collected.mxlPaths.length} elapsedMs=${Date.now() - started}`
  );

  return {
    ...collected,
    exitCode,
    stdout,
    stderr,
    outputDir
  };
}
