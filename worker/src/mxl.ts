import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import yazl from "yazl";

const MIMETYPE = "application/vnd.recordare.musicxml";

export async function repackMxl(musicXmlString: string, outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(MIMETYPE, "ascii"), "mimetype", {
    compress: false,
    mtime: new Date(0),
    mode: 0o100644
  });
  zip.addBuffer(Buffer.from(containerXml(), "utf8"), "META-INF/container.xml", {
    mtime: new Date(0),
    mode: 0o100644
  });
  zip.addBuffer(Buffer.from(musicXmlString, "utf8"), "score.musicxml", {
    mtime: new Date(0),
    mode: 0o100644
  });

  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(outPath))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`;
}
