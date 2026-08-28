<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# Hands-on testing guide — agent-mail

For the lead, testing the current build by hand. Findings go to §8, and from there into
`mail-mcp-identity-spec.md` §7 before the next batch starts.

Current state: 90 automated tests pass; 18 of 22 `FIXLIST.md` items are implemented.
Two critical items are deliberately still open, and §6 shows you how to see them for yourself.

---

## Index of checks

Every check in this guide has a name, and the name is how it is referred to anywhere else —
in the findings log, in the spec, in conversation. This is the map.

### §0 — sandbox safety (scripts)

Run `./scripts/safe-shell.sh` to enter a stubbed shell, or `./scripts/verify-sandbox.sh` inside one.
Both scripts never target a live agent: every wake goes to a generated canary seat name
that is first checked against `prime-agent list`.

| Check | What it shows |
|---|---|
| `stub-wins-path` | `prime-agent` resolves to the sandbox stub, not the real binary |
| `stub-captures-wake` | A canary wake is recorded in `wakes.log`, and the real binary rejects the same canary |
| `mailbox-is-sandboxed` | `AGENT_MAIL_BASE_DIR` lives inside the sandbox, not `week7/mail` |
| `live-agents-untouched` | Live counts are compared; any drift is a WARNING (other agents advance their own counts) — never a failure |
| `end-to-end-wake-captured` | Real server's wake lands in `wakes.log`; 1 attempt = 1 capture; every captured target is absent from the live list |
| `seat-dir-is-isolated` | The seat session's working directory is outside the repo |
| `server-starts-clean` | The registered server completes an MCP handshake with all 11 tools before claude launches |
| `seat-path-is-stubbed` | The PATH stored in the config begins with the sandbox stub dir |

### §1 — readings of the smoke run
No setup; each is one command against the captured log.

| Check | What it shows |
|---|---|
| `service-order` | An interrupt comes back ahead of an earlier `when_ready` |
| `delivery-states` | Four states, four separate timestamps |
| `forgery-refused` | Server-owned fields rejected at the schema, before any mail logic |
| `record-readable` | The envelopes and event log as they sit on disk |

### §2 — ergonomics, judged by hand
The part no automated test can answer. This is the core of the short pass.

| Check | The question |
|---|---|
| `seat-can-self-serve` | Can a seat complete send → inbox → read → ack using only what the tools hand back? |
| `ids-by-hand` | How much copying of ids does the flow demand, and would an agent get it wrong? |
| `turn-cost` | How many calls must a seat make each turn just to stay in protocol? |
| `status-answers-sender` | Does `mail_status` alone tell the sender what to do next, or is a second call needed? |
| `record-tells-the-story` | Can you reconstruct an exchange from the files alone, with no server running? |

### §3 — hand-driven scenarios
Drive the tools yourself and judge the result.

| Check | What it shows |
|---|---|
| `interrupt-jumps-queue` | Mixed classes come back in service order, stably |
| `headers-only` | The inbox never carries bodies |
| `repeat-read` | Reading twice changes nothing |
| `repeat-ack` | The first ack wins; the second cannot rewrite it |
| `worker-cannot-interrupt` | Workers may never interrupt |
| `worker-addresses-own-orch` | Workers reach only their own orchestrator |
| `orch-owns-its-lane` | Orchestrators interrupt only their own workers |
| `closed-kind-list` | An unknown `kind` is refused |
| `server-owns-fields` | A client cannot set `seq`, `id`, `sent_at`, `thread`, or `from` |
| `broadcast-fanout` | One message per group member, sharing one thread |
| `reply-derives-recipient` | A reply addresses itself from the original |
| `audit-is-restricted` | Lead and architect only |
| `audit-hides-bodies` | Audit returns headers, never bodies |
| `blocked-seats` | An unanswered blocking message shows the recipient as BLOCKED |
| `reply-status` | PENDING before the deadline, OVERDUE after |
| `artifact-drift` | An artifact changed after sending reports DRIFTED |
| `survives-restart` | Nothing lost; queue order and `seq` continue |
| `escalation-timing` | Three re-pushes ~60s apart, then one escalation |

### §4 — errors that must name themselves
Each should say what is wrong and what may be done instead.

| Check | The bad input |
|---|---|
| `unknown-message` | Reading an id that does not exist |
| `read-someone-elses` | Reading mail addressed to another seat |
| `status-not-sender` | Status on a message you did not send |
| `bad-disposition` | Ack with no disposition, or an invalid one |
| `worker-needs-escalation-target` | Registering a worker without one |
| `supersede-after-ack` | Superseding a message already closed |
| `launch-without-bootstrap` | Empty mailbox, no lead configured |
| `launch-bad-bootstrap` | Malformed bootstrap JSON |

