/**
 * The engine: move every node of a dependency graph through a flow of specialists.
 *
 * It knows nothing about mail, requirements or tests. It knows that nodes have an order, that
 * stations do work, that an evaluator decides whether the work was achieved, and that a result
 * travels by reference.
 *
 * WHAT IT INSISTS ON, each learned expensively:
 *
 *   - Completion is a valid result object, never a process exiting.
 *   - A node that leaves the flow unfinished BLOCKS its dependents. Building on a failure is how
 *     a bad result gets laundered into a good-looking one.
 *   - State lives on disk, so an interrupted run continues rather than repeats.
 *   - The engine composes almost nothing. The worker writes its own summary and handoff; the
 *     engine adds the verdict and the duration, because those are the two facts a worker cannot
 *     know about itself.
 */

import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { LoadedFlow, Station } from "./config.js";
import type { Graph } from "./graph.js";
import { launch, sleep, type Proc } from "./proc.js";
import { ResultStore, type ResultMeta } from "./results.js";
import { fill } from "./template.js";

export const STATUSES = [
  "waiting", "working", "evaluating", "finished", "dead", "blocked", "skipped",
] as const;
export type Status = (typeof STATUSES)[number];

interface NodeState {
  status: Status;
  /** The station the node is at, or will enter next. Null once it has left the flow. */
  station: string | null;
  attempts: Record<string, number>;
  /** References to the result objects this node has been handed. */
  input: string[];
  /** The reference this node finished on, which is what its dependents are handed. */
  final: string | null;
}

interface Active {
  phase: "work" | "eval";
  proc: Proc;
  station: Station;
  startedMs: number;
  /** Where a command evaluator's output was written. */
  evalOut?: string;
  timedOut?: boolean;
  /**
   * How the worker's own process ended, and where it wrote.
   *
   * Kept separately because `proc` is replaced by the evaluator's process at the end of the work
   * phase. Without this the worker's exit code is gone by the time anyone needs it, which is
   * exactly when the worker wrote no result and the exit code is the only thing left to read.
   */
  worker?: WorkerEnd;
}

interface WorkerEnd {
  /** Null while the worker is still running. -1 means it was signalled. */
  code: number | null;
  /** Absolute path to the file holding everything the worker printed. */
  log: string;
}

interface Judgement {
  ok: boolean;
  why: string;
}

/**
 * How often the engine looks at what it started. Three seconds is fine against workers that take
 * minutes, and it keeps the engine's own cost near zero. Tests set it low so they can run a whole
 * flow in a moment.
 */
const POLL_MS = 3000;

export class Run {
  private readonly dir: string;
  private readonly results: ResultStore;
  private readonly stateFile: string;
  private readonly logFile: string;
  private readonly state: Record<string, NodeState>;
  private readonly active = new Map<string, Active>();

  constructor(
    private readonly flow: LoadedFlow,
    private readonly root: string,
    private readonly graph: Graph,
    /**
     * How many workers may run at once. Unlimited unless someone deliberately sets it: the graph's
     * own width is the real constraint, and a number chosen without measuring is just a slower run
     * wearing the costume of a safeguard.
     */
    private readonly maxParallel: number = Infinity,
    private readonly pollMs: number = POLL_MS,
  ) {
    this.dir = join(root, "runs", flow.name);
    mkdirSync(this.dir, { recursive: true });
    this.results = new ResultStore(this.dir);
    this.stateFile = join(this.dir, "state.json");
    this.logFile = join(this.dir, "log.tsv");
    if (!existsSync(this.logFile)) {
      writeFileSync(this.logFile, "node\tstation\tattempt\tverdict\tseconds\tresult\n");
    }
    this.state = existsSync(this.stateFile)
      ? (JSON.parse(readFileSync(this.stateFile, "utf8")) as Record<string, NodeState>)
      : {};
  }

  // ------------------------------------------------------------------- state

  private st(node: string): NodeState {
    let s = this.state[node];
    if (!s) {
      s = { status: "waiting", station: this.flow.start, attempts: {}, input: [], final: null };
      this.state[node] = s;
    }
    return s;
  }

