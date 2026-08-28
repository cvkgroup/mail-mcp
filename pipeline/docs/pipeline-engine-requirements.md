# Pipeline engine — technical requirements

Status: describes the engine as built, on branch `develop`, 2026-08-16.

## Purpose

The pipeline engine runs a flow of specialists over a dependency graph. It knows nothing about the
work it runs. The same engine drives a red phase here, and something else entirely somewhere else.

This document states what the engine SHALL do. It is written so that the engine can be replaced,
and the replacement can be shown to be correct. Every requirement has acceptance criteria, and
every criterion is falsifiable.

## Scope

In scope: configuration, the graph, scheduling, workers, result objects, evidence, evaluation,
routing, the record a run leaves, and resuming.

Out of scope: what a worker does, what a brief says, and which model answers. Those are
configuration, and configuration is not the engine.

## Vocabulary

- **Flow** — the stations a node passes through, and the routes between them.
- **Station** — one step in a flow. A station names a pass.
- **Pass** — what happens at a station: a prompt, a runner, an evaluator, and what counts as
  evidence.
- **Node** — one unit of work. The graph names the nodes.
- **Worker** — the process a pass launches for one node at one station.
- **Evaluator** — what decides whether an attempt is accepted.
- **Evidence** — the artefact a pass requires on disk.
- **Result object** — the record of one attempt.
- **Reference** — the name of a result object. Handlers are given references, never copies.
- **Attempt** — one run of a worker for one node at one station.

## Conventions

SHALL is a requirement. SHOULD is a recommendation. SHALL NOT is a prohibition. The actor is named
in every requirement. **Why** appears only where the requirement was written after a failure, and
it records that failure so the requirement is not removed by someone who has not seen it.

---

## Configuration

#### REQ-PIPE-001 — A flow is named, not pathed
- **Requirement.** The engine SHALL load a flow by name from the flows directory. The engine SHALL
  refuse an unknown name, and SHALL name the flows that exist.
- **Acceptance.**
  1. A flow named `red` loads from `pipeline/flows/red.json`.
  2. A request for a flow that does not exist is refused before anything runs.
  3. The refusal lists the names that do exist.

#### REQ-PIPE-002 — A flow is validated before anything runs
- **Requirement.** The engine SHALL check every route in a flow before it starts the first worker.
  A route to a station that is not defined SHALL be refused.
- **Acceptance.**
  1. A station whose `on_pass` names an undefined station is refused at load.
  2. A station whose `on_fail.to` names an undefined station is refused at load.
  3. The refusal names the station and the route that is wrong.
  4. No worker starts when a flow is refused.
- **Why.** A route that is wrong in the last station of a long flow costs a whole run to discover.

#### REQ-PIPE-003 — Every placeholder is supplied
- **Requirement.** The engine SHALL check every placeholder in a pass before it starts the first
  worker. A placeholder that nothing supplies SHALL be refused.
- **Acceptance.**
  1. A prompt containing `{token}`, which the engine does not supply, is refused at load.
  2. The refusal names the placeholder.
  3. A prompt containing only supplied placeholders loads.

#### REQ-PIPE-004 — The runner is configuration
- **Requirement.** A pass SHALL be able to define the command that runs a worker. The engine SHALL
  NOT contain the name of any agent, model, or provider in its scheduling logic.
- **Acceptance.**
  1. A pass with a `runner` of `["bash", "worker.sh", "{node}"]` runs that command.
  2. A pass with no `runner` uses the default runner.
  3. A whole flow runs to completion with a shell script as the worker, with no model involved.

#### REQ-PIPE-005 — There is no time limit unless a pass asks for one
- **Requirement.** The engine SHALL NOT apply a default time limit to a worker. A pass MAY set
  `timeout_seconds`. The engine SHALL apply a limit only to a worker, and SHALL NOT apply one to an
  evaluator.
- **Acceptance.**
  1. A pass with no `timeout_seconds` runs a worker for as long as the worker takes.
  2. A pass with `timeout_seconds` set kills a worker that exceeds it.
  3. A killed worker's attempt fails, and the reason names the limit the pass set.
  4. An evaluator is never killed for taking too long.
- **Why.** A default limit of 240s once killed workers doing a task that takes 96s when it succeeds.
  Those kills were then reported as hangs and theorised about for an hour. A limit is a policy
  decision, and it belongs to whoever writes the pass.