### §5 — no checks
Reset commands only, for starting a run clean. Nothing to judge.

### §6 — known-open holes
Reproduce only if curious; all three are known and specced.

| Check | The hole |
|---|---|
| `anyone-can-be-anyone` | `caller_seat_id` is self-declared (def-ident-001) |
| `two-servers-collide` | Two processes over one mailbox (def-arch-001) |
| `not-built-yet` | Steering gate unrun; contract text not written |

---

## If you only have twenty minutes

The mTLS batch (`mail-mcp-identity-spec.md`) is about to delete `caller_seat_id`, replace stdio
with an HTTPS daemon, and remove `AGENT_MAIL_BOOTSTRAP`. Testing those surfaces now is wasted
effort. The mail semantics survive the change, but 90 automated tests already cover them.

What is left is the part no test can judge: **ergonomics and error quality.** Run these:

| Run | Why |
|---|---|
| §0 | Mandatory. Stubs `prime-agent` so no wake reaches a live agent. |
| §1 | Baseline (`npm test`, `npm run smoke`), then the **record-readable** check — is the on-disk record legible when you are debugging at 2am? |
| §2 | The core of this pass. Drive the tools by hand and judge whether a seat could realistically use them. |
| §3 — **blocked-seats**, **reply-status**, **artifact-drift**, **escalation-timing** | The four whose *output* an agent must interpret rather than merely succeed at. |
| §4 | All of it. Every error an agent hits must say what is wrong and what may be done instead. |
| §8 | Log what you find. |

Skip §3.1–3.13 and §3.17 (automated tests cover them), and skip §6 — those two holes are known,
specced, and reproducing them teaches nothing new.

The highest-value test is not in this guide at all: **F3-steering-gate-unrun** (REQ-MAIL-013).
It is the only experiment whose result could change *what gets built* rather than reveal a bug.

---

## 0. Safety first — wakes reach real agents

The server pushes wakes by shelling out to `prime-agent send --steer|--follow-up <seat-id>`.
If you register a seat whose id matches anything in `prime-agent list`, **this build will
steer that live agent's session**. The live set changes over time, so never hard-code
agent names anywhere.

Two rules while testing:

1. Never name a test seat after anything in `prime-agent list` — check the current list,
   and prefer generic names like `lead`, `orch`, `worker`, `arch`.
2. Always test inside the sandbox, which puts a stub `prime-agent` first on `PATH` so no
   wake can escape even if you mistype a seat id.

To enter the sandbox (creates a fresh temp directory, installs the stub, self-verifies,
then opens a marked `[agent-mail sandbox]` shell):

```bash
./scripts/safe-shell.sh
```

To prove the current shell is still sandboxed (also run automatically when the sandbox
shell opens; exits non-zero if any check fails):

```bash
./scripts/verify-sandbox.sh
```

`$AGENT_MAIL_SANDBOX/wakes.log` records every wake the server tried to send. On exit the
sandbox shell prints its path, the wake count, and the one-liner to delete it.

---

## 1. Two-minute version

```bash
cd "/Volumes/repo 1/mail-mcp"
npm ci          # first time only
npm test        # 90 tests, all should pass
npm run smoke   # drives the built server over real MCP, throwaway mailbox
```

**Expected on `npm ci`, and not an error:**

```
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   fsevents@2.3.3 (install: (install scripts present))
```

This is npm's supply-chain protection: packages that want to run code at install time are
blocked until approved. npm is reporting that it **skipped** those scripts, not that anything
failed. Neither is needed here — esbuild ships its platform binary as an optional dependency
(`node_modules/@esbuild/darwin-arm64`), and fsevents only accelerates `vitest --watch`, which
this project never uses. Verified: with both scripts unapproved, all 90 tests pass and
`npm run smoke` completes.

**Leave them unapproved.** Declining install-time code from dependencies is the right default
for a project that runs locally by requirement (REQ-MAIL-102) and is about to handle private
keys. If you ever want native file-watching, `npm install-scripts approve fsevents` is the
narrow fix; esbuild never needs it.

`npm run smoke` is the fastest way to see the whole feature set work. It builds, launches the
real server as a subprocess, and walks registration, service order, forgery rejection, topology,
reply/thread/audit, broadcast, and the on-disk record. It stubs `prime-agent` itself, so it is
always safe to run.

### What to actually look at (not just the ✓ marks)

Four checks, each with the command that shows it: **service-order**, **delivery-states**,
**forgery-refused**, and **record-readable**.

