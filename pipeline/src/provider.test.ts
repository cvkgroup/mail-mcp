/**
 * Reading sessions for attribution, without a network or a key.
 *
 * The fetching half is one call to a documented endpoint. The reading half is where the mistakes
 * live: a directory naming convention, a role filter, and a file that may be cut off mid-line
 * because the worker was killed. Those are what these tests hold still.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readResponses, summarise, toTsv, type Served } from "./provider.js";

let dir: string;

/** One session file, in the layout the engine writes. */
function session(station: string, run: string, name: string, lines: unknown[]): void {
  const d = join(dir, station, run);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
}

function assistant(responseId: string, timestamp: number, over: Record<string, unknown> = {}) {
  return {
    type: "message",
    message: {
      role: "assistant",
      responseId,
      model: "deepseek/deepseek-v4-flash-0731",
      stopReason: "stop",
      timestamp,
      usage: { input: 100, output: 20, cost: { total: 0.0004 } },
      ...over,
    },
  };
}

function served(over: Partial<Served> = {}): Served {
  return {
    node: "112", station: "red", attempt: "1", responseId: "gen-1", model: "m",
    stopReason: "stop", timestamp: 1, inputTokens: 100, outputTokens: 20, cost: 0.0004,
    provider: "Baidu", latencyMs: 900, generationMs: 1500, attemptsUpstream: 1,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sessions-"));
});

describe("reading a run's sessions", () => {
  it("takes the node and attempt from the directory, not from a timestamp", () => {
    session("red", "112-2", "s", [assistant("gen-a", 10)]);
    const [r] = readResponses(dir);
    expect(r).toMatchObject({ node: "112", station: "red", attempt: "2", responseId: "gen-a" });
  });

  // A worker writes one session, so one directory normally holds one file. The report reads
  // whatever is there rather than assuming that, because attribution is worth nothing if it
  // quietly drops the odd case, and a killed run leaves sessions that ended `aborted`.
  it("reads every session in an attempt's directory, however many there are", () => {
    session("red", "112-1", "first", [assistant("gen-aborted", 10, { stopReason: "aborted" })]);
    session("red", "112-1", "second", [assistant("gen-ok", 20)]);
    const rows = readResponses(dir);
    expect(rows.map((r) => r.responseId)).toEqual(["gen-aborted", "gen-ok"]);
    expect(rows[0]!.stopReason).toBe("aborted");
  });

  it("orders responses by when they happened, across nodes", () => {
    session("red", "112-1", "s", [assistant("gen-late", 99)]);
    session("red", "134-1", "s", [assistant("gen-early", 1)]);
    expect(readResponses(dir).map((r) => r.responseId)).toEqual(["gen-early", "gen-late"]);
  });

  it("ignores everything that is not an answer from the model", () => {
    session("red", "112-1", "s", [
      { type: "session", version: 3, id: "x" },
      { type: "message", message: { role: "user", content: "go" } },
      { type: "message", message: { role: "toolResult", toolName: "bash", isError: false } },
      assistant("gen-a", 10),
    ]);
    expect(readResponses(dir)).toHaveLength(1);
  });

  it("reads a session that was cut off mid-line, which is how a killed worker leaves one", () => {
    const d = join(dir, "red", "112-1");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "s.jsonl"), `${JSON.stringify(assistant("gen-a", 10))}\n{"type":"mess`);
    expect(readResponses(dir).map((r) => r.responseId)).toEqual(["gen-a"]);
  });

  it("returns nothing when the run kept no sessions at all", () => {
    expect(readResponses(join(dir, "absent"))).toEqual([]);
  });
});

describe("reporting", () => {
  it("names an unattributed response rather than dropping it", () => {
    const tsv = toTsv([served({ provider: null, latencyMs: null })]);
    expect(tsv.split("\n")[1]).toContain("unknown");
  });

  it("counts responses and fallbacks per upstream", () => {
    const out = summarise([
      served({ provider: "Baidu", latencyMs: 100 }),
      served({ provider: "Baidu", latencyMs: 300 }),
      served({ provider: "Together", latencyMs: 5000, attemptsUpstream: 2 }),
    ]);
    expect(out).toContain("Baidu\t2\t300\t300\t0");
    expect(out).toContain("Together\t1\t5000\t5000\t1");
  });
});
