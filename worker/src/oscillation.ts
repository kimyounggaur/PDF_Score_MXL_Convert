import crypto from "node:crypto";

export function measureStateHash(measureNode: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(measureNode)).digest("hex");
}

export class OscillationTracker {
  private readonly history = new Map<string, string[]>();

  record(_pass: number, measureKey: string, hash: string): void {
    const list = this.history.get(measureKey) ?? [];
    list.push(hash);
    this.history.set(measureKey, list.slice(-5));
  }

  isOscillating(measureKey: string): boolean {
    const list = this.history.get(measureKey) ?? [];
    if (list.length < 3) return false;
    const [a, b, c] = list.slice(-3);
    return a === c && a !== b;
  }

  oscillatingMeasures(): string[] {
    return [...this.history.keys()].filter((key) => this.isOscillating(key));
  }
}
