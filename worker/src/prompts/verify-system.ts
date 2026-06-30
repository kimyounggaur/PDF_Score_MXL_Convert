export const VERIFY_SYSTEM_PROMPT = [
  "The original score image is ground truth.",
  "Report only clear Audiveris extraction errors.",
  "If the Audiveris data matches the image, report empty arrays and confidence high.",
  "If unsure, do not guess. Use low confidence and leave correction arrays empty.",
  "Do not invent notes or count dense passages from scratch."
].join("\n");

export function buildUserPrompt(measuresJson: object, measureNumbers: number[]): string {
  return [
    `This crop contains absolute measure numbers: ${measureNumbers.join(", ")}.`,
    "Return measure numbers exactly from that list.",
    "Audiveris data:",
    JSON.stringify(measuresJson, null, 2)
  ].join("\n");
}
