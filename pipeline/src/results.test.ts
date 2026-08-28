import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ResultStore, type ResultMeta } from "./results.js";

let store: ResultStore;

const meta = (over: Partial<ResultMeta> = {}): ResultMeta => ({
  node: "091",
  station: "red",
  attempt: 1,
  verdict: "pass",
  seconds: 12,
  input_ref: [],
  evidence: null,
  rejected_because: null,
  session_ref: "sessions/red/091-1/01a00b85.jsonl",
  ...over,
});

beforeEach(() => {
  store = new ResultStore(mkdtempSync(join(tmpdir(), "results-")));
});

describe("take", () => {
  it("accepts a result that says what was done and what comes next", () => {
    const ref = store.ref("091", "red", 1);
    writeFileSync(store.staged(ref), JSON.stringify({ summary: "wrote it", handoff: "imports clock" }));

    expect(store.take(ref, meta())).toEqual({ ok: true, ref });
    const saved = store.read(ref);
    expect(saved.summary).toBe("wrote it");
    expect(saved.verdict).toBe("pass");
    expect(saved.seconds).toBe(12);
    expect(saved.written_by).toBe("worker");
  });

  it("refuses when nothing was written, because exiting is not finishing", () => {
    const ref = store.ref("091", "red", 1);
    expect(store.take(ref, meta())).toEqual({
      ok: false,
      why: expect.stringContaining("No result object was written"),
    });
  });

  it("refuses an empty file, which is how nine of them once read as success", () => {
    const ref = store.ref("091", "red", 1);
    writeFileSync(store.staged(ref), "");
    const taken = store.take(ref, meta());
    expect(taken.ok).toBe(false);
  });

  it("refuses a result with an empty summary or handoff", () => {
    const ref = store.ref("091", "red", 1);
    writeFileSync(store.staged(ref), JSON.stringify({ summary: "  ", handoff: "x" }));
    expect(store.take(ref, meta())).toEqual({ ok: false, why: expect.stringContaining("summary") });
  });

  it("keeps fields the worker added that the engine knows nothing about", () => {
    const ref = store.ref("091", "red", 1);
    writeFileSync(
      store.staged(ref),
      JSON.stringify({ summary: "s", handoff: "h", read_inputs: ["a.json"] }),
    );
    store.take(ref, meta());
    expect(store.read(ref).read_inputs).toEqual(["a.json"]);
  });

  it("records the input it was given, which is what makes the chain followable", () => {
    const ref = store.ref("091", "check", 1);
    writeFileSync(store.staged(ref), JSON.stringify({ summary: "s", handoff: "h" }));
    store.take(ref, meta({ station: "check", input_ref: ["091-red-1.json"] }));
    expect(store.read(ref).input_ref).toEqual(["091-red-1.json"]);
  });

  it("clears the staging file, so a later attempt cannot inherit it", () => {
    const ref = store.ref("091", "red", 1);
    writeFileSync(store.staged(ref), JSON.stringify({ summary: "s", handoff: "h" }));
    store.take(ref, meta());
    expect(existsSync(store.staged(ref))).toBe(false);
  });

  it("makes the result read-only, because a correction is a new result", () => {
    const ref = store.ref("091", "red", 1);
    writeFileSync(store.staged(ref), JSON.stringify({ summary: "s", handoff: "h" }));
    store.take(ref, meta());
    expect(statSync(store.path(ref)).mode & 0o222).toBe(0);
  });
});

describe("standIn", () => {
  it("writes a result in the worker's place so the chain is not broken", () => {
    const ref = store.ref("091", "red", 2);
    store.standIn(ref, meta({ attempt: 2, verdict: "fail" }), "No result object was written.");

    const saved = store.read(ref);
    expect(saved.verdict).toBe("fail");
    expect(saved.rejected_because).toBe("No result object was written.");
    expect(saved.summary).not.toBe("");
    expect(saved.handoff).not.toBe("");
  });

  it("says the engine wrote it, so a reader is never misled about the author", () => {
    const ref = store.ref("091", "red", 2);
    store.standIn(ref, meta({ verdict: "fail" }), "why");
    expect(store.read(ref).written_by).toBe("engine");
  });
});
