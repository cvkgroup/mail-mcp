#!/usr/bin/env python3
"""Generate the red-phase brief for a wave.

The prose is FROZEN. Only the requirement table changes between waves. A brief is never
hand-edited: if the instructions must change, change them here and regenerate every wave, so
that all 16 stay identical. Changing the rules inside a run destroys the comparison the run
exists to make.

Usage:  python3 scripts/make-red-brief.py <wave-number>
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRAPH = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "scripts" / "waves.json"

TEMPLATE = """# Wave {n} — RED PHASE ONLY

Repo: `{root}`, branch `develop`.

**You are writing tests that fail. You are not implementing anything.** Do not change one line in
`src/`. Do not modify any existing test. Do not delete anything.

Your requirement is reproduced in full below. **You do not need to open any other document.**

## What you already know — do not go and find this out

Everything in this section was learned the hard way by children in an earlier run. It is given to
you so that you do not spend calls rediscovering it. Take it as fact.

**The feature you are testing does not exist.** That is the point. Import it from the path given in
the table and let the import fail. **Do not search `src/` for it.** A child in the earlier run spent
sixteen of its thirty-six calls looking for code that was never there.

**Your file is the only file you touch.** Do not read, open, or list the other test files in your
wave directory. Each child owns one file. In the earlier run one child spent ten of its calls
reading its siblings' work, which is both waste and contamination: the children are meant to be
independent, and copying conventions off each other destroys that.

**Do not leave scratch files** in the wave directory. If you must experiment, do it in `/tmp`.

**Running a test.** `npx vitest run <path-to-your-file>` from the repo root. Do **not** pass
`--reporter=basic` — that is not a reporter name and it kills the run with a startup error, which
costs you a call to discover.

**The repository path contains a space.** Quote every path you pass to a shell.

**Imports need the `.js` extension** even from TypeScript, because this project is ESM.

**Naming a test.** `REQ-MAIL-nnn.n: <the criterion, in your own words>`. The prefix is what makes
the test traceable. Nothing else is required in the name.

**Reporting when you are done.** One call:

```python
import agent_message
await agent_message.send("<your report>")
```

A child in the earlier run spent its last two calls introspecting that API to work this out.

## The work

{count} requirements, {tests} tests. One test for **each acceptance criterion**.

| Requirement | Title | Criteria | File to create |
|---|---|---|---|
{table}

Run one child for each requirement, all at the same time. Each child owns one file and touches
nothing else, so they cannot collide. **Give each child the whole of its requirement text from the
section below** — that is what stops it going to look for it.

## The requirements, in full

{fulltext}

## Rules

1. **Every test names its criterion** as `REQ-MAIL-nnn.n` in the test name. A test that names no
   criterion cannot be traced and does not count.
2. **One criterion, one test.** Do not merge two criteria. Do not split one.
3. **Test the criterion, not a proxy.** A test that asserts a function exists, or that a name is
   spelled a certain way, tests nothing.
4. **Each failure must be the absent feature.** Run them. Read every failure. A failure caused by a
   typo, a bad import, or a missing fixture proves nothing — fix it until it fails for the real
   reason.
5. **If a test passes, leave it passing and report it.** Do not bend a test to make it red. A pass
   is information.
6. **A constraint is tested by what would regress.** Some criteria ask for the absence of something
   — no key file in the record, no call outside loopback, no code path that rewrites a record. A
   test written straight at an absence passes from the first day and can never fail, so it measures
   nothing. Instead name the change that would break the constraint and test for **that**: a package
   added to the dependencies, a client imported into `src/`, a socket opened to an address that is
   not loopback.
7. **For every passing test, say which it is.** Either **already built** — the feature exists and
   the test would fail if someone broke it, and you say what would break it — or **vacuous** — it
   passes only because the thing does not exist in any form. Strengthen a vacuous test using rule 6
   if you can. If you cannot, leave it and say why.

## Acceptance

1. One new file for each requirement in the table, at the path given.
2. {tests} tests, and the count for each requirement matches the table.
3. Every test names its criterion.
4. Every criterion from 1 to N appears exactly once for each requirement — none skipped, none twice.
5. `git diff --stat` shows no change under `src/` and no change to an existing test.

## Report back

- The files, and the count of tests in each.
- **Every failing test: the criterion, and the reason it fails in one line.** "Fails because there is
  no stage list to read" is a reason. "Fails" is not.
- **Every passing test: already built or vacuous**, with the judgement rule 7 asks for.
- Any criterion you could not write a test for, and why.
"""


def main() -> None:
    wave = int(sys.argv[1])
    graph = json.loads(GRAPH.read_text())
    ids = sorted(r for r, w in graph["wave"].items() if w == wave)

    prd = (ROOT / "mail-mcp-prd.md").read_text()
    prd = prd[: prd.index("## Appendix B")]
    info = {}
    for block in re.split(r"(?m)^#### ", prd)[1:]:
        block = re.split(r"(?m)^##+ ", block)[0]
        head = re.match(r"REQ-MAIL-(\d+)\s+—\s+(.*)", block.split("\n", 1)[0].strip())
        if not head:
            continue
        acc = re.search(r"- \*\*Acceptance\.\*\*(.*)$", block, re.S)
        n = len(re.findall(r"(?m)^\s+\d+\.\s", acc.group(1))) if acc else 0
        info[head.group(1)] = (head.group(2), n, "#### " + block.strip())

    rows, tests, listed, full = [], 0, 0, []
    for r in ids:
        title, n, body = info[r]
        full.append(body)
        if n == 0:  # ruled untestable — named so nobody wonders where it went
            rows.append(f"| REQ-MAIL-{r} | {title} | **no test — ruled untestable** | — |")
            continue
        rows.append(
            f"| REQ-MAIL-{r} | {title} | {n} | "
            f"`tests/acceptance/wave-{wave:02d}/req-{r}.test.ts` |"
        )
        tests += n
        listed += 1

    out = TEMPLATE.format(
        n=wave, root=ROOT, count=listed, tests=tests, table="\n".join(rows),
        fulltext="\n\n".join(full),
    )
    dest = ROOT / "briefs" / f"wave-{wave:02d}-red.md"
    dest.write_text(out)
    print(f"{dest}  —  {listed} requirements, {tests} tests")


if __name__ == "__main__":
    main()