The output scrolls past, so capture it first. Everything below reads from that log:

```bash
npm run smoke > /tmp/smoke.log 2>&1; tail -3 /tmp/smoke.log
```

**The service-order check — the interrupt overtakes the queue (REQ-MAIL-004).**

```bash
grep "inbox order" /tmp/smoke.log
```
```
✓ inbox order: interrupt#2 then when_ready#1 (interrupt first, though sent second)
```
The `when_ready` was sent first and holds `seq 1`; the interrupt was sent second and holds
`seq 2` — and it still comes back first.

**Do not read this as proof that interrupts interrupt.** It proves one thing only: when a
recipient *asks* for its queue, the server hands back interrupts first. It says nothing about
whether a busy recipient stops what it is doing. A pull-based server cannot make that happen —
proposal §4 states the limit plainly, and REQ-MAIL-011 delegates the actual preemption to
`prime-agent send --steer`.

Whether steering truly preempts a busy turn has **never been tested** (REQ-MAIL-013, def-proc-001),
and the PRD says that gate blocks ratification: if `--steer` only lands between turns, then
`interrupt` and `when_ready` collapse into one class and the design needs revising. See
not-built-yet in §6.

So the honest reading of this line is: *queue ordering works; preemption is unproven.*

**The delivery-states check — four distinct states, four timestamps (REQ-MAIL-020).**

```bash
grep "states seen" /tmp/smoke.log
```
```
✓ acked: ACTED — states seen: SENT → DELIVERED → READ → ACKED
```
Four transitions, each separately timestamped. "The agent read it" and "the agent acted on it"
are now different facts — the R-2 doorbell deadlock happened because nobody could see the
difference.

**The forgery-refused check — forgery is refused at the schema, not by convention.**

```bash
sed -n '/^4\. The server owns/,/^5\./p' /tmp/smoke.log
```
```
✓ client cannot set seq — rejected: MCP error -32602: Input validation error…
✓ client cannot set from — rejected: MCP error -32602: Input validation error…
✓ unknown kind — rejected: MCP error -32602: Input validation error…
✓ unknown recipient — rejected: Unregistered caller or seat: ghost
```
Note *where* the first three are refused: `-32602` is the MCP protocol's invalid-params error,
raised before any mail logic runs. A client cannot even express these.

**The record-readable check — the record on disk is still human-readable.**

The smoke test prints its throwaway mailbox path on the last line. Capture it, then read it:

```bash
MAILBOX=$(awk '/Inspect the mailbox at/{getline; gsub(/^ +/,""); print}' /tmp/smoke.log)
find "$MAILBOX" -type f | sort          # lane dirs, mail.jsonl, seats.json
cat "$MAILBOX"/deploy/1-*.md            # one envelope, start to finish
```
```
# Message 1: Second in line

- id: efbdc6f4-147a-4c80-935d-df8921acdf39
- seq: 1
- from: orch
- to: worker
- kind: request
- class: when_ready
…
```
The filename itself (`1-orch-to-worker-request.md`) carries seq, sender, recipient, and kind —
the convention agents used to type by hand, now assigned by the server. Then the event log
behind it:

```bash
python3 -c "
import json
for line in open('$MAILBOX/mail.jsonl'):
    e = json.loads(line)
    print(e['type'], e.get('message', {}).get('seq', ''), e.get('state', e.get('push_state', '')))
"
```
```
message_index 1
message_push  DELIVERED
message_state  DELIVERED
…
```
Every state change is an appended event, never an edit. That is what makes the mailbox
replayable after a restart, and what REQ-MAIL-071 immutability rests on.

---

## 2. Driving it by hand

Run the seat as its own Claude session, isolated from the repo, with the sandbox guarantees
intact (must already be inside a sandbox shell — §0):

```bash
npm run seat-session              # seat dir defaults to $AGENT_MAIL_SANDBOX/seat
npm run seat-session /path/to/dir # or anywhere outside the repo
```

The script refuses to run outside a verified sandbox, refuses a seat directory inside the
repo, registers `agent-mail` for that directory, proves the server completes an MCP handshake
with all 11 tools before launching, and re-checks that the stored `PATH` still starts with the
sandbox stub. The seat deliberately runs **outside the repo**: a session with the repo as cwd
can read the source, the specs, and `TESTING.md`, which invalidates the ergonomics test it is
here to perform, and it would share the repo's Claude config and project memory.

The tool surface is 11 tools:

