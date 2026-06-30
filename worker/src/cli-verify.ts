import { readFile } from "node:fs/promises";
import { verifySystem } from "./vision";

const [imagePath, measuresPath] = process.argv.slice(2);
if (!imagePath || !measuresPath) {
  console.error("Usage: npm run verify -- <system.png> <measures.json>");
  process.exit(1);
}

const measures = JSON.parse(await readFile(measuresPath, "utf8")) as object;
const result = await verifySystem(imagePath, measures, { measureNumbers: [1] });
console.log(JSON.stringify(result, null, 2));