#### REQ-PIPE-006 — Preparation runs once, before the flow
- **Requirement.** The engine SHALL run each pass's preparation command once, before the first
  node starts. The engine SHALL run each distinct command once, however many stations name it. The
  engine SHALL stop the run if a preparation command fails.
- **Acceptance.**
  1. Two stations naming the same preparation command run it once.
  2. A preparation command that exits non-zero stops the run before any node starts.
  3. A stopped run reports the command that failed and its exit code.

---

## The graph

#### REQ-PIPE-020 — The graph expresses one rule
- **Requirement.** The graph SHALL map each node to the nodes it depends on. A node SHALL NOT start
  until every node it depends on has finished. The graph SHALL express nothing else.
- **Acceptance.**
  1. A node with no dependencies is eligible immediately.
  2. A node with one dependency is not started while that dependency is unfinished.
  3. The graph carries no station, no order within a station, and no timing.

#### REQ-PIPE-021 — The graph is accepted in the shapes it already has
- **Requirement.** The engine SHALL accept a bare mapping, a mapping wrapped under a `dep`, `deps`,
  or `graph` key, and a text edge list. The engine SHALL ignore keys that begin with an underscore.
- **Acceptance.**
  1. `{"a": ["b"], "b": []}` loads as two nodes.
  2. `{"dep": {"a": []}, "wave": {"a": 1}}` loads as one node, from `dep`.
  3. An edge list line `a: b c` loads `a` depending on `b` and `c`.
  4. A key `_why` is not loaded as a node.

#### REQ-PIPE-022 — A dependency that does not exist is refused
- **Requirement.** The engine SHALL refuse a graph in which a node depends on a node the graph never
  defines. The refusal SHALL name both nodes.
- **Acceptance.**
  1. `{"a": ["b"]}` with no `b` is refused at load.
  2. The refusal names `a` and `b`.
- **Why.** A dependency that does not exist can never finish, so the node that waits on it can never
  start. Without this check the run appears to work and quietly never completes.

#### REQ-PIPE-023 — A cycle is refused, and named
- **Requirement.** The engine SHALL refuse a graph that contains a cycle. The refusal SHALL name
  every node in the cycle.
- **Acceptance.**
  1. A graph where `a` depends on `b` and `b` depends on `a` is refused at load.
  2. The refusal lists `a` and `b`.

#### REQ-PIPE-024 — A selection drops the edges that leave it
- **Requirement.** The engine SHALL be able to run a named subset of nodes. Dependencies on nodes
  outside the subset SHALL be dropped. The engine SHALL refuse a name that the graph does not have.
- **Acceptance.**
  1. Selecting `b` from `{"a": [], "b": ["a"]}` runs `b` with no dependencies.
  2. Selecting a node the graph does not define is refused, and the refusal names it.

---

## Scheduling

#### REQ-PIPE-040 — A node starts when its own dependencies are done
- **Requirement.** The engine SHALL start a node as soon as every node it depends on has finished.
  The engine SHALL NOT wait for any other node.
- **Acceptance.**
  1. Two nodes with no dependencies start together.
  2. A node whose single dependency finishes starts while other, unrelated nodes are still running.
  3. No node waits for a node it does not depend on.
- **Why.** The wave schedule this replaced held every node in a wave until the slowest finished. The
  slowest node in a wave set the pace for all of them.

#### REQ-PIPE-041 — Concurrency is not limited unless asked
- **Requirement.** The engine SHALL run as many workers at once as the graph allows. The engine
  SHALL apply a limit only when one is given on the command line.
- **Acceptance.**
  1. With no limit given, a graph with six eligible nodes runs six workers.
  2. With a limit of two, no more than two workers run at once.
  3. The run announces which of the two applies.

#### REQ-PIPE-042 — A node with no work is skipped, not failed
- **Requirement.** When a pass names a brief and that brief does not exist, the engine SHALL skip the
  node. The engine SHALL NOT record it as a failure.
- **Acceptance.**
  1. A node whose brief is absent is reported `skipped`.
  2. A skipped node starts no worker.
  3. A skipped node is distinguishable in the report from a node that died.
