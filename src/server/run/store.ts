import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { ProviderId, TerminalResult } from "@/lib/types";

/**
 * Append-only run storage.
 *
 * Each provider gets its own JSONL file. A line is written and fsync'd before
 * the result is announced, so a crash can never leave a half-written terminal
 * record that resume would misread. Runs are never overwritten: creating a run
 * whose directory already exists is an error.
 */

/** Resolved lazily so the working directory is read at call time, not at import. */
export function runsDir(): string {
  return path.join(process.cwd(), "runs");
}

export function runDir(runId: string): string {
  return path.join(runsDir(), runId);
}

export function resultsPath(runId: string, provider: ProviderId): string {
  return path.join(runDir(runId), `results.${provider}.jsonl`);
}

export function manifestPath(runId: string): string {
  return path.join(runDir(runId), "manifest.json");
}

/** Writes via temp file + atomic rename so a partial manifest is impossible. */
export async function writeAtomic(target: string, contents: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}

export class ResultWriter {
  readonly #path: string;

  constructor(runId: string, provider: ProviderId) {
    this.#path = resultsPath(runId, provider);
  }

  /** Appends one terminal record and fsyncs before returning. */
  async append(result: TerminalResult): Promise<void> {
    await mkdir(path.dirname(this.#path), { recursive: true });
    const handle = await open(this.#path, "a");
    try {
      await handle.write(`${JSON.stringify(result)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/**
 * Reads completed results for resume. A trailing partial line (possible if the
 * process died mid-write despite fsync ordering) is discarded, not guessed at.
 */
export async function readResults(
  runId: string,
  provider: ProviderId,
): Promise<{ results: TerminalResult[]; discardedPartialLine: boolean }> {
  const file = resultsPath(runId, provider);
  const results: TerminalResult[] = [];
  let discardedPartialLine = false;

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { results, discardedPartialLine };
    }
    throw error;
  }

  const lines = raw.split("\n");
  const last = lines.pop();
  if (last && last.trim().length > 0) {
    discardedPartialLine = true;
  }

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    results.push(JSON.parse(line) as TerminalResult);
  }

  return { results, discardedPartialLine };
}

/** Streams results without holding the whole file in memory. */
export async function* streamResults(
  runId: string,
  provider: ProviderId,
): AsyncGenerator<TerminalResult> {
  const reader = createInterface({
    input: createReadStream(resultsPath(runId, provider), "utf8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of reader) {
    if (line.trim().length === 0) continue;
    yield JSON.parse(line) as TerminalResult;
  }
}
