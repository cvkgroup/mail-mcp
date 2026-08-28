#!/usr/bin/env python3
"""Run the red phase wave by wave, one headless process per requirement.

Seven aborted attempts on 2026-08-15/16 all came from the same place: the prime-agent daemon.
Agents outlived the script that started them; `stop` and `shutdown --force` both reported success
while leaving 92 OS processes running; and the daemon restored every stored session on restart, so
agents from earlier attempts came back, resumed old jobs, wrote files for waves that had not run,
and rewrote a finished wave's token 170 seconds after it completed.

`prime-agent -p --no-session` avoids all of it. It is headless, it stores no session so nothing can
be resurrected, and **it exits when it is done**. A process that exits needs no stopping, so there
is nothing to leak, nothing to kill, and no daemon to talk to. Completion is the process exiting,
confirmed by the agent's own token file.

This script dispatches and keeps time. It does NOT inspect the tests — all checking happens after
wave 16, per the lead.

Usage:  python3 scripts/run-waves.py [first-wave] [last-wave]
"""
import json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRAPH = json.loads((ROOT / "scripts" / "waves.json").read_text())
LOG = ROOT / "briefs" / "run-log.tsv"
DONE = ROOT / "briefs" / "done"
TESTS = ROOT / "tests" / "acceptance"
MODEL = ["-p", "--no-session", "--provider", "openrouter",
         "--model", "deepseek/deepseek-v4-flash-0731"]
WAVE_TIMEOUT = 25 * 60


def spawn(req):
    """Start one headless agent for one requirement. It exits when finished."""
    brief = ROOT / "briefs" / f"req-{req}-red.md"
    task = (
        f"Read {brief} and follow it exactly. It is the complete and only instruction — "
        f"everything you need is in it, including your requirement in full. Do not open any "
        f"other document. Do not read any other test file. Write your one file, make its tests "
        f"fail for the right reason, write your completion token, then stop."
    )
    return subprocess.Popen(
        ["prime-agent", *MODEL, "--cwd", str(ROOT), task],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def main():
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    last = int(sys.argv[2]) if len(sys.argv) > 2 else max(GRAPH["wave"].values())
    DONE.mkdir(parents=True, exist_ok=True)
    if not LOG.exists():
        LOG.write_text("wave\treqs\tstarted\tended\tseconds\tfiles\n")
    run_start = time.time()

    for w in range(first, last + 1):
        reqs = sorted(r for r, x in GRAPH["wave"].items() if x == w)
        reqs = [r for r in reqs if (ROOT / "briefs" / f"req-{r}-red.md").exists()]
        if not reqs:
            print(f"wave {w}: nothing to run", flush=True)
            continue

        print(f"\n=== WAVE {w} — {len(reqs)} requirements: {' '.join(reqs)} ===", flush=True)
        start = time.time()
        procs = {r: spawn(r) for r in reqs}
        print(f"  spawned {len(procs)} agents at once", flush=True)

        deadline = start + WAVE_TIMEOUT
        while time.time() < deadline:
            if all(p.poll() is not None for p in procs.values()):
                break
            time.sleep(5)
        else:
            for r, p in procs.items():
                if p.poll() is None:
                    print(f"  !! req-{r} timed out; killing", flush=True)
                    p.kill()

        # A time is recorded only with evidence. Existence alone is not enough — nine empty files
        # were once logged as three successful waves — so the file must be non-empty, and the
        # agent must have written its own token.
        ok = [r for r in reqs
              if (DONE / f"req-{r}.done").exists()
              and (TESTS / f"req-{r}.test.ts").exists()
              and (TESTS / f"req-{r}.test.ts").stat().st_size > 0]
        secs = int(time.time() - start)
        with LOG.open("a") as fh:
            fh.write(f"{w}\t{len(reqs)}\t{int(start)}\t{int(time.time())}\t{secs}\t{len(ok)}\n")
        print(f"=== WAVE {w} DONE in {secs//60}m{secs%60:02d}s — {len(ok)}/{len(reqs)} ===", flush=True)
        missing = sorted(set(reqs) - set(ok))
        if missing:
            print(f"  !! no usable output from: {' '.join(missing)}", flush=True)

    total = int(time.time() - run_start)
    print(f"\nRUN COMPLETE: waves {first}-{last} in {total//3600}h{(total%3600)//60:02d}m", flush=True)


if __name__ == "__main__":
    main()
