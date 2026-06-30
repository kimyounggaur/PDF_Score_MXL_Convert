import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAudiveris } from "./audiveris";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: npm run omr -- <pdfPath>");
  process.exit(1);
}

const jobDir = await mkdtemp(path.join(tmpdir(), "pdf-score-mxl-"));
const result = await runAudiveris(path.resolve(pdfPath), jobDir);
console.log(JSON.stringify(result, null, 2));
