import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunController } from "@/server/run/controller";
import { DemoAdapter } from "@/server/providers/demo-adapter";
import { loadClaims } from "@/server/input-loader";

let workdir: string;
let spy: ReturnType<typeof vi.spyOn>;
const realCwd = process.cwd();

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "abort-"));
});
afterEach(async () => {
  spy?.mockRestore();
  await rm(workdir, { recursive: true, force: true });
});

describe("run controller", () => {
  it("keeps an aborted run aborted and allows a fresh run afterwards", async () => {
    const { claims } = await loadClaims(path.join(realCwd, "data/01_finance_test_input.xlsx"));
    spy = vi.spyOn(process, "cwd").mockReturnValue(workdir);

    const controller = new RunController();
    const adapters = {
      jev: new DemoAdapter("jev", { min: 1, max: 3 }),
      deepseek: new DemoAdapter("deepseek", { min: 1, max: 3 }),
    };

    const first = controller.start({
      runId: "r1", mode: "demo", claims: claims.slice(0, 50), adapters,
    });
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await first;
    expect(controller.snapshot.status).toBe("aborted");

    await controller.start({
      runId: "r2", mode: "demo", claims: claims.slice(0, 6), adapters,
    });
    expect(controller.snapshot.providers.jev.processed).toBe(6);
    expect(controller.snapshot.status).toBe("finished");
  }, 20000);
});
