#!/usr/bin/env python3
"""Generate the red-phase brief for ONE requirement.

Under the dataflow schedule a requirement is the unit of work, not a wave. A requirement starts
the moment its own predecessors are done, so it needs a brief of its own.

The prose is FROZEN. Only the requirement changes. Briefs are generated, never hand-edited: if
the instructions must change, change them here and regenerate all of them, so every requirement
is given the same instructions. Changing the rules inside a run destroys the comparison.

Usage:  python3 scripts/make-req-brief.py <req-number, e.g. 091>
        python3 scripts/make-req-brief.py all
"""
import json, os, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRAPH = ROOT / "scripts" / "waves.json"

TEMPLATE = """# REQ-MAIL-{req} — RED PHASE ONLY

Repo: `{root}`, branch `develop`.

**You are writing tests that fail. You are not implementing anything.** Do not change one line in
`src/`. Do not modify any existing test. Do not delete anything.

Your requirement is reproduced in full below. **You do not need to open any other document.**

## What you already know — do not go and find this out

Everything here was learned the hard way by workers in an earlier run. It is given to you so that
you do not spend calls rediscovering it. Take it as fact.

**The feature you are testing does not exist.** That is the point. **Do not search `src/` for it.**

**Your module is `{module}`.** Import from exactly that path and nowhere else, written as
`{importpath}` — with the `.js` extension, because this project is ESM. It will not resolve, and
that is the failure you want.

In the first run no module was named, so 65 agents each guessed one and the suite ended up
importing 40 different paths. The tests then described forty systems instead of one. The path
above is not a suggestion.

**Import inside each test, never at the top of the file.** Use `await import(...)` within the test
body. A top-level `import` of a module that does not exist stops the whole file from loading, so
none of its tests register at all and you lose the per-criterion result. Eight files did this in
the first run and 61 tests silently never ran.

**Declare the interface you assume.** At the top of your file, in a comment, list the symbols you
import from your module and the shape of each. You are defining the interface that the
implementation will have to satisfy, so write it down where the next person can read it.

**Your file is the only file you touch.** Do not read, open, or list any other test file. In the
earlier run one worker spent ten of its calls reading the others' work — waste, and worse than
waste: the workers are meant to be independent, and copying conventions off each other destroys
that.

**Do not leave scratch files** anywhere under `tests/`. If you must experiment, do it in `/tmp`.

**Running your test.** `npx vitest run "<your file>"` from the repo root. Do **not** pass
`--reporter=basic` — that is not a reporter name and it kills the run with a startup error.

**The repository path contains a space.** Quote every path you pass to a shell.

**Imports need the `.js` extension** even from TypeScript, because this project is ESM.

**Import the vitest API at the top of your file.** This project does not enable vitest globals, so
`describe`, `it` and `expect` are not defined for you:

    import {{ describe, it, expect }} from "vitest";

Without that line the file loads, registers nothing, and vitest reports `(0 test)` — which reads
like your work failed when in fact it never ran. Every worker in the last run hit this and spent a
call or two working it out. This is the one import that belongs at the top of the file: the rule
above about importing inside each test body is about the module you are testing, not about vitest.

**Naming a test.** `REQ-MAIL-{req}.n: <the criterion, in your own words>`. The prefix is what makes
the test traceable.

**Finishing.** Your instructions say where to write a result object. Write it **last**, after the
test file is complete and you have run it and read the failures. That file is the only thing that
says you are done: a process that ends without one has not finished, it has stopped.

## Your work

Write **one test for each acceptance criterion below — {count} tests**, in exactly one file:

`{path}`

Your module (does not exist yet): `{module}`
Import it as: `{importpath}`

Documents, if a criterion names one:
{artifacts}

## Rules

1. **Every test names its criterion** as `REQ-MAIL-{req}.n`. A test that names no criterion cannot
   be traced and does not count.
2. **One criterion, one test.** Do not merge two. Do not split one.
3. **Test the criterion, not a proxy.** A test that asserts a function exists tests nothing.
4. **Each failure must be the absent feature.** Run them. Read every failure. A failure caused by a
   typo or a bad fixture proves nothing — fix it until it fails for the real reason.
5. **If a test passes, leave it passing and report it.** Do not bend a test to make it red.
6. **A constraint is tested by what would regress.** Some criteria ask for the absence of something.
   A test written straight at an absence passes from the first day and can never fail, so it
   measures nothing. Name the change that would break the constraint and test for **that**: a
   package added to the dependencies, a client imported into `src/`, a socket opened to an address
   that is not loopback.
7. **For every passing test, say which it is** — **already built** (and what would break it) or
   **vacuous** (it passes only because the thing does not exist in any form).
8. **Every test must be falsifiable.** In a comment on each test, state the change that would make
   it pass and the change that would make it fail. If you cannot name a change that would make it
   fail, the test measures nothing — say so in your report rather than writing it.
9. **An empty repository must fail every one of your tests.** That is the whole point of a red
   phase. If a test would pass against an empty repository, it is testing nothing.
10. **When a criterion names a document, use the path given below.** Do not go looking for a file
    that seems close enough. In the first run an agent pointed a contract test at a superseded
    design document, found the words it was searching for, and passed while proving nothing.

## Your requirement, in full

{body}

## What to report

Nobody reads a message from you. The result object is the whole report, and the next handler reads
it instead of reading your work.

**Your instructions name the fields that object must have. It has exactly those and no others.** Do
not invent fields of your own, however well they describe your work: a result that omits a required
field is rejected whatever else it contains, and the attempt is spent. Everything below goes inside
the fields you were given.

Cover all of this, between them:

- The file, and the number of tests in it.
- **Every failing test: the criterion, and the reason it fails in one line.** "Fails because there
  is no stage list to read" is a reason. "Fails" is not.
- **Every passing test: already built or vacuous.**
- Any criterion you could not write a test for, and why.
- The module path your tests import, so the next handler knows what to build.
"""