| Tool | Does |
|---|---|
| `mail_register_seat` | Register a seat (lead or architect only) |
| `mail_seats` | List registered seats with role, lane, escalation target |
| `mail_send` | Send to a seat or a `*group` |
| `mail_inbox` | Your queue, interrupts first, headers only |
| `mail_read` | One message in full, marks it READ |
| `mail_ack` | Close a message with a disposition |
| `mail_reply` | Reply; recipient and thread derived from the original |
| `mail_thread` | One thread in `seq` order |
| `mail_status` | Sender's view: state, ack, reply status |
| `mail_audit` | Cross-seat view (lead or architect only) |
| `mail_supersede` | Withdraw a message you sent |

Every call takes `caller_seat_id` — which is exactly the defect §6.1 asks you to exploit.

A useful first session:

```
mail_register_seat  caller_seat_id=lead  id=arch    role=architect    lane=hq      escalation_target=lead
mail_register_seat  caller_seat_id=lead  id=orch    role=orchestrator lane=deploy  escalation_target=arch
mail_register_seat  caller_seat_id=lead  id=worker  role=worker       lane=deploy  escalation_target=orch
mail_send           caller_seat_id=orch  to=worker  kind=request class=when_ready subject="Do the thing" body="Details here."
mail_inbox          caller_seat_id=worker
mail_read           caller_seat_id=worker id=<id from inbox>
mail_ack            caller_seat_id=worker id=<id> disposition=ACTED note="done"
mail_status         caller_seat_id=orch   id=<id>
```

Then look at the disk — this is the part the proposal cares most about:

```bash
find "$AGENT_MAIL_BASE_DIR" -type f | sort
cat "$AGENT_MAIL_BASE_DIR"/deploy/*.md
cat "$AGENT_MAIL_BASE_DIR"/seats.json
wc -l "$AGENT_MAIL_BASE_DIR"/mail.jsonl
```

### What to judge while you do this

The tools work — 90 tests say so. These five questions are about whether a seat can *live* with
them, which is the thing no test asserts. Log anything that makes you hesitate.

| Check | The question | Why it matters |
|---|---|---|
| `seat-can-self-serve` | Can a seat complete send → inbox → read → ack using only what the tools hand back? | If it needs outside knowledge, that knowledge goes back into prompt text — the exact cost this project exists to remove |
| `ids-by-hand` | How much id-copying does the flow demand? | Message ids are UUIDs. An agent copying them between calls is a transcription error waiting to happen |
| `turn-cost` | How many calls per turn just to stay in protocol? | Contract text says call `mail_inbox` every turn. If the floor is three calls, that is a tax on every turn of every seat |
| `status-answers-sender` | Does `mail_status` alone tell the sender what to do next? | The sender's question is always "is it done, blocked, or overdue" — one call should answer it |
| `record-tells-the-story` | Can you reconstruct an exchange from the files alone? | The mail *is* the debugging record. If it needs the server to interpret, that claim fails |

---

## 3. Scenarios worth exercising

Each one maps to a requirement, and each has a *specific* thing to check.

| Check | Do this | Expect |
|---|---|---|
| interrupt-jumps-queue | Send two `when_ready` then two `interrupt` to one seat, then `mail_inbox` | Both interrupts first, each group in `seq` order; a second `mail_inbox` returns the identical order |
| headers-only | `mail_inbox` and read the `body` field | Empty string — headers only, bodies never ride the list |
| repeat-read | `mail_read` the same id twice | Same content; the `READ` timestamp does not move on the second call |
| repeat-ack | `mail_ack` twice with different dispositions | The first ack wins; the second does not rewrite the record |
| worker-cannot-interrupt | Worker sends `class=interrupt` | Rejected — workers may never interrupt |
| worker-addresses-own-orch | Worker sends to `lead`, or to another lane's worker | Rejected — workers address their own orchestrator only |
| orch-owns-its-lane | Orchestrator interrupts a *foreign* lane's worker | Rejected; its own lane succeeds |
| closed-kind-list | `mail_send` with `kind=memo` | Rejected — the kind vocabulary is closed |
| server-owns-fields | `mail_send` with `seq`, `id`, `sent_at`, `thread`, or `from` set | Rejected — the server owns those fields |
| broadcast-fanout | `mail_send` `to=*orchestrators` | One message per orchestrator, independent states, one shared thread |
| reply-derives-recipient | `mail_reply` to a message | Recipient derived automatically; `in_reply_to` set; thread preserved; class defaults to `when_ready` |
| audit-is-restricted | `mail_audit` as `worker` | Rejected — lead and architect only |
| audit-hides-bodies | `mail_audit` as `lead` | Works, and message bodies are blank |
| blocked-seats | Send with `blocks:["do-not-deploy"]`, then audit | `blocked_seats` names the recipient; it clears after the recipient replies |
| reply-status | Send with `expects_reply` and a short `deadline_seconds`, then `mail_status` | `reply_status` PENDING before the deadline, OVERDUE after |
| artifact-drift | Send with `artifacts:["/some/file"]`, then edit that file, then `mail_read` | The artifact reports DRIFTED against its send-time hash |
| survives-restart | Stop the server, restart it, `mail_inbox` | Nothing lost; queue order preserved; `seq` continues without repeats |
| escalation-timing | Send to a seat, wait past the deadline, watch `$SANDBOX/wakes.log` | Re-pushes ~60s apart, three of them, then one escalation message from `agent-mail` |

