import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { PrimeAgentTransport } from "../src/transport.js";
import type { MessageClass } from "../src/types.js";

interface FakeChild extends EventEmitter {
  stdin: { end: (input: string) => void };
  stderr: EventEmitter;
}

function createChild(onStdinEnd?: (input: string) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = {
    end: (input: string) => {
      onStdinEnd?.(input);
    },
  };
  child.stderr = new EventEmitter();
  return child;
}

describe("PrimeAgentTransport", () => {
  it("sends interrupt wakes with --steer and resolves success on zero exit", async () => {
    const spawned: { command?: string; args?: string[]; stdin?: string } = {};
    const child = createChild((input) => {
      spawned.stdin = input;
      queueMicrotask(() => child.emit("close", 0));
    });

    const transport = new PrimeAgentTransport(((command, args) => {
      spawned.command = command;
      spawned.args = args;
      return child as never;
    }) as never);

    await expect(transport.pushWake("worker", "interrupt", "mail:1:interrupt:orch")).resolves.toEqual({ success: true });
    expect(spawned.command).toBe("prime-agent");
    expect(spawned.args).toEqual(["send", "--steer"]);
    expect(spawned.stdin).toBe("mail:1:interrupt:orch\n");
  });

  it("sends when_ready wakes with --follow-up and reports stderr on failure", async () => {
    const child = createChild(() => {
      child.stderr.emit("data", "boom");
      queueMicrotask(() => child.emit("close", 2));
    });

    const transport = new PrimeAgentTransport((() => child) as never);
    await expect(transport.pushWake("worker", "when_ready", "mail:2:when_ready:lead")).resolves.toEqual({
      success: false,
      error: "prime-agent exited with code 2: boom",
    });
  });

  it("returns spawn errors", async () => {
    const transport = new PrimeAgentTransport((() => {
      throw new Error("not installed");
    }) as never);

    await expect(transport.pushWake("worker", "interrupt" satisfies MessageClass, "mail")).resolves.toEqual({
      success: false,
      error: "not installed",
    });
  });
});
