/**
 * The result store: one immutable file per attempt, created atomically, in a folder of them.
 *
 * A result records what a worker made, what the next handler should know, and a reference to the
 * input it was given. An input is a set of references to results. Those two sentences are the
 * whole design — follow `input_ref` back from any result and you have everything that led to it,
 * by one mechanism, with no special case for the previous station and none for the dependencies.
 * Nothing is copied forward and nothing grows: a node is handed references and reads what it
 * decides it needs.
 *
 * A REJECTION IS NOT A SPECIAL CASE. A failed attempt produces a result like any other, with
 * `verdict: "fail"` and `rejected_because` filled in, and the retrying worker is handed a
 * reference to it. There is no rejection text composed into the next prompt, because there is no
 * reason for the reason to travel differently from everything else.
 *
 * Immutability is enforced, not just intended: a result is written aside, made read-only, and
 * moved in, so only a whole result is ever visible and a half-written one never is. A correction
 * is a new result. This is the same discipline the product itself is required to keep, for the
 * same reason.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The two fields only the worker can write. Neither may be empty. */
export const REQUIRED_FIELDS = ["summary", "handoff"] as const;

export type Verdict = "pass" | "fail";

export interface ResultMeta {
  node: string;
  station: string;
  attempt: number;
  verdict: Verdict;
  seconds: number;
  input_ref: string[];
  evidence: string | null;
  rejected_because: string | null;
  /**
   * The worker's own transcript, as a file path relative to the run directory.
   *
   * A result says what was produced. It cannot say what the worker was thinking when it produced
   * nothing, and that is the case a later reader most needs. This is a reference like any other:
   * followed only if the reader wants it, and never copied into the result.
   *
   * One worker writes one transcript, so this names one file. It is relative because the reader is
   * already holding a file inside the run directory, and an absolute path is the one thing that
   * stops working the moment a run is archived or copied. `null` means the worker recorded nothing
   * at all, which is a finding rather than an absence.
   */
  session_ref: string | null;
}

export interface ResultObject extends ResultMeta {
  summary: string;
  handoff: string;
  /**
   * Who wrote this result. `worker` is the normal case. `engine` means the worker produced no
   * usable result and this one stands in its place, so the chain is never broken and the next
   * attempt can read what went wrong. A reader must be able to tell the two apart.
   */
  written_by: "worker" | "engine";
  [key: string]: unknown;
}

export type Taken = { ok: true; ref: string } | { ok: false; why: string };

export class ResultStore {
  readonly dir: string;
  readonly staging: string;

  constructor(base: string) {
    this.dir = join(base, "results");
    this.staging = join(base, "staging");
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.staging, { recursive: true });
  }

  ref(node: string, station: string, attempt: number): string {
    return `${node}-${station}-${attempt}.json`;
  }

  path(ref: string): string {
    return join(this.dir, ref);
  }

  /** Where a worker is told to write. Nothing here is visible to a later station. */
  staged(ref: string): string {
    return join(this.staging, ref);
  }

  has(ref: string): boolean {
    return existsSync(this.path(ref));
  }

  read(ref: string): ResultObject {
    return JSON.parse(readFileSync(this.path(ref), "utf8")) as ResultObject;
  }

  /**
   * Validate what the worker staged and move it in.
   *
   * Completion is a valid result object and never a process exiting. Workers have exited leaving
   * an empty file behind, and nine empty files were once logged as three successful waves.
   */
  take(ref: string, meta: ResultMeta): Taken {
    const src = this.staged(ref);
    if (!existsSync(src)) {
      return { ok: false, why: `No result object was written to ${src}.` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(src, "utf8"));
    } catch (e) {
      return { ok: false, why: `The result object at ${src} is not valid JSON: ${String(e)}` };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, why: `The result object at ${src} is not a JSON object.` };
    }

    const obj = parsed as Record<string, unknown>;
    const missing = REQUIRED_FIELDS.filter((f) => String(obj[f] ?? "").trim() === "");
    if (missing.length > 0) {
      return {
        ok: false,
        why:
          `The result object is missing ${missing.join(", ")}. Every result must say what was ` +
          `done (summary) and what the next handler needs to know (handoff).`,
      };
    }

    this.commit(ref, { ...obj, ...meta, written_by: "worker" } as ResultObject);
    rmSync(src, { force: true });
    return { ok: true, ref };
  }

  /**
   * Write a result in the worker's place when the worker produced none.
   *
   * Without this there would be a hole in the chain exactly where the trouble was, and the next
   * attempt would be handed a reference to its grandparent as though nothing had happened.
   */
  standIn(ref: string, meta: ResultMeta, why: string): string {
    this.commit(ref, {
      ...meta,
      summary: `The worker at station ${meta.station} produced no usable result object.`,
      handoff:
        `Attempt ${meta.attempt} produced nothing that could be accepted. The reason is in ` +
        `rejected_because. Read it before repeating the attempt.`,
      rejected_because: why.trim(),
      verdict: "fail",
      written_by: "engine",
    });
    rmSync(this.staged(ref), { force: true });
    return ref;
  }

  private commit(ref: string, obj: ResultObject): void {
    const tmp = `${this.path(ref)}.tmp`;
    rmSync(tmp, { force: true }); // a crash can leave a read-only tmp behind
    writeFileSync(tmp, `${stable(obj)}\n`);
    chmodSync(tmp, 0o444);
    renameSync(tmp, this.path(ref)); // atomic: only a whole result becomes visible
  }
}

/** Keys in a stable order, so two runs that did the same thing produce the same bytes. */
function stable(obj: unknown): string {
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }, 2);
}