  private save(): void {
    writeFileSync(this.stateFile, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private station(name: string): Station {
    const s = this.flow.stations.get(name);
    if (!s) throw new Error(`no station '${name}' in flow '${this.flow.name}'`);
    return s;
  }

  private counts(): Record<Status, number> {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const s of Object.values(this.state)) c[s.status] += 1;
    return c;
  }

  // ------------------------------------------------------------------- input

  /**
   * What a node is told about the results it holds. References and one line each — never the
   * contents. The worker reads what it decides it needs, and each result names the input it was
   * given, so the whole tree behind it is reachable and none of it is forced on anyone.
   */
  private describeInput(node: string): string {
    const refs = this.st(node).input;
    if (refs.length === 0) {
      return "You were given no prior results. This is the first station for this node.";
    }
    const lines = [
      `You were handed ${refs.length} result object(s), as files in ${this.results.dir}. ` +
        `Read any you think you need. Each one names the input it was given, so you can follow ` +
        `the chain back as far as you want:`,
    ];
    for (const ref of refs) {
      try {
        const o = this.results.read(ref);
        lines.push(`  - ${ref}  [${o.station}/${o.verdict}]  ${clip(o.handoff, 300)}`);
        if (o.verdict === "fail" && o.rejected_because) {
          lines.push(`      rejected because: ${clip(o.rejected_because, 400)}`);
        }
      } catch {
        lines.push(`  - ${ref}`);
      }
    }
    return lines.join("\n");
  }

  /** A node entering the flow is handed the final results of the nodes it depends on. */
  private seedInput(node: string): void {
    const d = this.st(node);
    if (d.input.length > 0) return;
    d.input = (this.graph.get(node) ?? [])
      .map((dep) => this.st(dep).final)
      .filter((ref): ref is string => ref !== null);
  }

  private depsClear(node: string): boolean {
    return (this.graph.get(node) ?? []).every((d) => {
      const s = this.st(d).status;
      return s === "finished" || s === "skipped";
    });
  }

  // ------------------------------------------------------------------- dispatch

  private startWorker(s: Station, node: string): Active {
    const attempt = (this.st(node).attempts[s.name] ?? 0) + 1;
    const brief = s.briefPath(node) ?? "";
    const evidence = s.evidencePath(node) ?? "";
    // Where the worker must write. It does not exist yet; the worker's job is to make it exist.
    const resultPath = this.results.staged(this.results.ref(node, s.name, attempt));
    const prompt = fill(
      s.pass.prompt,
      {
        node, req: node, root: this.root,
        flow: this.flow.name, station: s.name, pass: s.passName,
        result_path: resultPath,
        input: this.describeInput(node),
        brief, evidence, attempt,
      },
      `prompt of pass '${s.passName}'`,
    );
    // Emptied, not just created. A re-run reuses this path, and a transcript left by the previous
    // run would be handed to a reader as though this attempt had written it.
    const sessionDir = join(this.dir, "sessions", s.name, `${node}-${attempt}`);
    rmSync(sessionDir, { recursive: true, force: true });
    mkdirSync(sessionDir, { recursive: true });
    const argv = s.runner.map((arg) =>
      fill(
        arg,
        {
          prompt, provider: s.pass.provider, model: s.pass.model, root: this.root,
          node, req: node, brief, evidence, result_path: resultPath, attempt,
          session_dir: sessionDir,
        },
        `runner of pass '${s.passName}'`,
      ),
    );

    const logDir = join(this.dir, "worker-log", s.name);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, `${node}-${attempt}.prompt.txt`), prompt);

