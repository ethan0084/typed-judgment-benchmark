#!/usr/bin/env node
/**
 * Scores a completed run. Gold labels are read HERE and only here, after the
 * run's terminal results are already on disk.
 *
 * Usage: node scripts/score-run.mjs <run_id>
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: node scripts/score-run.mjs <run_id>");
  console.error("Available runs:");
  for (const entry of await readdir("runs", { withFileTypes: true })) {
    if (entry.isDirectory()) console.error(`  ${entry.name}`);
  }
  process.exit(1);
}

const dir = path.join("runs", runId);
const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));

if (manifest.mode === "demo") {
  console.error(
    "\nREFUSED: this is a SIMULATED demo run. Scoring it would produce meaningless\n" +
      "accuracy numbers that must never be presented as benchmark results.\n",
  );
  process.exit(2);
}

const { loadGold } = await import("../src/server/scorer/gold-loader.ts");
const { scoreProvider } = await import("../src/server/scorer/score.ts");

const { byCaseId } = await loadGold();

const summary = { run_id: runId, mode: manifest.mode, scored_at: new Date().toISOString(), providers: {} };

for (const provider of ["jev", "deepseek"]) {
  const file = path.join(dir, `results.${provider}.jsonl`);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    continue;
  }
  const results = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const score = scoreProvider(results, byCaseId, manifest.execution.total_cases);
  summary.providers[provider] = score;

  console.log(`\n=== ${provider} (${manifest.execution.total_cases} cases) ===`);
  console.log(`  succeeded   ${score.succeeded}   failed ${score.failed}   unknown ${score.unknown}`);
  console.log(`  accuracy                    ${(score.accuracy * 100).toFixed(2)}%  (${score.correct}/${score.scored})`);
  console.log(`  coverage-adjusted accuracy  ${(score.coverage_adjusted_accuracy * 100).toFixed(2)}%`);
  console.log(`  latency avg ${score.latency.avg_ms.toFixed(0)}ms  P50 ${score.latency.p50_ms.toFixed(0)}ms  P95 ${score.latency.p95_ms.toFixed(0)}ms`);
  console.log(`  cost        $${score.total_cost.toFixed(4)}`);
  console.log("  per-route precision / recall:");
  for (const r of score.per_route) {
    console.log(`    ${r.route.padEnd(26)} P ${(r.precision * 100).toFixed(1).padStart(5)}%  R ${(r.recall * 100).toFixed(1).padStart(5)}%  support ${r.support}`);
  }
}

await writeFile(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nWrote ${path.join(dir, "summary.json")}`);
