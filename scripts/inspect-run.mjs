#!/usr/bin/env node
/**
 * Read-only run audit and resume dry-run. Makes no API calls and writes nothing.
 *
 * Usage: node scripts/inspect-run.mjs <run_id>
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: npm run inspect -- <run_id>\nAvailable runs:");
  for (const e of await readdir("runs", { withFileTypes: true })) {
    if (e.isDirectory()) console.error(`  ${e.name}`);
  }
  process.exit(1);
}

const dir = path.join("runs", runId);
const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
const total = manifest.execution.total_cases;

console.log(`run ${runId}`);
console.log(`  mode              ${manifest.mode}`);
console.log(`  cases             ${total}`);
console.log(`  jev model         ${manifest.jev.requested_model} (retries ${manifest.jev.max_retries})`);
console.log(`  deepseek model    ${manifest.deepseek.requested_model} (retries ${manifest.deepseek.max_retries}, effort ${manifest.deepseek.reasoning_effort})`);
console.log(`  concurrency/side  ${manifest.execution.concurrency_per_provider}`);
console.log(`  policy sha256     ${manifest.sources.policy.sha256.slice(0, 16)}…`);

let problems = 0;

for (const provider of ["jev", "deepseek"]) {
  const file = path.join(dir, `results.${provider}.jsonl`);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    console.log(`\n  ${provider}: no results file yet — a resume would start at case 1.`);
    continue;
  }

  const lines = raw.split("\n");
  const trailing = lines.pop();
  const partial = Boolean(trailing && trailing.trim());
  const results = [];
  for (const line of lines) {
    if (line.trim()) results.push(JSON.parse(line));
  }

  const seen = new Set();
  const dupes = [];
  const counts = { succeeded: 0, failed: 0, unknown: 0 };
  for (const r of results) {
    if (seen.has(r.case_id)) dupes.push(r.case_id);
    seen.add(r.case_id);
    counts[r.status] += 1;
  }

  console.log(`\n  ${provider}`);
  console.log(`    records         ${results.length} (${counts.succeeded} ok, ${counts.failed} failed, ${counts.unknown} unknown)`);
  console.log(`    unique cases    ${seen.size}`);
  console.log(`    remaining       ${total - seen.size}`);
  if (partial) {
    console.log(`    ⚠ trailing partial line present; a resume discards it`);
    problems += 1;
  }
  if (dupes.length) {
    console.log(`    ✗ DUPLICATE case records: ${dupes.slice(0, 5).join(", ")}`);
    problems += 1;
  }
  if (counts.unknown) {
    console.log(`    ⚠ ${counts.unknown} unknown result(s): NOT auto-resent, decide manually`);
  }
}

console.log(
  problems === 0
    ? "\nNo integrity problems found."
    : `\n${problems} integrity problem(s) found.`,
);
