#!/usr/bin/env python3
"""Move every node of a dependency graph through a pipeline of specialists.

A general tool. It knows nothing about mail, requirements, or tests.

  A GRAPH says which nodes depend on which. A node cannot start until its dependencies are done.

  A PIPELINE is a set of STATIONS. A station has a worker, an evaluator that decides whether the
  worker achieved the task, a destination on success and a destination on failure. A node moves
  between stations until it leaves the pipeline or runs out of attempts.

  A RESULT OBJECT is what a worker produces. One file, created atomically, in a folder of them.
  It records what the worker made, what the next handler should know, and a reference to the input
  it was given.

  An INPUT is a set of references to result objects.

That last pair is the whole design. A result points back at its input; an input is a set of
references to results. Follow it back from any result and you have everything that led to it — the
previous station for that node, and the dependency nodes it was built on — by one mechanism, with
no special case for either. Nothing is copied forward and nothing grows: a node is handed
references, and reads only what it decides it needs.

  pipeline.py <pipeline> --graph <file> --root <dir>

WHAT THIS INSISTS ON, each learned expensively on 2026-08-15/16:

  - Completion is a valid result object, never a process exiting. Agents have exited leaving an
    empty file, and a file that exists is not a file with anything in it.
  - Result objects are immutable and created atomically — written aside, then moved in. Only a
    whole result is ever visible. A correction is a new result, never an edit.
  - Workers are headless and sessionless, so they exit when done and cannot be resurrected. A
    daemon that restores stored sessions will resume hours-old jobs over current work.
  - A node that leaves the pipeline unfinished BLOCKS its dependents. Building on a failure is how
    a bad result is laundered into a good-looking one.
  - Resumable. State is on disk, so an interrupted run continues rather than repeats.

WHAT THE TOOL COMPOSES: almost nothing. The worker writes its own summary and handoff. The tool
adds only the verdict and the duration when it moves the result in, because those are the two facts
a worker cannot know about itself.

PIPELINE FILE — <root>/pipeline/pipelines/<name>.json

    {
      "start": "red",
      "stations": {
        "red":         {"pass": "red",         "on_pass": "test-review",
                        "on_fail": {"to": "red", "max_attempts": 3}},
        "test-review": {"pass": "test-review", "on_pass": "codegen",
                        "on_fail": {"to": "red", "max_attempts": 3}},
        "codegen":     {"pass": "codegen",     "on_pass": "code-review",
                        "on_fail": {"to": "codegen", "max_attempts": 3}},
        "code-review": {"pass": "code-review", "on_pass": null,
                        "on_fail": {"to": "codegen", "max_attempts": 3}}
      }
    }

  "on_pass": null ends the pipeline for that node. A station may send failures anywhere, including
  backwards or to itself.

PASS FILE — <root>/pipeline/passes/<name>.json

  Required: "prompt". Optional: "evidence", "brief", "brief_command", "evaluator", "runner",
  "provider", "model", "timeout_seconds".

  There is NO time limit unless "timeout_seconds" is set. A worker runs until it finishes. That is
  deliberate: a limit is a policy decision belonging to whoever writes the pass. The cost of having
  none is that a genuinely stuck worker holds its slot until someone intervenes — visible in the
  worker log, which is kept per attempt.

  Prompt placeholders: {node} {root} {result} {input} {brief} {evidence} {attempt}.
    {result}   where the worker must write its result object.
    {input}    the references this node was handed, and where to read them.
    {evidence} the artifact the worker is expected to produce, if the pass names one.

  "runner" is how the worker is executed, injected rather than built in, so a station may use
  prime-agent, another agent CLI, or a shell script:

      "runner": ["bash", "scripts/build-one.sh", "{node}"]

EVALUATORS

    {"kind": "result"}
        A valid result object, plus non-empty evidence if the pass names any. The default.

    {"kind": "command", "run": "npx vitest run '{evidence}'", "expect": "fail"}
        Runs a command. "expect": "pass" (default) wants exit 0; "expect": "fail" wants non-zero,
        which is what a red phase needs. The command's output becomes the rejection reason.

    {"kind": "agent", "prompt": "...", "verdict": "<path>"}
        A reviewing agent writes a verdict file beginning with PASS or FAIL and then its reasons.
        The reasons travel to whichever station comes next.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time

WAITING, WORKING, EVALUATING, FINISHED, DEAD, BLOCKED, SKIPPED = (
    "waiting", "working", "evaluating", "finished", "dead", "blocked", "skipped")

REQUIRED_RESULT_FIELDS = ("summary", "handoff")


# --------------------------------------------------------------------------- graph

def load_graph(path: pathlib.Path) -> dict:
    """A bare JSON mapping, a wrapped one, or a text edge list (`node: dep dep`)."""
    text = path.read_text()
    if path.suffix.lower() == ".json" or text.lstrip().startswith("{"):
        raw = json.loads(text)
        for key in ("dep", "deps", "graph"):
            if isinstance(raw.get(key), dict):
                raw = raw[key]
                break
        dep = {str(k): [str(x) for x in v] for k, v in raw.items()
               if not str(k).startswith("_") and isinstance(v, (list, tuple))}
    else:
        dep = {}
        for line in text.splitlines():
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            node, _, rest = line.partition(":")
            dep[node.strip()] = [d for d in re.split(r"[,\s]+", rest.strip()) if d]
    for node, ds in dep.items():
        for d in ds:
            if d not in dep:
                raise SystemExit(f"graph names {d!r} as a dependency of {node!r} but never defines it")
    seen = set()
    while len(seen) < len(dep):
        ready = [n for n in dep if n not in seen and all(d in seen for d in dep[n])]
        if not ready:
            raise SystemExit(f"graph has a cycle among: {' '.join(sorted(set(dep) - seen))}")
        seen.update(ready)
    return dep


# --------------------------------------------------------------------------- station

class Station:
    def __init__(self, name: str, cfg: dict, root: pathlib.Path, pipeline: str):
        self.name, self.root, self.pipeline = name, root, pipeline
        self.on_pass = cfg.get("on_pass")
        fail = cfg.get("on_fail") or {}
        self.fail_to = fail.get("to", name)
        self.max_attempts = int(fail.get("max_attempts", 3))

        pass_name = cfg.get("pass", name)
        pf = root / "pipeline" / "passes" / f"{pass_name}.json"
        if not pf.exists():
            raise SystemExit(f"station {name!r} needs pass file {pf}, which does not exist")
        p = json.loads(pf.read_text())
        if "prompt" not in p:
            raise SystemExit(f"{pf} has no 'prompt'")
        self.pass_name = pass_name
        self.prompt = p["prompt"]
        self.evidence = p.get("evidence")
        self.brief = p.get("brief")
        self.brief_cmd = p.get("brief_command")
        self.model = p.get("model", "deepseek/deepseek-v4-flash-0731")
        self.provider = p.get("provider", "openrouter")
        # No time limit unless the pass asks for one. A limit here is a policy decision, and it
        # belongs to whoever writes the pass, not to this tool. The default of 1500s was mine and
        # unasked for; worse, a 240s limit in a demo pass killed workers doing a task that takes
        # 96s when it succeeds, and I then reported those kills to the lead as "hangs". A limit
        # invented by the tool manufactures the failures it appears to detect.
        self.timeout = p.get("timeout_seconds")
        self.timeout = int(self.timeout) if self.timeout is not None else None
        self.evaluator = p.get("evaluator", {"kind": "result"})
        self.runner = p.get("runner", [
            "prime-agent", "-p", "--no-session",
            "--provider", "{provider}", "--model", "{model}",
            "--cwd", "{root}", "{prompt}"])

    def _sub(self, node: str) -> dict:
        return {"node": node, "req": node, "root": str(self.root),
                "pipeline": self.pipeline, "station": self.name, "pass": self.pass_name}

    def brief_path(self, node):
        return self.root / self.brief.format(**self._sub(node)) if self.brief else None

    def evidence_path(self, node):
        return self.root / self.evidence.format(**self._sub(node)) if self.evidence else None

    def verdict_path(self, node: str) -> pathlib.Path:
        v = self.evaluator.get("verdict")
        return (self.root / v.format(**self._sub(node))) if v else (
            self.root / "runs" / self.pipeline / "verdict" / self.name / f"{node}.md")


# --------------------------------------------------------------------------- results

class Results:
    """A set of immutable result objects, one file each, created atomically.

    A worker writes its result to a staging path. The tool validates it and moves it into the
    folder, so only a whole result is ever visible and nothing is edited afterwards. Same
    discipline this project requires of its own record, for the same reason.
    """

    def __init__(self, base: pathlib.Path):
        self.dir = base / "results"
        self.staging = base / "staging"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.staging.mkdir(parents=True, exist_ok=True)

    def ref(self, node: str, station: str, attempt: int) -> str:
        return f"{node}-{station}-{attempt}.json"

    def path(self, ref: str) -> pathlib.Path:
        return self.dir / ref

    def staged(self, ref: str) -> pathlib.Path:
        return self.staging / ref

    def take(self, ref: str, verdict: str, seconds: int, extra: dict):
        """Validate what the worker staged, then move it in. Returns (ok, why-not)."""
        src = self.staged(ref)
        if not src.exists():
            return False, f"No result object was written to {src}."
        try:
            obj = json.loads(src.read_text())
        except Exception as e:
            return False, f"The result object at {src} is not valid JSON: {e}"
        if not isinstance(obj, dict):
            return False, f"The result object at {src} is not a JSON object."
        missing = [f for f in REQUIRED_RESULT_FIELDS if not str(obj.get(f, "")).strip()]
        if missing:
            return False, (f"The result object is missing {', '.join(missing)}. Every result must "
                           f"say what was done (summary) and what the next handler needs to know "
                           f"(handoff).")
        obj["verdict"] = verdict      # the two facts a worker cannot know about itself
        obj["seconds"] = seconds
        obj.update(extra)
        tmp = self.dir / (ref + ".tmp")
        tmp.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n")
        os.chmod(tmp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        tmp.replace(self.path(ref))   # atomic: only a whole result becomes visible
        src.unlink(missing_ok=True)
        return True, ""

    def read(self, ref: str) -> dict:
        return json.loads(self.path(ref).read_text())


# --------------------------------------------------------------------------- engine

class Run:
    def __init__(self, pipeline: str, root: pathlib.Path, graph: dict, max_parallel: int):
        pf = root / "pipeline" / "pipelines" / f"{pipeline}.json"
        if not pf.exists():
            have = ", ".join(sorted(p.stem for p in (root / "pipeline" / "pipelines").glob("*.json"))) or "none"
            raise SystemExit(f"no pipeline {pipeline!r} (have: {have})")
        cfg = json.loads(pf.read_text())
        self.name, self.root, self.dep, self.cap = pipeline, root, graph, max_parallel
        self.stations = {n: Station(n, c, root, pipeline)
                         for n, c in cfg["stations"].items() if not n.startswith("_")}
        self.start = cfg["start"]
        for s in self.stations.values():
            for dest in (s.on_pass, s.fail_to):
                if dest and dest not in self.stations:
                    raise SystemExit(f"station {s.name!r} routes to {dest!r}, which does not exist")
        self.dir = root / "runs" / pipeline
        self.dir.mkdir(parents=True, exist_ok=True)
        self.results = Results(self.dir)
        self.state_file = self.dir / "state.json"
        self.log = self.dir / "log.tsv"
        if not self.log.exists():
            self.log.write_text("node\tstation\tattempt\tverdict\tseconds\tresult\n")
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {}
        self.procs = {}

    def st(self, node: str) -> dict:
        return self.state.setdefault(node, {
            "status": WAITING, "station": self.start, "attempts": {},
            "input": [], "final": None})

    def save(self):
        self.state_file.write_text(json.dumps(self.state, indent=2, sort_keys=True))

    # ---- prompt
    def describe_input(self, node: str) -> str:
        refs = self.st(node)["input"]
        if not refs:
            return "You were given no prior results. This is the first station for this node."
        lines = [f"You were handed {len(refs)} result object(s), as files in {self.results.dir}. "
                 f"Read any you think you need. Each one names the input it was given, so you can "
                 f"follow the chain back as far as you want:"]
        for r in refs:
            try:
                o = self.results.read(r)
                lines.append(f"  - {r}  [{o.get('station')}/{o.get('verdict')}] "
                             f"{str(o.get('handoff', ''))[:300]}")
            except Exception:
                lines.append(f"  - {r}")
        return "\n".join(lines)

    def build_prompt(self, s: Station, node: str) -> str:
        d = self.st(node)
        attempt = d["attempts"].get(s.name, 0) + 1
        return s.prompt.format(
            node=node, req=node, root=str(self.root),
            result=self.results.staged(self.results.ref(node, s.name, attempt)),
            input=self.describe_input(node),
            brief=s.brief_path(node) or "", evidence=s.evidence_path(node) or "",
            attempt=attempt)

    # ---- dispatch
    def spawn_worker(self, s: Station, node: str) -> subprocess.Popen:
        """Start the worker, keeping what it says.

        Worker output went to /dev/null for most of 2026-08-16 and every diagnosis of a hang was
        guesswork as a result. It costs a file per attempt to be able to answer "what was it
        doing".
        """
        prompt = self.build_prompt(s, node)
        argv = [a.format(prompt=prompt, provider=s.provider, model=s.model, root=str(self.root),
                         node=node, req=node, brief=s.brief_path(node) or "",
                         evidence=s.evidence_path(node) or "")
                for a in s.runner]
        d = self.dir / "worker-log" / s.name
        d.mkdir(parents=True, exist_ok=True)
        attempt = self.st(node)["attempts"].get(s.name, 0) + 1
        fh = (d / f"{node}-{attempt}.log").open("w")
        (d / f"{node}-{attempt}.prompt.txt").write_text(prompt)
        return subprocess.Popen(argv, stdout=fh, stderr=subprocess.STDOUT)

    def spawn_evaluator(self, s: Station, node: str):
        ev = s.evaluator
        kind = ev.get("kind", "result")
        if kind == "result":
            return kind, None
        if kind == "command":
            cmd = ev["run"].format(node=node, req=node, root=str(self.root),
                                   evidence=s.evidence_path(node) or "")
            out = self.dir / "evalout" / s.name
            out.mkdir(parents=True, exist_ok=True)
            fh = (out / f"{node}.txt").open("w")
            return kind, (subprocess.Popen(cmd, shell=True, cwd=self.root,
                                           stdout=fh, stderr=subprocess.STDOUT), fh)
        if kind == "agent":
            v = s.verdict_path(node)
            v.parent.mkdir(parents=True, exist_ok=True)
            v.unlink(missing_ok=True)
            prompt = ev["prompt"].format(node=node, req=node, root=str(self.root), verdict=v,
                                         evidence=s.evidence_path(node) or "",
                                         brief=s.brief_path(node) or "",
                                         input=self.describe_input(node))
            argv = [a.format(prompt=prompt, provider=s.provider, model=ev.get("model", s.model),
                             root=str(self.root), node=node, req=node,
                             brief=s.brief_path(node) or "", evidence=s.evidence_path(node) or "")
                    for a in ev.get("runner", s.runner)]
            return kind, (subprocess.Popen(argv, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL), None)
        raise SystemExit(f"unknown evaluator kind {kind!r} at station {s.name!r}")

    # ---- verdict
    def evidence_ok(self, s: Station, node: str) -> bool:
        ev = s.evidence_path(node)
        return ev is None or (ev.exists() and ev.stat().st_size > 0)

    def judge(self, s: Station, node: str, kind: str, extra):
        if kind == "result":
            if not self.evidence_ok(s, node):
                return False, f"{s.evidence_path(node)} is missing or empty."
            return True, ""
        if kind == "command":
            proc, fh = extra
            fh.close()
            text = (self.dir / "evalout" / s.name / f"{node}.txt").read_text(errors="replace")
            want_fail = s.evaluator.get("expect", "pass") == "fail"
            ok = (proc.returncode != 0) if want_fail else (proc.returncode == 0)
            ran = s.evaluator["run"].format(node=node, req=node, root=str(self.root),
                                            evidence=s.evidence_path(node) or "")
            if not self.evidence_ok(s, node):
                return False, f"{s.evidence_path(node)} is missing or empty.\n\n{text[-1500:]}"
            return ok, "" if ok else (
                f"The check `{ran}` "
                f"{'should have failed but it passed' if want_fail else 'failed'} "
                f"(exit {proc.returncode}).\n\nIts output:\n\n{text[-3000:]}")
        if kind == "agent":
            v = s.verdict_path(node)
            if not v.exists():
                return False, "The reviewer wrote no verdict, so the work cannot be accepted."
            text = v.read_text(errors="replace").strip()
            passed = text.upper().startswith("PASS")
            return passed, "" if passed else text
        return False, f"unknown evaluator {kind!r}"

    # ---- routing
    def route(self, s: Station, node: str, ok: bool, why: str, secs: int):
        d = self.st(node)
        attempt = d["attempts"].get(s.name, 0) + 1
        d["attempts"][s.name] = attempt
        ref = self.results.ref(node, s.name, attempt)

        taken, complaint = self.results.take(
            ref, "pass" if ok else "fail", secs,
            {"node": node, "station": s.name, "attempt": attempt,
             "input_ref": list(d["input"]),
             "evidence": str(s.evidence_path(node)) if s.evidence_path(node) else None,
             "rejected_because": None if ok else why.strip()})
        if not taken:
            ok, why, ref = False, complaint, None   # no result object is itself a failure

        with self.log.open("a") as fh:
            fh.write(f"{node}\t{s.name}\t{attempt}\t{'pass' if ok else 'fail'}"
                     f"\t{secs}\t{ref or '-'}\n")

        if ok:
            d["input"] = [ref]
            if s.on_pass is None:
                d["status"], d["station"], d["final"] = FINISHED, None, ref
                print(f"  done {node}  ({ref})", flush=True)
            else:
                d["status"], d["station"] = WAITING, s.on_pass
                print(f"  pass {node}  {s.name} -> {s.on_pass}  {secs}s", flush=True)
        else:
            if ref:
                d["input"] = [ref]
            if attempt >= s.max_attempts:
                d["status"], d["station"] = DEAD, s.name
                print(f"  DEAD {node}  {s.name} failed {s.max_attempts}x  {secs}s", flush=True)
                self.block_dependents()
            else:
                d["status"], d["station"] = WAITING, s.fail_to
                print(f"  fail {node}  {s.name} -> {s.fail_to} "
                      f"(attempt {attempt}/{s.max_attempts})  {secs}s", flush=True)
            if not ref:
                print(f"       {complaint.splitlines()[0][:110]}", flush=True)
        self.save()

    def block_dependents(self):
        changed = True
        while changed:
            changed = False
            for n, ds in self.dep.items():
                if self.st(n)["status"] == WAITING and any(
                        self.st(x)["status"] in (DEAD, BLOCKED) for x in ds):
                    self.st(n)["status"] = BLOCKED
                    changed = True

    def deps_clear(self, node: str) -> bool:
        return all(self.st(d)["status"] in (FINISHED, SKIPPED) for d in self.dep[node])

    def seed_input(self, node: str):
        """A node entering its first station is handed the final results of its dependencies."""
        d = self.st(node)
        if not d["input"]:
            d["input"] = [self.st(x)["final"] for x in self.dep[node] if self.st(x)["final"]]

    # ---- main loop
    def go(self, fresh: bool):
        for cmd in {s.brief_cmd for s in self.stations.values() if s.brief_cmd}:
            print(f"preparing: {cmd}", flush=True)
            subprocess.run(cmd, shell=True, cwd=self.root, check=True)

        for n in self.dep:
            d = self.st(n)
            if fresh:
                d.update(status=WAITING, station=self.start, attempts={}, input=[], final=None)
            first = self.stations[self.start]
            if first.brief and not first.brief_path(n).exists():
                d["status"] = SKIPPED
        self.save()

        def counts():
            return {s: sum(1 for v in self.state.values() if v["status"] == s)
                    for s in (WAITING, WORKING, EVALUATING, FINISHED, DEAD, BLOCKED, SKIPPED)}

        c = counts()
        print(f"pipeline {self.name!r}: {len(self.dep)} nodes, {c[FINISHED]} already finished, "
              f"{c[SKIPPED]} skipped, max {self.cap} at once", flush=True)

        t0 = time.time()
        while True:
            for n in sorted(self.dep):
                if len(self.procs) >= self.cap:
                    break
                d = self.st(n)
                if d["status"] == WAITING and self.deps_clear(n):
                    self.seed_input(n)
                    s = self.stations[d["station"]]
                    self.procs[n] = ("work", self.spawn_worker(s, n), s, time.time())
                    d["status"] = WORKING
                    print(f"  -> {n} at {s.name}", flush=True)

            for n, (phase, proc, s, started) in list(self.procs.items()):
                p0 = proc[0] if isinstance(proc, tuple) else proc
                over = s.timeout is not None and time.time() - started > s.timeout
                if p0.poll() is None and not over:
                    continue
                if over and p0.poll() is None:
                    p0.kill()
                if phase == "work":
                    kind, extra = self.spawn_evaluator(s, n)
                    if extra is None:
                        ok, why = self.judge(s, n, kind, None)
                        if over:
                            ok, why = False, f"Timed out after {s.timeout}s. {why}"
                        del self.procs[n]
                        self.route(s, n, ok, why, int(time.time() - started))
                    else:
                        self.procs[n] = ("eval", extra, s, started)
                        self.st(n)["status"] = EVALUATING
                else:
                    ok, why = self.judge(s, n, s.evaluator.get("kind", "result"), proc)
                    del self.procs[n]
                    self.route(s, n, ok, why, int(time.time() - started))

            if not self.procs and not any(
                    self.st(n)["status"] == WAITING and self.deps_clear(n) for n in self.dep):
                break
            time.sleep(3)

        c, total = counts(), int(time.time() - t0)
        print(f"\npipeline {self.name!r} finished in "
              f"{total//3600}h{(total%3600)//60:02d}m{total%60:02d}s")
        print("  " + "  ".join(f"{k}={v}" for k, v in c.items() if v))
        for status, label in ((DEAD, "gave up"), (BLOCKED, "blocked by a dependency"),
                              (WAITING, "never became ready")):
            bad = sorted(n for n in self.state if self.state[n]["status"] == status)
            if bad:
                print(f"  {label}: {' '.join(bad)}")
        print(f"  results: {self.results.dir}")
        sys.exit(1 if any(c[s] for s in (DEAD, BLOCKED, WAITING)) else 0)


def main():
    here = pathlib.Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Run a pipeline of specialists over a dependency graph.")
    ap.add_argument("pipeline")
    ap.add_argument("--graph", default=str(here / "waves.json"))
    ap.add_argument("--root", default=None)
    ap.add_argument("--max-parallel", type=int, default=12)
    ap.add_argument("--only", default="")
    ap.add_argument("--fresh", action="store_true")
    a = ap.parse_args()

    gp = pathlib.Path(a.graph).resolve()
    root = pathlib.Path(a.root).resolve() if a.root else gp.parent.parent
    dep = load_graph(gp)
    if a.only:
        want = {x.strip() for x in a.only.split(",") if x.strip()}
        unknown = want - set(dep)
        if unknown:
            raise SystemExit(f"--only names unknown nodes: {' '.join(sorted(unknown))}")
        dep = {n: [d for d in ds if d in want] for n, ds in dep.items() if n in want}
    Run(a.pipeline, root, dep, a.max_parallel).go(a.fresh)


if __name__ == "__main__":
    main()