- **Why.** A requirement that is ruled untestable has no brief on purpose. That is a gap in the work
  to be done, not a failure of a worker.

---

## Workers

#### REQ-PIPE-060 — What the worker was told is kept
- **Requirement.** The engine SHALL write the prompt it gave a worker to a file, one file per
  attempt.
- **Acceptance.**
  1. After an attempt, the prompt is on disk under the run directory.
  2. The file holds the prompt as the worker received it, with placeholders filled.
  3. A second attempt does not overwrite the first attempt's prompt.

#### REQ-PIPE-061 — What the worker printed is kept
- **Requirement.** The engine SHALL write everything a worker prints to a file, one file per
  attempt. The engine SHALL keep both standard output and standard error.
- **Acceptance.**
  1. A worker that prints to standard error leaves that text on disk.
  2. The file exists even when the worker printed nothing.
- **Why.** Worker output went to `/dev/null` for a whole day. Every diagnosis of a stuck worker in
  that day was guesswork.

#### REQ-PIPE-062 — Each attempt has its own transcript directory
- **Requirement.** The engine SHALL give each attempt a directory of its own for the worker's
  transcript. The engine SHALL empty that directory before it starts the worker.
- **Acceptance.**
  1. Two attempts of one node write to different directories.
  2. A re-run of an attempt does not leave the previous run's transcript in the directory.
  3. The directory is under the run directory, not in a store shared with other runs.
- **Why.** A daemon that restores stored sessions on restart will resume hours-old jobs over current
  work. That cost a day. A transcript that survives a re-run is worse than none, because a reader
  cannot tell which run wrote it.

---

## Result objects

#### REQ-PIPE-080 — A result object records one attempt
- **Requirement.** The engine SHALL write one result object for every attempt. The result object
  SHALL record the node, the station, the attempt number, the verdict, the seconds taken, the
  references the attempt was given, and who wrote it.
- **Acceptance.**
  1. Every attempt produces exactly one result object.
  2. The result object names the node, station, and attempt.
  3. The result object says whether the attempt passed or failed.

#### REQ-PIPE-081 — Exiting is not finishing
- **Requirement.** The engine SHALL NOT accept a process exiting as the work being done. The engine
  SHALL accept an attempt only when a valid result object was written.
- **Acceptance.**
  1. A worker that exits zero and writes nothing produces a failed attempt.
  2. A worker that writes an empty file produces a failed attempt.
  3. A worker that writes a file that is not JSON produces a failed attempt.
  4. A worker that writes JSON that is not an object produces a failed attempt.
- **Why.** Nine empty files were once logged as three successful waves.

#### REQ-PIPE-082 — A result says what was done and what comes next
- **Requirement.** A result object SHALL carry a summary and a handoff. Neither SHALL be empty. The
  engine SHALL reject an attempt whose result object is missing either.
- **Acceptance.**
  1. A result with an empty summary is rejected, and the rejection names the field.
  2. A result with an empty handoff is rejected, and the rejection names the field.
  3. A result with fields the engine does not know about keeps them.

#### REQ-PIPE-083 — A result is immutable, and whole
- **Requirement.** The engine SHALL make a result object read-only. The engine SHALL make a result
  object visible only when it is complete. A correction SHALL be a new result object.
- **Acceptance.**
  1. A written result object has no write permission.
  2. A partly written result object is never visible under its final name.
  3. Two runs that did the same thing produce the same bytes.

#### REQ-PIPE-084 — The chain is followable from any result
- **Requirement.** A result object SHALL record references to the results that were its input. The
  engine SHALL hand a node the final results of the nodes it depends on, and the previous station's
  result, by the same mechanism.
- **Acceptance.**
  1. The first station's result records an empty input.
  2. The second station's result records the first station's result.
  3. A node with a dependency records the dependency's final result.
  4. Following the references from any result reaches everything that led to it.

#### REQ-PIPE-085 — A rejection is an ordinary result
- **Requirement.** A failed attempt SHALL produce a result object like any other, with a failed
  verdict and the reason recorded. The engine SHALL hand the retrying worker a reference to that
  result. The engine SHALL NOT compose the reason into the next prompt.
- **Acceptance.**
  1. A failed attempt produces a result object.
  2. That result carries the reason it was rejected.
  3. The next attempt's input is a reference to that result.

