# The pipeline engine

Move every node of a dependency graph through a flow of specialists.

A **graph** says which nodes depend on which; a node cannot start until its dependencies are done.
A **flow** is a set of **stations**, each with a worker, an evaluator that decides whether the worker
achieved the task, a destination on success and a destination on failure. A node moves between
stations until it leaves the flow or runs out of attempts. A worker's only output that counts is a
**result object** — one JSON file, written atomically, naming what was done and what comes next.
Exiting is not finishing.

The engine mentions neither the work nor the project. The graph, the flows and the passes are the
project's; everything in `src/` is not.

## Layout

    pipeline/
      pipeline.ts          the CLI
      src/                 the engine, and its tests
      flows/               <name>.json — the stations and the routes between them
      passes/              <name>.json — what a station's worker is told, and how it is judged
      graphs/              dependency graphs
      provider-report.ts   who served each attempt, read afterwards from the aggregator
      pipeline.py          an earlier implementation of the same idea, kept for reference
      docs/                the requirements the engine is built against, and the flow it serves

Flows and passes are read from `<root>/pipeline/flows` and `<root>/pipeline/passes`, where `<root>`
defaults to the parent of this folder. The name of this folder is therefore part of the contract —
it is the `CONFIG_DIR` constant in `src/config.ts`.

Run output goes to `<root>/runs/<flow>/`: the result objects, the worker transcripts, the evidence,
the per-attempt log, and `state.json`. State on disk is what makes a run resumable — interrupting
one and starting it again continues rather than repeats, and `--fresh` is how you say you meant to
start over.

## Running it

    npm run pipeline -- <flow> --graph <file> [--root <dir>] [--only a,b] [--max-parallel n] [--fresh]
    npm run pipeline:test        # the engine's own tests
    npm run pipeline:check       # typecheck
    npm run pipeline:providers   # provider attribution for a finished run

`--graph` is required. There is no default: the graph is the one input that is wholly the project's.

## Taking it to another project

Copy this folder to the new project's root. It needs `zod` at runtime, and `tsx`, `typescript` and
`vitest` to run and test — `package.json` here declares them, and the four `pipeline*` scripts in
the parent project's `package.json` are what invoke it from the root.

Then supply the three project-specific things: a graph, a flow, and a pass per station. Delete what
belonged to the old project — here that is `flows/red.json`, `passes/red.json` and
`pipelines/red.json`, which are the agent-mail red phase and whose `brief_command` calls a script
that stays behind in that project. The `demo` flow, pass and graph are the smallest set that
exercises the whole mechanism and are worth keeping as a working example.

## What is known not to work

`docs/pipeline-engine-requirements.md` ends with a **Known gaps** section, recorded so they are not
mistaken for requirements that are met — a worker that never returns is invisible while it happens,
a skipped node does not say why, and provider attribution is a separate tool rather than part of a
run. `docs/pipeline-flow.md` ends with its own open questions about the flow the engine serves.
Read both before trusting a green run to mean more than it does.