The escalation-timing check needs patience or a short `deadline_seconds` — the escalation sweep runs on a
timer once per second but only acts on the 60-second re-push window.

---

## 4. Things that should fail — and fail *well*

Bad input should produce an actionable named error, never a stack trace or a silent success.
Worth probing:

| Check | Do this |
|---|---|
| unknown-message | `mail_read` an id that does not exist |
| read-someone-elses | `mail_read` mail addressed to someone else |
| status-not-sender | `mail_status` on a message you did not send |
| bad-disposition | `mail_ack` with no disposition, or `disposition=MAYBE` |
| worker-needs-escalation-target | `mail_register_seat` a worker with no `escalation_target` |
| supersede-after-ack | `mail_supersede` a message that is already acked |
| launch-without-bootstrap | Launch with no `AGENT_MAIL_BOOTSTRAP` on an empty mailbox |
| launch-bad-bootstrap | Launch with `AGENT_MAIL_BOOTSTRAP='not json'` |

If any of these produces a confusing message, that is a finding — the PRD requires named errors.

---

## 5. Reset between runs

```bash
rm -rf "$AGENT_MAIL_BASE_DIR"        # fresh mailbox, seats and all
rm -rf "$SANDBOX"                    # fresh everything
```

Nothing is committed to git; `test-workdir/` churn from test runs is expected.

---

## 6. Known-open holes — try to break these on purpose

These are the two critical items the next batch closes
(`mail-mcp-identity-spec.md`). Demonstrating them validates that the spec is aimed correctly.

### anyone-can-be-anyone (def-ident-001)

`caller_seat_id` is a self-declared parameter. From a client connected as nobody in particular:

```
mail_send   caller_seat_id=lead  to=worker  kind=ruling class=interrupt subject="I am the lead" body="No I am not."
mail_audit  caller_seat_id=lead  seat_a=orch seat_b=worker
mail_inbox  caller_seat_id=worker
```

All of it works. The registration ACL added in the last round is real logic sitting on an
unauthenticated identity — a lock with no wall. This is what mutual TLS replaces.

### two-servers-collide (def-arch-001)

Launch **two** server processes against the same `AGENT_MAIL_BASE_DIR` and send from both.
Because each process holds its own in-memory store and counter, you should be able to produce
duplicate `seq` values, messages invisible to the other client, and interleaved `mail.jsonl`
writes — the Week-3 collision cascade, reproduced inside the tool built to prevent it.

If you can produce a *worse* failure than duplicate seqs here, that is a valuable finding.

### not-built-yet

- Critical sections, queue-depth caps, and per-turn soft limits exist and are tested, but no
  agent-side contract text uses them yet.
- The REQ-MAIL-013 steering gate has never been run: nobody has proven `--steer` actually
  preempts a busy turn. If that proves false, `interrupt` and `when_ready` collapse into one
  class and the PRD needs revision.

---

## 7. What is worth reporting

Anything in these categories:

- A tool that succeeds when it should refuse, or refuses when it should succeed
- An error message that does not name what is wrong or who may do it
- Anything on disk that is unreadable, misnamed, or disagrees with `mail.jsonl`
- A state that looks wrong in `mail_status` or `mail_audit`
- Ergonomics: a call that needs information you should not have to supply by hand
- Anything the PRD requires that you cannot make the server do

Not worth reporting: anyone-can-be-anyone and two-servers-collide (known, specced), and `test-workdir/` churn.

---

## 8. Findings log

Add findings here. They are folded into `mail-mcp-identity-spec.md` §7 and become part of the
next red/green batch.

Give each one an id of the form `F<n>-<what-you-found>` — the number keeps the order, the name
means nobody has to look it up later. Both halves stay fixed once the finding is cited anywhere.
Examples already in the spec: `F1-smoke-proves-ordering-not-preemption`,
`F2-interrupt-cancels-work`, `F3-steering-gate-unrun`.

| Finding | What you did | What happened | What you expected | Severity |
|---|---|---|---|---|
| | | | | |
