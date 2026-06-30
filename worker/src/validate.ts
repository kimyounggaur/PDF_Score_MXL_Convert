import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  tool: "xmllint";
}

export async function validateMusicXml(xmlPath: string, schemaPath = path.join(process.cwd(), "worker", "xsd", "musicxml.xsd")): Promise<ValidationResult> {
  try {
    await access(schemaPath);
  } catch {
    return { ok: false, errors: [`MusicXML XSD not found: ${schemaPath}`], tool: "xmllint" };
  }

  try {
    await execFileAsync("xmllint", ["--noout", "--nonet", "--schema", schemaPath, xmlPath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, errors: [], tool: "xmllint" };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    return { ok: false, errors: stderr.split(/\r?\n/).filter(Boolean), tool: "xmllint" };
  }
}