def load():
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
        info[head.group(1)] = (n, "#### " + block.strip())
    return info


MAP = json.loads((ROOT / "scripts" / "module-map.json").read_text())


def write(req, info):
    n, body = info[req]
    if n == 0:
        return None  # ruled untestable; no brief, no child
    path = f"tests/acceptance/req-{req}.test.ts"
    module = MAP.get(req)
    if module is None:
        raise SystemExit(f"no module mapped for REQ-MAIL-{req}; add it to scripts/module-map.json")
    # the test file sits at tests/acceptance/, so src/ is two levels up
    importpath = "../../" + module.replace(".ts", ".js")
    artifacts = "\n".join(
        f"- {k}: `{v}`" for k, v in MAP["_artifacts"].items() if not k.startswith("_")
    )
    out = TEMPLATE.format(req=req, root=ROOT, count=n, path=path, body=body,
                          module=module, importpath=importpath, artifacts=artifacts)
    dest = ROOT / "briefs" / f"req-{req}-red.md"
    # A clean checkout has no briefs directory, and this is the step that first needs one.
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Written aside and renamed into place, so a brief is either the old one or the new one and
    # never half of either. A worker launching mid-write would otherwise read whatever had been
    # flushed so far, follow an instruction that stops in the middle of a sentence, and leave
    # nothing behind saying that was what happened. The rename is atomic because the aside sits in
    # the same directory, and so on the same filesystem, as the file it replaces.
    aside = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    try:
        aside.write_text(out)
        os.replace(aside, dest)
    finally:
        aside.unlink(missing_ok=True)
    return n


def main() -> None:
    info = load()
    if sys.argv[1] == "all":
        graph = json.loads(GRAPH.read_text())
        total = 0
        skipped = []
        for r in sorted(graph["wave"]):
            n = write(r, info)
            if n is None:
                skipped.append(r)
            else:
                total += n
        print(f"{len(graph['wave']) - len(skipped)} briefs, {total} tests")
        print(f"no brief (ruled untestable): {', '.join(skipped) or 'none'}")
    else:
        print(write(sys.argv[1], info), "tests")


if __name__ == "__main__":
    main()
