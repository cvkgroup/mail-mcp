import { describe, expect, it } from "vitest";

import { assertCanSend } from "../src/acl.js";
import type { Seat } from "../src/types.js";

const lead: Seat = { id: "lead", role: "lead", lane: "all" };
const architect: Seat = { id: "architect", role: "architect", lane: "all" };
const orchestratorA: Seat = { id: "orch-a", role: "orchestrator", lane: "lane-a" };
const orchestratorB: Seat = { id: "orch-b", role: "orchestrator", lane: "lane-b" };
const workerA: Seat = { id: "worker-a", role: "worker", lane: "lane-a" };
const workerB: Seat = { id: "worker-b", role: "worker", lane: "lane-b" };

describe("assertCanSend", () => {
  it("allows lead and architect to send anything", () => {
    expect(() => assertCanSend(lead, workerA, "interrupt")).not.toThrow();
    expect(() => assertCanSend(architect, orchestratorB, "when_ready")).not.toThrow();
  });

  it("limits worker traffic to its own orchestrator and when_ready", () => {
    expect(() => assertCanSend(workerA, orchestratorA, "when_ready")).not.toThrow();
    expect(() => assertCanSend(workerA, orchestratorA, "interrupt")).toThrow(/Workers may only send when_ready/);
    expect(() => assertCanSend(workerA, orchestratorB, "when_ready")).toThrow(/own orchestrator/);
  });

  it("limits orchestrator interrupts to its own workers", () => {
    expect(() => assertCanSend(orchestratorA, workerA, "interrupt")).not.toThrow();
    expect(() => assertCanSend(orchestratorA, workerB, "interrupt")).toThrow(/own lane/);
    expect(() => assertCanSend(orchestratorA, lead, "interrupt")).toThrow(/own lane/);
    expect(() => assertCanSend(orchestratorA, lead, "when_ready")).not.toThrow();
  });
});