#### REQ-PIPE-086 — The engine writes a result when the worker does not
- **Requirement.** When a worker produces no usable result object, the engine SHALL write one in its
  place. The result SHALL say that the engine wrote it.
- **Acceptance.**
  1. A silent worker's attempt still produces a result object.
  2. That result says the engine wrote it, not the worker.
  3. A reader can tell an engine-written result from a worker-written one.
- **Why.** Without this there is a hole in the chain exactly where the trouble was, and the next
  attempt is handed a reference to its grandparent as though nothing had happened.

#### REQ-PIPE-087 — A stand-in says how the worker ended
- **Requirement.** A result the engine wrote in a worker's place SHALL record how the worker's
  process ended and what the worker printed.
- **Acceptance.**
  1. A worker that exits zero having written nothing produces a result recording exit zero.
  2. A worker that exits three produces a result recording exit three.
  3. A worker that printed something has that text in the result.
  4. A worker that printed nothing produces a result saying so.
  5. The result still says that no result object was written.
- **Why.** "No result object was written" is the one fact the reader already had. The exit code
  separates a worker that crashed from one that exited cleanly having done nothing, and those call
  for different responses.

#### REQ-PIPE-088 — A result points at the worker's transcript
- **Requirement.** A result object SHALL carry a reference to the worker's transcript. The reference
  SHALL be relative to the run directory. The reference SHALL be absent when the worker recorded
  nothing.
- **Acceptance.**
  1. A result names a transcript file that exists.
  2. The reference resolves from the run directory.
  3. The reference survives the run directory being moved or copied.
  4. A worker that recorded nothing produces a result with no reference.
- **Why.** A result says what was produced. It cannot say what the worker was thinking when it
  produced nothing, and that is the case a later reader most needs. One attempt ran thirty minutes,
  wrote no file, and left no transcript anybody could inspect.

#### REQ-PIPE-089 — Staging is not visible
- **Requirement.** The engine SHALL give a worker a path to write that is not the result's final
  path. The engine SHALL clear that path after it takes the result.
- **Acceptance.**
  1. A staged file is not readable as a result by a later station.
  2. After an attempt, the staging path is empty.
  3. A later attempt cannot inherit an earlier attempt's staged file.

---

## Evidence and evaluation

#### REQ-PIPE-100 — Evidence that is empty is not evidence
- **Requirement.** When a pass names evidence, the engine SHALL reject an attempt whose evidence is
  missing or empty, whatever else the worker wrote.
- **Acceptance.**
  1. An attempt that writes a valid result but no evidence fails.
  2. An attempt whose evidence file is zero bytes fails.
  3. The rejection names the path it looked at.

#### REQ-PIPE-101 — A pass chooses how it is judged
- **Requirement.** A pass SHALL choose one of three evaluators: the result alone, a command, or a
  reviewer. The engine SHALL default to the result alone.
- **Acceptance.**
  1. A pass with no evaluator is judged on its result and its evidence.
  2. A pass with a command evaluator runs that command.
  3. A pass with a reviewer evaluator launches a reviewer.

#### REQ-PIPE-102 — A command evaluator may expect failure
- **Requirement.** A command evaluator SHALL declare whether it expects the command to pass or to
  fail. The engine SHALL treat the declared outcome as acceptance.
- **Acceptance.**
  1. With `expect: fail`, a command that exits non-zero is accepted.
  2. With `expect: fail`, a command that exits zero is rejected.
  3. The rejection says the command should have failed.
- **Why.** A red test must fail. Evidence on disk proves only that a file was written.

#### REQ-PIPE-103 — The command's output is the reason
- **Requirement.** When a command evaluator rejects an attempt, the engine SHALL record the
  command's exit code and its output as the reason.
- **Acceptance.**
  1. A rejection records the exit code.
  2. A rejection records what the command printed.
  3. A long output is shortened from the end, so the failure itself is kept.

#### REQ-PIPE-104 — A reviewer's verdict is read, and never inherited
- **Requirement.** A reviewer evaluator SHALL write a verdict to a file. The engine SHALL remove a
  previous verdict before an attempt. The engine SHALL reject an attempt for which no verdict was
  written.
