/**
 * The engine, end to end, with a shell script as the worker.
 *
 * No agent is involved. The engine does not know what a worker is, so a five-line shell script
 * exercises the same paths an agent would, deterministically and in under a second. Every claim
 * about how this thing behaves should be checkable without spending a model call.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadFlow } from "./config.js";
import { loadGraph } from "./graph.js";
import { ResultStore } from "./results.js";
import { Run } from "./run.js";

const WORKER = `#!/bin/bash
mode="$1"; node="$2"; evidence="$3"; result="$4"; sessions="$5"
# Written before anything else can go wrong, because the transcript of a worker that produced
# nothing is the one a reader most needs.
mkdir -p "$sessions"
printf '{}\\n' > "$sessions/first.jsonl"
[ "$mode" = "crash" ] && { echo "could not reach the model" >&2; exit 3; }
[ "$mode" = "silent" ] && exit 0
mkdir -p "$(dirname "$evidence")"
printf '%s\\n' "$node" > "$evidence"
[ "$mode" = "no-evidence" ] && rm -f "$evidence"
printf '{"summary":"made %s","handoff":"node %s is done"}' "$node" "$node" > "$result"
exit 0
`;

let root: string;

function put(rel: string, text: string): string {
  const file = join(root, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
}

function pass(name: string, mode: string, extra: Record<string, unknown> = {}): void {
  put(
    `pipeline/passes/${name}.json`,
    JSON.stringify({
      evidence: "out/{station}/{node}.txt",
      prompt: "handle {node} at {station}, attempt {attempt}, write {result_path}\n{input}",
      runner: [
        "bash", "{root}/worker.sh", mode, "{node}", "{evidence}", "{result_path}", "{session_dir}",
      ],
      ...extra,
    }),
  );
}

async function run(flow: string, graph: string, maxAttempts = 2): Promise<Run> {
  const engine = new Run(loadFlow(flow, root), root, loadGraph(put("g.json", graph)), 4, 5);
  await engine.go(true);
  return engine;
}

function state(flow: string): Record<string, { status: string; final: string | null; attempts: Record<string, number> }> {
  return JSON.parse(readFileSync(join(root, "runs", flow, "state.json"), "utf8"));
}

function store(flow: string): ResultStore {
  return new ResultStore(join(root, "runs", flow));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "run-"));
  const worker = put("worker.sh", WORKER);
  chmodSync(worker, 0o755);
});

describe("a node moving through a flow", () => {
  beforeEach(() => {
    pass("mk", "ok");
    put(
      "pipeline/flows/two.json",
      JSON.stringify({
        start: "make",
        stations: {
          make: { pass: "mk", on_pass: "check", on_fail: { max_attempts: 2 } },
          check: { pass: "mk", on_pass: null, on_fail: { to: "make", max_attempts: 2 } },
        },
      }),
    );
  });

  it("visits every station and finishes", async () => {
    await run("two", '{"a": []}');
    expect(state("two").a!.status).toBe("finished");
    expect(state("two").a!.final).toBe("a-check-1.json");
  });

  it("hands the second station a reference to the first station's result", async () => {
    await run("two", '{"a": []}');
    const s = store("two");
    expect(s.read("a-make-1.json").input_ref).toEqual([]);
    expect(s.read("a-check-1.json").input_ref).toEqual(["a-make-1.json"]);
  });

  it("hands a node the final results of the nodes it depends on", async () => {
    await run("two", '{"a": [], "b": ["a"]}');
    expect(store("two").read("b-make-1.json").input_ref).toEqual(["a-check-1.json"]);
  });

  it("points at the worker's transcript, so a reader can follow what it was told and did", async () => {
    await run("two", '{"a": []}');
    expect(store("two").read("a-make-1.json").session_ref).toBe("sessions/make/a-1/first.jsonl");
  });

  it("does not hand a re-run the transcript of the run before it", async () => {
    await run("two", '{"a": []}');
    writeFileSync(join(root, "runs/two/sessions/make/a-1/stale.jsonl"), "{}\n");
    await run("two", '{"a": []}');
    expect(existsSync(join(root, "runs/two/sessions/make/a-1/stale.jsonl"))).toBe(false);
    expect(store("two").read("a-make-1.json").session_ref).toBe("sessions/make/a-1/first.jsonl");
  });

  it("produces evidence at every station", async () => {
    await run("two", '{"a": []}');
    expect(readFileSync(join(root, "out/make/a.txt"), "utf8").trim()).toBe("a");
    expect(readFileSync(join(root, "out/check/a.txt"), "utf8").trim()).toBe("a");
  });

  it("keeps what the worker was told, so a run can be explained afterwards", async () => {
    await run("two", '{"a": []}');
    const prompt = readFileSync(join(root, "runs/two/worker-log/make/a-1.prompt.txt"), "utf8");
    expect(prompt).toContain("handle a at make, attempt 1");
    expect(prompt).toContain("no prior results");
  });

  it("records every attempt in the log", async () => {
    await run("two", '{"a": []}');
    const log = readFileSync(join(root, "runs/two/log.tsv"), "utf8").trim().split("\n");
    expect(log[0]).toBe("node\tstation\tattempt\tverdict\tseconds\tresult");
    expect(log).toHaveLength(3);
  });
});

describe("when a worker produces nothing", () => {
  beforeEach(() => {
    pass("silent", "silent");
    put(
      "pipeline/flows/one.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "silent", on_pass: null, on_fail: { max_attempts: 2 } } },
      }),
    );
  });

  it("does not accept the process exiting as the work being done", async () => {
    await run("one", '{"a": []}');
    expect(state("one").a!.status).toBe("dead");
  });

  it("writes a result in the worker's place, so the chain has no hole in it", async () => {
    await run("one", '{"a": []}');
    const first = store("one").read("a-work-1.json");
    expect(first.written_by).toBe("engine");
    expect(first.verdict).toBe("fail");
    expect(first.rejected_because).toContain("No result object was written");
  });

  it("still points at the transcript, which is the whole reason to keep one", async () => {
    await run("one", '{"a": []}');
    const first = store("one").read("a-work-1.json");
    expect(first.written_by).toBe("engine");
    expect(first.session_ref).toBe("sessions/work/a-1/first.jsonl");
  });

  it("says how the worker's process ended, not only that nothing was written", async () => {
    await run("one", '{"a": []}');
    const why = String(store("one").read("a-work-1.json").rejected_because);
    expect(why).toContain("exited 0");
    expect(why).toContain("printed nothing at all");
  });

  it("hands the retry a reference to the rejection, not a composed complaint", async () => {
    await run("one", '{"a": []}');
    expect(store("one").read("a-work-2.json").input_ref).toEqual(["a-work-1.json"]);
    const prompt = readFileSync(join(root, "runs/one/worker-log/work/a-2.prompt.txt"), "utf8");
    expect(prompt).toContain("a-work-1.json");
    expect(prompt).toContain("rejected because");
  });

  it("stops after the attempts the station allows", async () => {
    await run("one", '{"a": []}');
    expect(state("one").a!.attempts).toEqual({ work: 2 });
    expect(existsSync(join(root, "runs/one/results/a-work-3.json"))).toBe(false);
  });

  it("blocks everything downstream rather than building on a failure", async () => {
    await run("one", '{"a": [], "b": ["a"], "c": ["b"]}');
    expect(state("one").b!.status).toBe("blocked");
    expect(state("one").c!.status).toBe("blocked");
    expect(existsSync(join(root, "runs/one/results/b-work-1.json"))).toBe(false);
  });
});

describe("when a worker dies badly", () => {
  beforeEach(() => {
    pass("crashing", "crash");
    put(
      "pipeline/flows/one.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "crashing", on_pass: null, on_fail: { max_attempts: 1 } } },
      }),
    );
  });

  it("keeps the exit code, which is what separates a crash from doing nothing", async () => {
    await run("one", '{"a": []}');
    expect(String(store("one").read("a-work-1.json").rejected_because)).toContain("exited 3");
  });

  it("keeps what the worker printed, because that is usually the actual cause", async () => {
    await run("one", '{"a": []}');
    const why = String(store("one").read("a-work-1.json").rejected_because);
    expect(why).toContain("could not reach the model");
  });

  it("still says no result was written, so the reason is not replaced by the symptom", async () => {
    await run("one", '{"a": []}');
    const why = String(store("one").read("a-work-1.json").rejected_because);
    expect(why).toContain("No result object was written");
  });
});

describe("evidence", () => {
  it("is rejected when the worker leaves none, whatever else it wrote", async () => {
    pass("hollow", "no-evidence");
    put(
      "pipeline/flows/one.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "hollow", on_pass: null, on_fail: { max_attempts: 1 } } },
      }),
    );
    await run("one", '{"a": []}');
    expect(state("one").a!.status).toBe("dead");
    expect(store("one").read("a-work-1.json").rejected_because).toContain("missing or empty");
  });
});

describe("a command evaluator", () => {
  const flow = (expect_: "pass" | "fail", cmd: string) => {
    pass("checked", "ok", { evaluator: { kind: "command", run: cmd, expect: expect_ } });
    put(
      "pipeline/flows/one.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "checked", on_pass: null, on_fail: { max_attempts: 1 } } },
      }),
    );
  };

  it("accepts a command that fails when the pass expects failure", async () => {
    flow("fail", "grep -q nothing-here '{evidence}'");
    await run("one", '{"a": []}');
    expect(state("one").a!.status).toBe("finished");
  });

  it("rejects a command that passes when the pass expects failure", async () => {
    flow("fail", "grep -q a '{evidence}'");
    await run("one", '{"a": []}');
    expect(state("one").a!.status).toBe("dead");
    expect(store("one").read("a-work-1.json").rejected_because).toContain("should have failed");
  });

  it("keeps the command's output as the reason", async () => {
    flow("pass", "echo 'the reason it went wrong' >&2; exit 3");
    await run("one", '{"a": []}');
    const why = String(store("one").read("a-work-1.json").rejected_because);
    expect(why).toContain("exit 3");
    expect(why).toContain("the reason it went wrong");
  });
});

describe("resuming", () => {
  beforeEach(() => {
    pass("mk", "ok");
    put(
      "pipeline/flows/one.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "mk", on_pass: null, on_fail: { max_attempts: 2 } } },
      }),
    );
  });

  it("does not repeat work an earlier run finished", async () => {
    await run("one", '{"a": []}');
    const engine = new Run(loadFlow("one", root), root, loadGraph(join(root, "g.json")), 4, 5);
    await engine.go(false);
    expect(state("one").a!.attempts).toEqual({ work: 1 });
  });

  it("starts over when told to", async () => {
    await run("one", '{"a": []}');
    await run("one", '{"a": []}');
    expect(state("one").a!.attempts).toEqual({ work: 1 });
    expect(existsSync(join(root, "runs/one/results/a-work-1.json"))).toBe(true);
  });
});

describe("configuration", () => {
  it("refuses a route to a station that does not exist, before running anything", () => {
    pass("mk", "ok");
    put(
      "pipeline/flows/bad.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "mk", on_pass: "codgen", on_fail: { max_attempts: 1 } } },
      }),
    );
    expect(() => loadFlow("bad", root)).toThrow(/routes on_pass to 'codgen'/);
  });

  it("refuses a prompt placeholder that nothing supplies, before running anything", () => {
    pass("mk", "ok", { prompt: "write {evidence} then {token}" });
    put(
      "pipeline/flows/bad.json",
      JSON.stringify({
        start: "work",
        stations: { work: { pass: "mk", on_pass: null, on_fail: { max_attempts: 1 } } },
      }),
    );
    expect(() => loadFlow("bad", root)).toThrow(/\{token\}/);
  });

  it("names the flows that do exist when asked for one that does not", () => {
    put("pipeline/flows/one.json", JSON.stringify({ start: "x", stations: {} }));
    expect(() => loadFlow("two", root)).toThrow(/has: one/);
  });
});
