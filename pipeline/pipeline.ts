#!/usr/bin/env -S npx tsx
/**
 * Run a flow of specialists over a dependency graph.
 *
 *   npm run pipeline -- <flow> [--graph <file>] [--only a,b] [--fresh]
 *
 * The flow says what happens to a node; the graph says what order nodes may happen in. Neither
 * mentions the other, and the engine mentions neither the work nor the project, so the same
 * command drives a red phase here and something else entirely somewhere else.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadFlow } from "./src/config.js";
import { loadGraph, subgraph } from "./src/graph.js";
import { Run } from "./src/run.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: npm run pipeline -- <flow> [options]

  <flow>              a file in pipeline/flows, named without .json

  --graph <file>      the dependency graph (required)
  --root <dir>        the project root (default: the parent of pipeline/)
  --max-parallel <n>  how many workers may run at once (default: as many as the graph allows)
  --only a,b,c        run only these nodes, dropping edges that leave the selection
  --fresh             start every node over, ignoring what an earlier run recorded

A run keeps its state in runs/<flow>/state.json, so interrupting it and starting it again
continues rather than repeats. --fresh is how you say you meant to start over.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      graph: { type: "string" },
      root: { type: "string" },
      "max-parallel": { type: "string" },
      only: { type: "string" },
      fresh: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(`${USAGE}\n`);
    return positionals.length === 0 && !values.help ? 2 : 0;
  }
  if (positionals.length > 1) {
    throw new Error(`expected one flow name, got: ${positionals.join(" ")}`);
  }

  // No default. The graph is the one thing here that is wholly the project's, and a default file
  // name is a leftover from whichever project the engine was written in.
  if (values.graph === undefined) throw new Error("--graph is required: the file naming the nodes and their dependencies");
  const graphFile = resolve(values.graph);
  const root = resolve(values.root ?? resolve(HERE, ".."));
  // No default. The graph already says what may run at once, and any number invented here can only
  // make a run slower than the work requires while looking like it protects something.
  const maxParallel = values["max-parallel"] === undefined ? Infinity : Number(values["max-parallel"]);
  if (!Number.isInteger(maxParallel) && maxParallel !== Infinity) {
    throw new Error(`--max-parallel must be a positive whole number, not '${values["max-parallel"]}'`);
  }
  if (maxParallel < 1) {
    throw new Error(`--max-parallel must be at least 1, not '${values["max-parallel"]}'`);
  }

  let graph = loadGraph(graphFile);
  if (values.only) {
    const want = new Set(values.only.split(",").map((s) => s.trim()).filter(Boolean));
    graph = subgraph(graph, want);
  }

  const flow = loadFlow(positionals[0]!, root);
  return new Run(flow, root, graph, maxParallel).go(values.fresh ?? false);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
