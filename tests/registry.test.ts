import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { SeatRegistry } from "../src/registry.js";

const baseDir = path.join(process.cwd(), "test-workdir", "registry");

describe("SeatRegistry", () => {
  beforeEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
    await mkdir(baseDir, { recursive: true });
  });

  it("persists registered seats and reloads them", async () => {
    const registry = new SeatRegistry(baseDir);
    await registry.load();

    await registry.register({ id: "lead", role: "lead", lane: "hq" });
    await registry.register({ id: "worker", role: "worker", lane: "lane-a", escalation_target: "lead" });

    const reloaded = new SeatRegistry(baseDir);
    await reloaded.load();

    expect(reloaded.get("lead")).toMatchObject({ role: "lead", lane: "hq" });
    expect(reloaded.get("worker")).toMatchObject({ escalation_target: "lead" });
    expect(reloaded.list()).toHaveLength(2);
  });

  it("throws on unknown required seat", async () => {
    const registry = new SeatRegistry(baseDir);
    await registry.load();

    expect(() => registry.getRequired("missing")).toThrow(/Unregistered caller or seat/);
  });
});
