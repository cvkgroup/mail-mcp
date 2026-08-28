#!/usr/bin/env python3
"""Per-wave spread between the fastest and slowest agent.

The lead asked for this to judge whether scheduling by individual requirement (dataflow) would
beat scheduling by wave. It is the same question in both cases: a wave costs its slowest member,
so the gap between fastest and slowest is exactly what a dataflow schedule would recover.

Each agent writes `briefs/done/req-NNN.done` when it finishes, so the token's mtime is that
agent's finish time. Wave start comes from the run log.
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRAPH = json.loads((ROOT / "scripts" / "waves.json").read_text())
LOG = ROOT / "briefs" / "run-log.tsv"
DONE = ROOT / "briefs" / "done"

rows = [l.split("\t") for l in LOG.read_text().splitlines()[1:] if l.strip()]
print(f"{'wave':>4} {'n':>2}  {'fastest':>8} {'slowest':>8} {'gap':>7}  {'wave':>6}  wasted")
print("-" * 58)
tot_wave = tot_gap = 0
for r in rows:
    w, n, start, end, secs = int(r[0]), int(r[1]), int(r[2]), int(r[3]), int(r[4])
    reqs = [q for q in GRAPH["wave"] if GRAPH["wave"][q] == w]
    times = []
    for q in reqs:
        t = DONE / f"req-{q}.done"
        if t.exists():
            times.append(t.stat().st_mtime - start)
    if not times:
        continue
    fast, slow = min(times), max(times)
    gap = slow - fast
    tot_wave += secs
    tot_gap += gap
    print(f"{w:>4} {n:>2}  {fast:>7.0f}s {slow:>7.0f}s {gap:>6.0f}s  {secs:>5}s  {100*gap/secs:>4.0f}%")

if tot_wave:
    print("-" * 58)
    print(f"total wave time {tot_wave}s; total gap {tot_gap:.0f}s "
          f"({100*tot_gap/tot_wave:.0f}% of the clock spent waiting on the slowest agent)")
    print(f"a dataflow schedule could recover at most that {100*tot_gap/tot_wave:.0f}%, "
          f"and only where the slow agent is not itself on the critical path")