    const workerLog = join(logDir, `${node}-${attempt}.log`);
    return {
      phase: "work",
      station: s,
      startedMs: Date.now(),
      proc: launch(argv, { cwd: this.root, logFile: workerLog }),
      worker: { code: null, log: workerLog },
    };
  }

  /**
   * Start the evaluator, if it is something that runs. Returns null when the verdict can be
   * reached immediately from what is already on disk.
   */
  private startEvaluator(s: Station, node: string): Pick<Active, "proc" | "evalOut"> | null {
    const ev = s.evaluator;
    const evidence = s.evidencePath(node) ?? "";

    if (ev.kind === "result") return null;

    if (ev.kind === "command") {
      const cmd = fill(
        ev.run,
        { node, req: node, root: this.root, evidence },
        `evaluator.run of pass '${s.passName}'`,
      );
      const out = join(this.dir, "evalout", s.name, `${node}.txt`);
      return { proc: launch([cmd], { cwd: this.root, shell: true, logFile: out }), evalOut: out };
    }

    const verdict = s.verdictPath(node);
    mkdirSync(join(verdict, ".."), { recursive: true });
    rmSync(verdict, { force: true }); // a stale verdict from an earlier attempt would be read as this one's
    const prompt = fill(
      ev.prompt,
      {
        node, req: node, root: this.root, flow: this.flow.name, station: s.name,
        verdict, evidence, brief: s.briefPath(node) ?? "", input: this.describeInput(node),
      },
      `evaluator.prompt of pass '${s.passName}'`,
    );
    const argv = (ev.runner ?? s.runner).map((arg) =>
      fill(
        arg,
        {
          prompt, provider: s.pass.provider, model: ev.model ?? s.pass.model,
          root: this.root, node, req: node, brief: s.briefPath(node) ?? "", evidence,
          verdict, attempt: this.st(node).attempts[s.name] ?? 0,
          session_dir: join(this.dir, "sessions", s.name, `${node}-review`),
        },
        `evaluator.runner of pass '${s.passName}'`,
      ),
    );
    const logDir = join(this.dir, "evalout", s.name);
    return { proc: launch(argv, { cwd: this.root, logFile: join(logDir, `${node}-review.log`) }) };
  }

  // ------------------------------------------------------------------- verdict

  /** Evidence that exists but is empty is not evidence. Nine empty files once read as success. */
  private evidenceOk(s: Station, node: string): string | null {
    const path = s.evidencePath(node);
    if (path === null) return null;
    if (!existsSync(path) || statSync(path).size === 0) return `${path} is missing or empty.`;
    return null;
  }

  private judge(s: Station, node: string, a: Active): Judgement {
    const missing = this.evidenceOk(s, node);
    const ev = s.evaluator;

    if (ev.kind === "result") {
      return missing ? { ok: false, why: missing } : { ok: true, why: "" };
    }

    if (ev.kind === "command") {
      const text = a.evalOut && existsSync(a.evalOut) ? readFileSync(a.evalOut, "utf8") : "";
      if (missing) return { ok: false, why: `${missing}\n\n${clip(text, 1500, "tail")}` };
      const wantFail = ev.expect === "fail";
      const code = a.proc.code ?? -1;
      const ok = wantFail ? code !== 0 : code === 0;
      if (ok) return { ok: true, why: "" };
      const ran = fill(
        ev.run,
        { node, req: node, root: this.root, evidence: s.evidencePath(node) ?? "" },
        `evaluator.run of pass '${s.passName}'`,
      );
      return {
        ok: false,
        why:
          `The check \`${ran}\` ${wantFail ? "should have failed but it passed" : "failed"} ` +
          `(exit ${code}).\n\nIts output:\n\n${clip(text, 3000, "tail")}`,
      };
    }

    const verdict = s.verdictPath(node);
    if (!existsSync(verdict)) {
      return { ok: false, why: "The reviewer wrote no verdict, so the work cannot be accepted." };
    }
    const text = readFileSync(verdict, "utf8").trim();
    return text.toUpperCase().startsWith("PASS") ? { ok: true, why: "" } : { ok: false, why: text };
  }

  // ------------------------------------------------------------------- routing

  private route(
    s: Station,
    node: string,
    judged: Judgement,
    seconds: number,
    worker?: WorkerEnd,
  ): void {
    const d = this.st(node);
    const attempt = (d.attempts[s.name] ?? 0) + 1;
    d.attempts[s.name] = attempt;

    const ref = this.results.ref(node, s.name, attempt);
    const meta: ResultMeta = {
      node,
      station: s.name,
      attempt,
      verdict: judged.ok ? "pass" : "fail",
      seconds,
      input_ref: [...d.input],
      evidence: s.evidencePath(node),
      rejected_because: judged.ok ? null : judged.why.trim(),
      // Relative to the run directory, so the reference survives the run being moved or archived.
      session_ref: transcript(this.dir, join("sessions", s.name, `${node}-${attempt}`)),
    };

    const taken = this.results.take(ref, meta);
    let ok = judged.ok;
    let note = "";
    if (!taken.ok) {
      // No result object is itself a failure, whatever the evaluator thought of the evidence.
      ok = false;
      note = taken.why;
      // The worker's own ending goes in with the reason. A command evaluator already reports its
      // exit code and output when it rejects; a worker that wrote nothing said even less, so the
      // exit code and what it printed are all the next attempt has to go on.
      this.results.standIn(ref, { ...meta, verdict: "fail" }, `${taken.why}\n\n${howItEnded(worker)}`);
    }

    appendFileSync(this.logFile, `${node}\t${s.name}\t${attempt}\t${ok ? "pass" : "fail"}\t${seconds}\t${ref}\n`);

    // The result travels the same way whether it passed or failed. A rejection is not a special
    // case: the next attempt is handed a reference to the result that says why it was rejected.
    d.input = [ref];

    if (ok) {
      if (s.onPass === null) {
        d.status = "finished";
        d.station = null;
        d.final = ref;
        say(`  done ${node}  (${ref})`);
      } else {
        d.status = "waiting";
        d.station = s.onPass;
        say(`  pass ${node}  ${s.name} -> ${s.onPass}  ${seconds}s`);
      }
    } else if (attempt >= s.maxAttempts) {
      d.status = "dead";
      d.station = s.name;
      say(`  DEAD ${node}  ${s.name} failed ${s.maxAttempts}x  ${seconds}s`);
      this.blockDependents();
    } else {
      d.status = "waiting";
      d.station = s.failTo;
      say(`  fail ${node}  ${s.name} -> ${s.failTo} (attempt ${attempt}/${s.maxAttempts})  ${seconds}s`);
    }
    if (note) say(`       ${clip(note.split("\n")[0] ?? "", 110)}`);
    this.save();
  }

  /** A failure stops everything downstream of it, transitively. */
  private blockDependents(): void {
    for (let changed = true; changed; ) {
      changed = false;
      for (const [node, deps] of this.graph) {
        if (this.st(node).status !== "waiting") continue;
        if (deps.some((d) => ["dead", "blocked"].includes(this.st(d).status))) {
          this.st(node).status = "blocked";
          changed = true;
        }
      }
    }
  }

  // ------------------------------------------------------------------- main loop

  async go(fresh: boolean): Promise<number> {
    for (const cmd of this.flow.preparations) {
      say(`preparing: ${cmd}`);
      const prep = launch([cmd], { cwd: this.root, shell: true });
      while (!prep.done) await sleep(200);
      if (prep.code !== 0) {
        say(`preparation failed (exit ${prep.code}): ${cmd}`);
        return 1;
      }
    }

    const first = this.station(this.flow.start);
    for (const node of this.graph.keys()) {
      const d = this.st(node);
      if (fresh) {
        d.status = "waiting";
        d.station = this.flow.start;
        d.attempts = {};
        d.input = [];
        d.final = null;
      }
      // A pass that names a brief cannot run a node that has none. That is a gap in the work to
      // be done, not a failure of the worker, so the node is skipped rather than killed.
      const brief = first.briefPath(node);
      if (brief && !existsSync(brief)) d.status = "skipped";
    }
    this.save();

    const c0 = this.counts();
    say(
      `flow '${this.flow.name}': ${this.graph.size} nodes, ${c0.finished} already finished, ` +
        `${c0.skipped} skipped, ` +
        `${Number.isFinite(this.maxParallel) ? `max ${this.maxParallel} at once` : "no parallel limit"}`,
    );

    const t0 = Date.now();
    for (;;) {
      for (const node of [...this.graph.keys()].sort()) {
        if (this.active.size >= this.maxParallel) break;
        const d = this.st(node);
        if (d.status !== "waiting" || !this.depsClear(node)) continue;
        this.seedInput(node);
        const s = this.station(d.station ?? this.flow.start);
        this.active.set(node, this.startWorker(s, node));
        d.status = "working";
        say(`  -> ${node} at ${s.name}`);
      }

      for (const [node, a] of [...this.active]) {
        // A timeout applies to the worker only. Evaluators are our own commands, and killing one
        // would blame the worker for the engine's own tooling.
        const limit = a.phase === "work" ? a.station.timeoutSeconds : null;
        const elapsed = (Date.now() - a.startedMs) / 1000;
        const over = limit !== null && elapsed > limit;
        if (!a.proc.done && !over) continue;
        if (over && !a.proc.done) {
          a.proc.kill();
          a.timedOut = true;
        }

        const seconds = Math.floor((Date.now() - a.startedMs) / 1000);
        if (a.phase === "work") {
          // Read now, while it is still the worker's process. Starting the evaluator replaces it.
          const worker: WorkerEnd | undefined = a.worker && { ...a.worker, code: a.proc.code };
          const started = this.startEvaluator(a.station, node);
          if (started && !a.timedOut) {
            this.active.set(node, { ...a, ...started, phase: "eval", worker });
            this.st(node).status = "evaluating";
            continue;
          }
          this.active.delete(node);
          const judged = a.timedOut
            ? { ok: false, why: `The worker was stopped after ${a.station.timeoutSeconds}s, the limit this pass sets.` }
            : this.judge(a.station, node, a);
          this.route(a.station, node, judged, seconds, worker);
        } else {
          this.active.delete(node);
          this.route(a.station, node, this.judge(a.station, node, a), seconds, a.worker);
        }
      }

      const more = [...this.graph.keys()].some(
        (n) => this.st(n).status === "waiting" && this.depsClear(n),
      );
      if (this.active.size === 0 && !more) break;
      await sleep(this.pollMs);
    }

    return this.report(Math.floor((Date.now() - t0) / 1000));
  }

  private report(seconds: number): number {
    const c = this.counts();
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    say(`\nflow '${this.flow.name}' finished in ${h}h${pad(m)}m${pad(seconds % 60)}s`);
    say(`  ${STATUSES.filter((s) => c[s] > 0).map((s) => `${s}=${c[s]}`).join("  ")}`);
    for (const [status, label] of [
      ["dead", "gave up"],
      ["blocked", "blocked by a dependency"],
      ["waiting", "never became ready"],
    ] as const) {
      const bad = Object.keys(this.state).filter((n) => this.state[n]!.status === status).sort();
      if (bad.length > 0) say(`  ${label}: ${bad.join(" ")}`);
    }
    say(`  results: ${this.results.dir}`);
    return c.dead + c.blocked + c.waiting > 0 ? 1 : 0;
  }
}

