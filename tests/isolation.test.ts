import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural isolation guarantees. These assert the boundary in the source
 * tree itself, so a future edit that quietly imports gold into an adapter
 * fails CI rather than silently corrupting the benchmark.
 */

const SRC = path.join(process.cwd(), "src");

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("gold isolation", () => {
  it("only the scorer directory loads the gold workbook", async () => {
    // The run controller may load gold for post-run scoring ONLY. That path is
    // guarded separately by the two tests below: it must be a lazy import
    // inside the scoring method, never a top-level import, and it must be
    // reachable only after the run has finished.
    const scoringAllowed = path.join("src", "server", "run", "controller.ts");
    const files = await filesUnder(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(process.cwd(), file);
      if (rel.startsWith(path.join("src", "server", "scorer"))) continue;
      if (rel === scoringAllowed) continue;
      const text = await readFile(file, "utf8");
      // data-source.ts may name the gold path/hash for the manifest, but no
      // module outside the scorer may call the loader or import it.
      if (/\bloadGold\b|from\s+["'][^"']*gold-loader/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the controller loads gold lazily, never as a top-level import", async () => {
    const text = await readFile(
      path.join(SRC, "server", "run", "controller.ts"),
      "utf8",
    );
    // A top-level import would make gold reachable during a run.
    expect(text).not.toMatch(/^import\s+.*gold-loader/m);
    expect(text).toMatch(/await import\(["'][^"']*gold-loader["']\)/);
  });

  it("the controller only scores after the run reaches a finished state", async () => {
    const text = await readFile(
      path.join(SRC, "server", "run", "controller.ts"),
      "utf8",
    );
    // Scoring is invoked from the both-providers-finished branch only.
    const call = text.indexOf("this.#scoreFinishedRun()");
    expect(call).toBeGreaterThan(-1);
    const before = text.slice(0, call);
    expect(before).toMatch(/providers\.jev\.finished && providers\.deepseek\.finished/);
    // Demo runs must be refused inside the scorer method.
    expect(text).toMatch(/mode === "demo"\) return/);
  });

  it("only the scorer parses gold rows", async () => {
    // These may name the gold file as configuration only: data-source.ts
    // declares its audited hash, the run route records that hash in the
    // immutable manifest, and a scenario config declares where gold lives so
    // the scorer can find it. None opens the workbook — the loadGold/import
    // checks above prove that, and each is re-checked for reads below.
    const allowedToName = new Set([
      path.join("src", "server", "data-source.ts"),
      path.join("src", "app", "api", "run", "route.ts"),
      path.join("src", "config", "expense-scenario.ts"),
    ]);
    const files = await filesUnder(SRC);
    for (const file of files) {
      const rel = path.relative(process.cwd(), file);
      if (rel.startsWith(path.join("src", "server", "scorer"))) continue;
      if (allowedToName.has(rel)) {
        // Naming it is allowed; reading it is not.
        const text = await readFile(file, "utf8");
        expect(text, `${rel} must not read the gold workbook`).not.toMatch(
          /readFile\([^)]*gold|XLSX\.read/,
        );
        continue;
      }
      const text = await readFile(file, "utf8");
      expect(text, `${rel} must not reference the gold workbook`).not.toContain(
        "02_gold_labels",
      );
    }
  });

  it("no provider file imports from the scorer boundary", async () => {
    const files = await filesUnder(path.join(SRC, "server", "providers"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text).not.toMatch(/from\s+["'].*scorer/);
    }
  });

  it("gold-only fields never appear in provider inputs", async () => {
    const files = await filesUnder(path.join(SRC, "server", "providers"));
    for (const file of files) {
      const text = await readFile(file, "utf8");
      // Strip comments: a comment forbidding these fields is not a leak.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const field of ["expected_route", "difficulty", "case_type", "gold_rationale"]) {
        expect(code, `${path.basename(file)} must not use ${field}`).not.toContain(field);
      }
    }
  });
});

describe("secret handling", () => {
  it("keeps process.env secret reads inside src/server/env.ts", async () => {
    const files = await filesUnder(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      if (path.relative(process.cwd(), file) === path.join("src", "server", "env.ts")) continue;
      const text = await readFile(file, "utf8");
      if (/process\.env\.\w*(API_KEY|SECRET|TOKEN)/.test(text)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
