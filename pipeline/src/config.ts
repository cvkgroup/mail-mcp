/**
 * Flows and passes, read from JSON and checked before anything runs.
 *
 * A FLOW is a set of STATIONS. A station has a worker, an evaluator that decides whether the
 * worker achieved the task, a destination on success and a destination on failure. A node moves
 * between stations until it leaves the flow or runs out of attempts. Stations are the pieces;
 * a flow is what you build out of them, and a station may send failures anywhere — backwards,
 * sideways, or to itself.
 *
 * The configuration is JSON, which means every name in it is just a string. So everything that
 * can be checked is checked at load: the shape, the routing targets, and every placeholder in
 * every template. A flow that routes to a station that does not exist, or a prompt that asks for
 * a value nothing supplies, stops the run before it starts a single worker rather than crashing
 * into it an hour in.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { checkTemplate, fill, type Vars } from "./template.js";

/**
 * Where a project keeps its flows and passes, relative to its root: `<root>/pipeline/flows` and
 * `<root>/pipeline/passes`. The engine ships in that same folder, so a project adopts it by copying
 * one directory in and putting its own flows and passes beside the engine.
 */
export const CONFIG_DIR = "pipeline";

// --------------------------------------------------------------------------- what may appear where

/** A pass prompt is the one place that sees everything about the attempt. */
export const PROMPT_VARS = [
  "node", "req", "root", "flow", "station", "pass",
  "result_path", "input", "brief", "evidence", "attempt",
] as const;

/** Paths are resolved once per node, before the attempt exists. */
export const PATH_VARS = ["node", "req", "root", "flow", "station", "pass"] as const;

/**
 * A runner turns an attempt into a command line.
 *
 * `result_path` is the empty slot the worker must fill: a file name that does not exist yet. An
 * agent is told it in prose, inside the prompt. A worker that is a shell script cannot read prose,
 * so the runner can pass the same path as an argument instead.
 */
export const RUNNER_VARS = [
  "prompt", "provider", "model", "root", "node", "req", "brief", "evidence",
  "result_path", "attempt", "session_dir",
] as const;

/** A reviewer writes a verdict, not a result, so it is told about the verdict path instead. */
export const EVAL_RUNNER_VARS = [
  "prompt", "provider", "model", "root", "node", "req", "brief", "evidence", "verdict", "attempt",
  "session_dir",
] as const;

export const COMMAND_VARS = ["node", "req", "root", "evidence"] as const;

export const REVIEW_VARS = [
  "node", "req", "root", "flow", "station", "verdict", "evidence", "brief", "input",
] as const;

/**
 * How a worker is executed. Injected rather than built in, so a station may drive an agent CLI,
 * a different agent CLI, or a shell script, without the engine knowing the difference.
 *
 * `-p` is print mode: one shot, exits when the turn ends. It does not avoid the daemon — nothing
 * does. Print mode is a client-owned worker under a supervisor, and the supervisor is unavoidable.
 *
 * The session is kept, in its own directory per attempt, because a worker that produces nothing
 * is otherwise unreadable. One attempt ran thirty minutes, wrote no file, emitted no output, and
 * left a transcript nobody could inspect, because `--no-session` had discarded it.
 *
 * `--session-dir` is what makes keeping it safe. A daemon that restores stored sessions on restart
 * will resume hours-old jobs over current work; that cost a day. These transcripts live under the
 * run directory, not in the store the daemon knows about, and the directory names them by node and
 * attempt so a session can be found without guessing at timestamps.
 */
export const DEFAULT_RUNNER = [
  "prime-agent", "-p",
  "--session-dir", "{session_dir}",
  "--provider", "{provider}", "--model", "{model}",
  "--cwd", "{root}", "{prompt}",
] as const;

// --------------------------------------------------------------------------- schemas

const Evaluator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("result") }),
  z.object({
    kind: z.literal("command"),
    run: z.string().min(1),
    expect: z.enum(["pass", "fail"]).default("pass"),
  }),
  z.object({
    kind: z.literal("agent"),
    prompt: z.string().min(1),
    verdict: z.string().optional(),
    model: z.string().optional(),
    runner: z.array(z.string()).min(1).optional(),
  }),
]);

const PassSchema = z.object({
  prompt: z.string().min(1),
  evidence: z.string().optional(),
  brief: z.string().optional(),
  brief_command: z.string().optional(),
  evaluator: Evaluator.optional(),
  runner: z.array(z.string()).min(1).optional(),
  provider: z.string().default("openrouter"),
  model: z.string().default("deepseek/deepseek-v4-flash-0731"),
  /**
   * There is NO time limit unless a pass asks for one, and none of them do.
   *
   * A limit is a policy decision and it belongs to whoever writes the pass. A limit invented by
   * the tool manufactures the failures it appears to detect: a 240s default once killed workers
   * doing a task that takes 96s when it succeeds, and those kills were then reported upward as
   * hangs and theorised about for an hour. The cost of having no limit is that a genuinely stuck
   * worker holds its slot until someone intervenes, which the worker log makes visible.
   */
  timeout_seconds: z.number().int().positive().optional(),
});

const StationSchema = z.object({
  pass: z.string().optional(),
  on_pass: z.string().nullable(),
  on_fail: z
    .object({ to: z.string().optional(), max_attempts: z.number().int().positive().default(3) })
    .default({ max_attempts: 3 }),
});

const FlowSchema = z.object({
  start: z.string().min(1),
  stations: z.record(z.string(), StationSchema),
});

export type PassConfig = z.infer<typeof PassSchema>;
export type EvaluatorConfig = z.infer<typeof Evaluator>;

// --------------------------------------------------------------------------- station