/**
 * How the worker's process ended, in a sentence, for a result the worker did not write.
 *
 * A stand-in result used to say only that nothing was written, which is the one fact the reader
 * already had. The exit code separates a worker that crashed from one that exited cleanly having
 * done nothing, and those call for different responses. The output is quoted rather than
 * referenced because it is usually two lines and the next attempt reads this text directly; the
 * whole of it stays in the worker log either way.
 */
function howItEnded(worker?: WorkerEnd): string {
  if (!worker) return "How the worker's process ended was not recorded.";

  const ending = worker.code === null
    ? "was still running when the engine stopped waiting for it"
    : worker.code === -1
      ? "was killed by a signal"
      : `exited ${worker.code}`;

  const printed = existsSync(worker.log) ? readFileSync(worker.log, "utf8").trim() : "";
  const said = printed === ""
    ? "It printed nothing at all."
    : `What it printed:\n\n${clip(printed, 2000, "tail")}`;

  return `The worker process ${ending}. ${said}`;
}

/**
 * The transcript an attempt left behind, relative to the run directory, or null if it left none.
 *
 * One worker writes one transcript into a directory of its own, so this normally finds exactly one
 * file. The directory is read rather than the name being predicted, because the name is the
 * session id and the engine does not choose it. If a worker ever leaves more than one, the most
 * recently written is the one that ran; the rest stay on disk beside it for anyone who looks.
 */
function transcript(runDir: string, rel: string): string | null {
  const dir = join(runDir, rel);
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return found.length > 0 ? join(rel, found[0]!.f) : null;
}

function clip(text: unknown, max: number, from: "head" | "tail" = "head"): string {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return from === "head" ? `${s.slice(0, max)}…` : `…${s.slice(-max)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}