- **Acceptance.**
  1. A verdict beginning `PASS` accepts the attempt.
  2. Any other verdict rejects the attempt, and the verdict text is the reason.
  3. An attempt with no verdict file is rejected.
  4. A verdict from an earlier attempt is not read as this attempt's.

---

## Routing and failure

#### REQ-PIPE-120 — A flow routes on the verdict
- **Requirement.** A station SHALL name where a node goes when it passes, and where it goes when it
  fails. A station that names nothing on pass SHALL end the node's flow.
- **Acceptance.**
  1. A node that passes moves to the station named by `on_pass`.
  2. A node that passes a station with `on_pass: null` is finished.
  3. A node that fails moves to the station named by `on_fail.to`.
  4. A station with no `on_fail.to` retries at the same station.

#### REQ-PIPE-121 — Attempts are bounded per station
- **Requirement.** A station SHALL bound the number of attempts a node may make at it. The engine
  SHALL stop attempting once the bound is reached.
- **Acceptance.**
  1. A station allowing two attempts produces at most two results for that node at that station.
  2. No third attempt's result is written.
  3. A node that exhausts its attempts is recorded as dead.

#### REQ-PIPE-122 — Nothing is built on a failure
- **Requirement.** The engine SHALL NOT start a node whose dependency did not finish. Such a node
  SHALL be recorded as blocked.
- **Acceptance.**
  1. A node whose dependency died is recorded as blocked.
  2. A node blocked by a blocked node is also blocked.
  3. No worker starts for a blocked node, and no result is written for it.

#### REQ-PIPE-123 — The exit code states whether the work is done
- **Requirement.** The engine SHALL exit non-zero when any node is not finished. The engine SHALL
  exit zero only when every node finished or was skipped.
- **Acceptance.**
  1. A run in which every node finishes exits zero.
  2. A run with one dead node exits non-zero.
  3. A run with one blocked node exits non-zero.
  4. A run with one skipped node and no failures exits zero.

---

## The record a run leaves

#### REQ-PIPE-140 — Every attempt is in the log
- **Requirement.** The engine SHALL append one line per attempt to a log, with a header naming the
  columns. The line SHALL carry the node, the station, the attempt, the verdict, the seconds, and
  the result reference.
- **Acceptance.**
  1. A run of one node through two stations writes two lines and a header.
  2. Each line names the result object that attempt produced.
  3. A retry appears as its own line.

#### REQ-PIPE-141 — The state is on disk, and is the truth
- **Requirement.** The engine SHALL keep each node's status, station, attempts, input, and final
  result in a file. The engine SHALL write it as the run proceeds.
- **Acceptance.**
  1. The file names every node in the graph.
  2. A node's status is one of the defined statuses.
  3. A finished node records the result it finished on.

#### REQ-PIPE-142 — The report names what went wrong
- **Requirement.** At the end of a run the engine SHALL report the count of each status. The engine
  SHALL name every node that died, was blocked, or never became ready.
- **Acceptance.**
  1. The report gives the total time.
  2. The report gives a count for each status that occurred.
  3. Every dead node is named.
  4. Every blocked node is named.

---

## Resuming

#### REQ-PIPE-160 — Interrupting and starting again continues
- **Requirement.** The engine SHALL continue a run rather than repeat it. The engine SHALL NOT
  repeat work an earlier run finished.
- **Acceptance.**
  1. Running a flow twice leaves the finished node with one attempt.
  2. The second run starts no worker for a finished node.

#### REQ-PIPE-161 — Starting over is asked for
- **Requirement.** The engine SHALL start every node over when it is told to. The engine SHALL NOT
  start over by default.
- **Acceptance.**
  1. With the flag, a finished node runs again.
  2. Without the flag, it does not.

---

## Known gaps

These are recorded so that they are not mistaken for requirements that are met.

1. **A worker that never returns is invisible while it happens.** The engine sees no result, no
   exit, and no signal. Silence and work look the same. There is no requirement here yet because
   the answer is not a deadline — REQ-PIPE-005 rules that out — and the alternative has not been
   specified.
2. **A skipped node does not say why it was skipped.** REQ-PIPE-042 skips a node whose brief is
   absent. A brief that is absent on purpose and a brief that is absent by mistake read the same.
3. **Provider attribution is a separate tool, not part of a run.** Which upstream served a response
   is fetched afterwards from the aggregator, and is not in the result object.