export class Station {
  readonly name: string;
  readonly passName: string;
  readonly onPass: string | null;
  readonly failTo: string;
  readonly maxAttempts: number;
  readonly pass: PassConfig;
  readonly evaluator: EvaluatorConfig;
  readonly runner: readonly string[];

  constructor(
    name: string,
    station: z.infer<typeof StationSchema>,
    pass: PassConfig,
    private readonly root: string,
    private readonly flow: string,
  ) {
    this.name = name;
    this.passName = station.pass ?? name;
    this.onPass = station.on_pass;
    this.failTo = station.on_fail.to ?? name;
    this.maxAttempts = station.on_fail.max_attempts;
    this.pass = pass;
    this.evaluator = pass.evaluator ?? { kind: "result" };
    this.runner = pass.runner ?? [...DEFAULT_RUNNER];
  }

  get timeoutSeconds(): number | null {
    return this.pass.timeout_seconds ?? null;
  }

  private pathVars(node: string): Vars {
    return {
      node, req: node, root: this.root,
      flow: this.flow, station: this.name, pass: this.passName,
    };
  }

  private resolvePath(template: string | undefined, node: string, what: string): string | null {
    if (!template) return null;
    return resolve(this.root, fill(template, this.pathVars(node), `${what} of pass '${this.passName}'`));
  }

  /** The document the worker is told to read, if the pass names one. */
  briefPath(node: string): string | null {
    return this.resolvePath(this.pass.brief, node, "brief");
  }

  /** The artifact the worker is expected to leave behind, if the pass names one. */
  evidencePath(node: string): string | null {
    return this.resolvePath(this.pass.evidence, node, "evidence");
  }

  /** Where a reviewing agent writes PASS or FAIL and its reasons. */
  verdictPath(node: string): string {
    if (this.evaluator.kind === "agent" && this.evaluator.verdict) {
      return this.resolvePath(this.evaluator.verdict, node, "verdict")!;
    }
    return join(this.root, "runs", this.flow, "verdict", this.name, `${node}.md`);
  }
}

// --------------------------------------------------------------------------- loading

export interface LoadedFlow {
  name: string;
  start: string;
  stations: Map<string, Station>;
  /** Commands to run once before the flow starts, in the order the stations declare them. */
  preparations: string[];
}

export function loadFlow(name: string, root: string): LoadedFlow {
  const flowDir = join(root, CONFIG_DIR, "flows");
  const file = join(flowDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`no flow '${name}' — ${flowDir} has: ${listNames(flowDir)}`);
  }

  const flow = parse(FlowSchema, stripComments(readJson(file)), file);
  const stations = new Map<string, Station>();

  for (const [stationName, raw] of Object.entries(flow.stations)) {
    if (stationName.startsWith("_")) continue;
    const passName = raw.pass ?? stationName;
    const passFile = join(root, CONFIG_DIR, "passes", `${passName}.json`);
    if (!existsSync(passFile)) {
      throw new Error(
        `station '${stationName}' of flow '${name}' uses pass '${passName}', but ${passFile} does not exist`,
      );
    }
    const pass = parse(PassSchema, stripComments(readJson(passFile)), passFile);
    stations.set(stationName, new Station(stationName, raw, pass, root, name));
  }

  if (stations.size === 0) throw new Error(`${file}: the flow has no stations`);
  if (!stations.has(flow.start)) {
    throw new Error(
      `${file}: start is '${flow.start}', which is not a station. Stations: ${[...stations.keys()].join(", ")}`,
    );
  }
  for (const station of stations.values()) {
    for (const [what, target] of [["on_pass", station.onPass], ["on_fail.to", station.failTo]] as const) {
      if (target !== null && !stations.has(target)) {
        throw new Error(
          `${file}: station '${station.name}' routes ${what} to '${target}', which is not a station. ` +
            `Stations: ${[...stations.keys()].join(", ")}`,
        );
      }
    }
    checkStationTemplates(station);
  }

  const preparations: string[] = [];
  for (const station of stations.values()) {
    const cmd = station.pass.brief_command;
    if (cmd && !preparations.includes(cmd)) preparations.push(cmd);
  }

  return { name, start: flow.start, stations, preparations };
}

/**
 * Every template a station will substitute, checked against the names that will be available.
 * This is what catches a placeholder left over from an older tool.
 */
function checkStationTemplates(s: Station): void {
  const where = (what: string) => `${what} of pass '${s.passName}'`;
  checkTemplate(s.pass.prompt, PROMPT_VARS, where("prompt"));
  if (s.pass.brief) checkTemplate(s.pass.brief, PATH_VARS, where("brief"));
  if (s.pass.evidence) checkTemplate(s.pass.evidence, PATH_VARS, where("evidence"));
  for (const arg of s.runner) checkTemplate(arg, RUNNER_VARS, where("runner"));

  const ev = s.evaluator;
  if (ev.kind === "command") checkTemplate(ev.run, COMMAND_VARS, where("evaluator.run"));
  if (ev.kind === "agent") {
    checkTemplate(ev.prompt, REVIEW_VARS, where("evaluator.prompt"));
    if (ev.verdict) checkTemplate(ev.verdict, PATH_VARS, where("evaluator.verdict"));
    for (const arg of ev.runner ?? s.runner) {
      checkTemplate(arg, EVAL_RUNNER_VARS, where("evaluator.runner"));
    }
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${String(e)}`);
  }
}

/** Keys beginning with `_` are comments. JSON has none, and these files need them. */
function stripComments(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith("_")) out[k] = stripComments(v);
  }
  return out;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`${file} is not a valid configuration:\n${issues}`);
}

function listNames(dir: string): string {
  if (!existsSync(dir)) return "the directory does not exist";
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  return names.length > 0 ? names.join(", ") : "nothing";
}
