#!/usr/bin/env python3
"""Running report of the red-phase run: per wave, and the spread across agents.

The gap column is what the lead asked for. A wave costs its slowest agent, so the gap between
the fastest and the slowest is exactly what a per-requirement (dataflow) schedule would recover.
Each agent writes briefs/done/req-NNN.done when it finishes, so the token mtime is its finish time.
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRAPH = json.loads((ROOT / "scripts" / "waves.json").read_text())
LOG = ROOT / "briefs" / "run-log.tsv"
DONE = ROOT / "briefs" / "done"
TESTS = ROOT / "tests" / "acceptance"

rows = [l.split("\t") for l in LOG.read_text().splitlines()[1:] if l.strip()]
print(f"{'wave':>4} {'reqs':>4} {'time':>6} {'files':>6} {'lines':>6} {'tests':>6} "
      f"{'fastest':>8} {'slowest':>8} {'gap':>6}")
print("-" * 70)
tot_t = tot_gap = tot_lines = tot_tests = tot_reqs = 0
for r in rows:
    w, n, start, secs = int(r[0]), int(r[1]), int(r[2]), int(r[4])
    files = int(r[5])
    reqs = [q for q in GRAPH["wave"] if GRAPH["wave"][q] == w]
    lines = tests = 0
    for q in reqs:
        f = TESTS / f"req-{q}.test.ts"
        if f.exists():
            txt = f.read_text(errors="replace")
            lines += txt.count("\n")
            tests += len([1 for ln in txt.splitlines() if ln.strip().startswith(("it(", "test("))])
    # only tokens written before this wave was logged count as this wave's finish times;
    # a later mtime means an agent from an earlier attempt rewrote it.
    times = [DONE.joinpath(f"req-{q}.done").stat().st_mtime - start
             for q in reqs if (DONE / f"req-{q}.done").exists()]
    times = [t for t in times if 0 < t <= secs + 5]
    fast = min(times) if times else 0
    slow = max(times) if times else 0
    gap = slow - fast
    tot_t += secs; tot_gap += gap; tot_lines += lines; tot_tests += tests; tot_reqs += n
    print(f"{w:>4} {n:>4} {secs:>5}s {files:>3}/{n:<2} {lines:>6} {tests:>6} "
          f"{fast:>7.0f}s {slow:>7.0f}s {gap:>5.0f}s")

print("-" * 70)
done_reqs = sum(1 for f in DONE.glob("*.done"))
print(f"{tot_reqs} of 65 requirements, {tot_lines} lines, {tot_tests} tests, "
      f"{tot_t//60}m{tot_t%60:02d}s elapsed in waves")
if tot_t:
    print(f"waiting on the slowest agent: {tot_gap:.0f}s of {tot_t}s "
          f"({100*tot_gap/tot_t:.0f}%) — the most a dataflow schedule could recover")
