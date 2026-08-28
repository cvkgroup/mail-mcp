<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# Build plan — `agent-mail` MCP server

| Field | Value |
|---|---|
| Status | **PLAN.** How the system in `mail-mcp-prd.md` gets built. It adds no requirement. Where this document and the requirements disagree, the requirements win. |
| Version | 1.0, 2026-08-15 |
| Requirements | `mail-mcp-prd.md`, 68 requirements and 510 acceptance criteria |
| Method | Red/green, mandatory. See `mail-mcp-prd.md` §6. |
| Written in | ASD-STE100 |

---

## 1. The dependency graph

This section is **derived** from §4 of the requirements. It states no new requirement.

### 1.1 How to read this

An arrow `A ← B` means **A cannot be built or tested until B exists**. Two kinds of edge appear:

| Mark | Meaning |
|---|---|
| *(stated)* | The text of the requirement names the other requirement. |
| *(inferred)* | The text does not name it, but the mechanism cannot work without it. This is analysis, made 2026-08-15. Challenge these first if the build order looks wrong. |
| *(code)* | Neither requirement names the other, and neither needs the other to be true. One implementation must still come first, because both change the same code. §1.3.3 lists these. |

A requirement whose only content is documentation is marked **[doc]**. It has dependencies, because
it describes what the others do, but it holds up nothing.

### 1.2 Layers, by area

These layers group the requirements by area, so that a reader can find them. **They are not the
build order.** §3 gives the build order, and it is computed from the edges in §1.3 by the wave rule
of §2.1.

| Layer | What it establishes | Requirements | Reqs | Criteria |
|---|---|---|---|---|
| **L0** | The shape of the code | 148 | 1 | 12 |
| **L1** | Substrate. No mail concept appears. | 091, 134, 112, 117, 005, 103, 104 | 7 | 32 |
| **L2** | Record primitives | 133, 135, 136 | 3 | 29 |
| **L3** | Certificate authority and transport | 113, 126, 127, 110, 102, 090 | 6 | 41 |
| **L4** | Identity on the wire | 111, 002 | 2 | 11 |
| **L5** | Registry and certificate issue | 042, 114, 115, 116, 118, 144 | 6 | 54 |
| **L6** | Message core | 001, 003, 070, 020, 024 | 5 | 43 |
| **L7** | Signatures | 120, 121, 139, 124, 122, 123, 125 | 7 | 52 |
| **L8** | Delivery | 011, 012, 010, 004, 082, 062, 061, 021, 060, 022, 063, 071, 072 | 13 | 87 |
| **L9** | Authorization | 040, 041, 014, 130, 131, 138, 129 | 7 | 45 |
| **L10** | Interrupts and critical sections | 145, 015 | 2 | 21 |
| **L11** | Blocking and conditions | 137, 141, 142, 146, 147, 140, 143 | 7 | 83 |
| — | Withdrawn; nothing to build | 080, 081 | 2 | — |
| **Total** | | | **68** | **510** |

### 1.3 Edges

#### 1.3.1 Requirement edges

**L0 — The shape of the code.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-148 A request path is an ordered list of stages | — |

**L1 — Substrate.** Nothing here depends on anything.

| Requirement | Depends on |
|---|---|
| REQ-MAIL-091 The clock of the server owns time | — |
| REQ-MAIL-134 A file is the unit; the directory is the log | — |
| REQ-MAIL-112 The seat name is in the SAN | — |
| REQ-MAIL-117 Key material on disk | — |
| REQ-MAIL-005 The kind vocabulary is closed | — |
| REQ-MAIL-103 No product data | — |
| REQ-MAIL-104 Output follows ASD-STE100 **[doc]** | — |

**L2 — Record primitives.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-133 The envelope grows | 134 *(inferred: an event record is written the way 134 defines)* |
| REQ-MAIL-135 Damage is found and located | 134 *(inferred: the chain covers records, which 134 creates)* |
| REQ-MAIL-136 Records do not change, four ways | 134 *(stated: read-only before rename)*, 135 *(stated: detection is the fourth way)* |

**L3 — Certificate authority and transport.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-113 The server makes the authority and the architect certificate | 112 *(stated: the SAN format it must use)*, 117 *(stated: owner-only permission)* |
| REQ-MAIL-126 The server makes its own serving certificate | 113 *(stated: the root signs it)*, 112 *(stated: SAN for the bound names)* |
| REQ-MAIL-127 Both ends configure trust | 113 *(stated: the root is the authority)*, 126 *(inferred: a serving certificate must exist to verify)* |
| REQ-MAIL-110 One daemon owns the mailbox | 126, 127 *(inferred: it offers HTTPS, which needs both)* |
| REQ-MAIL-102 Local only | 110 *(inferred: binding is a property of the daemon)* |
| REQ-MAIL-090 Stop and report | 110 *(inferred: "the server is not available" needs a server)* |

**L4 — Identity on the wire.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-111 Identity comes from the TLS peer certificate | 110 *(inferred: a connection must exist)*, 127 *(stated: the peer must be verified)*, 112 *(stated: the name is read from the SAN)* |
| REQ-MAIL-002 The server derives the sender | 111 *(inferred: the authenticated identity comes from there)* |

**L5 — Registry and certificate issue.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-042 Seat registration | 111 *(stated: an unregistered caller is refused, which needs an identity)*, 134 *(inferred: the registry must survive a restart)* |
| REQ-MAIL-114 Registration signs a client-made CSR | 113 *(stated: the authority signs)*, 111 *(stated: from an authenticated architect or orchestrator)*, 042 *(stated: it makes the registry row)* |
| REQ-MAIL-115 Deregistration is revocation | 042 *(stated: role and lane are read from the registry)*, 114 *(inferred: a certificate must exist to make useless)* |
| REQ-MAIL-116 Certificates have a long life | 114, 115 *(stated: removal is by deregistration, not expiry)* |
| REQ-MAIL-118 Secrets do not enter the record | 114 *(stated: after a registration that makes a key)*, 133 *(inferred: a record must exist to stay out of)* |
| REQ-MAIL-144 Harness-agnostic by construction | 042 *(stated: the registry holds the `wake_command`)* |

**L6 — Message core.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-001 The server assigns identity and order | 091 *(stated: `sent_at` is the server clock)*, 110 *(stated: one counter needs one process)* |
| REQ-MAIL-003 The recipient is named and checked | 042 *(stated: `to` names a registered seat)*, 001 *(inferred: a send must exist to refuse)* |
| REQ-MAIL-070 The record is files | 134 *(inferred: files are written the way 134 defines)*, 042 *(stated: the lane directory of the recipient)*, 001 *(stated: the name holds the sequence number)* |
| REQ-MAIL-020 Four states | 001 *(inferred: a message must exist to hold a state)*, 133 *(stated: each change is its own record)* |
| REQ-MAIL-024 Each message expects a reply | 001 *(stated: the server sets `thread`)*, 133 *(inferred: closing is an event beside the message)* |

**L7 — Signatures.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-120 Each message carries a signature from its sender | 114 *(inferred: the seat needs a key and a certificate)*, 111 *(stated: checked against the certificate the connection holds)*, 001 *(stated: it covers what the client wrote, not what the server adds)* |
| REQ-MAIL-121 The server signs the fields that it adds | 120 *(stated: it signs over the sender signature)*, 001 *(stated: the fields it adds)*, 113 *(inferred: the server key chains to the root)* |
| REQ-MAIL-139 The per-seat shim holds the key and signs | 114 *(inferred: the shim holds the seat key)*, 127 *(stated: it speaks mutual TLS)*, 120 *(stated: it makes the signatures)* |
| REQ-MAIL-124 What is needed to check travels with it | 120, 121 *(stated: it returns both signatures)* |
| REQ-MAIL-122 The record can be checked with no server | 120, 121 *(stated: it checks both)*, 070 *(inferred: it reads the files)*, 134 *(inferred: it needs whole records)*, 113 *(stated: the trusted root)* |
| REQ-MAIL-123 The record outlives the session, the seat, and the certificate | 122 *(stated: the checking program)*, 121, 115 *(stated: a removed seat still checks)* |
| REQ-MAIL-125 What signatures prove **[doc]** | 120, 121, 122, 123, 124 |

**L8 — Delivery.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-011 The wake is a courtesy | 144 *(stated: the `wake_command` from the registry)*, 020 *(stated: a failed push sets `push_state`)*, 042 *(inferred: the registry names the recipient)* |
| REQ-MAIL-012 The wake carries no content | 011 *(stated: it constrains the pushed text)* |
| REQ-MAIL-010 Two delivery classes | 001 *(inferred: the class rides on a message)*, 011 *(stated: it records the time of the wake)*, 020 *(stated: the next mail action)* |
| REQ-MAIL-004 Service order is defined | 001 *(stated: by increasing `seq`)*, 010 *(stated: interrupts before when-ready)* |
| REQ-MAIL-082 One pickup takes all outstanding mail | 004 *(stated: it returns them in that order)*, 020 *(stated: it sets each to READ)*, 124 *(stated: each returned message carries its signature)* |
| REQ-MAIL-062 Read the queue before other work | 082 *(inferred: it is the call being described)* |
| REQ-MAIL-061 The queue survives a restart | 134 *(inferred: persistence)*, 020 *(stated: a restart keeps the state)*, 001 *(stated: the counter continues)* |
| REQ-MAIL-021 The disposition is explicit | 020 *(stated: an ack makes the message ACKED)* |
| REQ-MAIL-060 Repeated calls are safe | 020, 021 *(stated: a second ack keeps the first disposition)* |
| REQ-MAIL-022 Read receipts replace the `Seen:` header | 020 *(inferred: the read state is what it reports)* |
| REQ-MAIL-063 Supersede | 020 *(stated: read and unread are treated differently)*, 021 *(stated: an acked message cannot be superseded)* |
| REQ-MAIL-071 A sent message is never edited | 133 *(inferred: the body is written once)*, 136 *(inferred: enforcement lives there)* |
| REQ-MAIL-072 Artifact integrity | 120 *(stated: the hash is covered by the signature)*, 001 *(inferred: taken at the moment of the send)* |

**L9 — Authorization.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-040 Access control | 042 *(inferred: role and lane come from the registry)*, 111 *(inferred: the caller must be identified)*, 003 *(inferred: the recipient must be resolved to be judged)* |
| REQ-MAIL-041 Who may interrupt | 040 *(inferred: the same boundary check)*, 010 *(stated: it constrains the class)* |
| REQ-MAIL-014 Broadcast | 001 *(stated: its own `id` and `seq` for each)*, 003 *(stated: `to` may name a group)*, 040 *(stated: it checks the access rules for each recipient)*, 011 *(stated: one wake for each)* |
| REQ-MAIL-130 An orchestrator may make workers | 114 *(stated: it registers and gets a certificate)*, 042 *(stated: role, lane, escalation target)*, 040 *(inferred: the refusal is the same boundary)* |
| REQ-MAIL-131 A seat may not give more than it holds | 130 *(inferred: it constrains what 130 permits)* |
| REQ-MAIL-138 Permission is given when a seat is made | 042, 114 *(stated: written with the key, certificate, contract, and registry row)* |
| REQ-MAIL-129 No seat waits for a person with no end | 138 *(stated: the whole set of tools is granted when the seat is made)* |

**L10 — Interrupts and critical sections.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-145 A critical section holds a message | 010 *(stated: it holds interrupts and passes when-ready)*, 020 *(inferred: delivery state)*, 011 *(inferred: the held message is delivered later)* |
| REQ-MAIL-015 An interrupt cancels the work that it interrupts | 020, 021 *(stated: READ and unacked becomes ACKED with a disposition)*, 010 *(stated: on delivery of an interrupt)*, 145 *(stated: a held interrupt preempts nothing until release)* |

**L11 — Blocking and conditions.**

| Requirement | Depends on |
|---|---|
| REQ-MAIL-137 Two block forms | 001 *(inferred: a block is made by a send)*, 133 *(stated: the block record does not change)*, 042 *(inferred: a block names a seat)* |
| REQ-MAIL-141 The server holds the condition | 137 *(stated: the condition lives in the block record)*, 133 *(stated: each evaluation is in the record)* |
| REQ-MAIL-142 The outcome of a condition | 141 *(inferred: the outcome belongs to the block the server holds)* |
| REQ-MAIL-146 How a condition runs | 142 *(stated: the exit code sets the outcome)* |
| REQ-MAIL-147 The lifetime of a condition | 146 *(stated: a restart stops a running script and releases the lock)*, 024 *(stated: closing a session, which is the thread)* |
| REQ-MAIL-140 Condition scripts run with no limits | 146 *(inferred: it constrains the child process that 146 starts)* |
| REQ-MAIL-143 Scripts are asked to change nothing **[doc]** | 140 *(inferred: it is the counterpart of the absent sandbox)* |



#### 1.3.2 Implementation dependencies

These are real dependencies that the requirement text does not state. One implementation genuinely
needs another to exist. They are *(inferred)*, so challenge them first if the order looks wrong.

| Edge | Why |
|---|---|
| REQ-MAIL-014 ← 120, 121, 010, 072 | broadcast multiplies a send, so every behaviour of a single send must already be right |
| REQ-MAIL-082 ← 063, 145, 015 | the pickup must know every reason a message is not outstanding: superseded, held, preempted |
| REQ-MAIL-015 ← 060 | preemption writes an ack, so the ack must already be safe to repeat |
| REQ-MAIL-070 ← 133 | the layout of a message file is the envelope |
| REQ-MAIL-118 ← 070 | there must be message files for a secret to stay out of |
| REQ-MAIL-071 ← 070 | a sent message is a file |
| REQ-MAIL-061 ← 070 | the queue that survives a restart is the files |
| REQ-MAIL-072 ← 070 | the artifact record lives in the envelope file |
| REQ-MAIL-022 ← 042 | `mail_audit` reports across seats |
| REQ-MAIL-122 ← 133 | the checker rebuilds a message from its event records |
| REQ-MAIL-141 ← 011 | it wakes the blocked seat when a condition clears |
| REQ-MAIL-146 ← 011 | it sends the obligee a message when a run ends |
| REQ-MAIL-138 ← 130 | the launcher provisions a seat that an orchestrator made, and not only one the architect made |
| REQ-MAIL-131 ← 138 | it constrains the grant that provisioning writes |

REQ-MAIL-148 is also a predecessor of every requirement that adds a stage to a request path — the
send, the pickup, the read, the ack, and the registry tools. That is 27 edges, and they are not
listed one by one. The rule is simple: if a requirement adds a check or an action to a request
path, it needs the stage list first.

#### 1.3.3 Code edges

These edges are not in the requirements. They exist because two implementations change the same
code, so one must come first even though neither depends on the other. Without them a wave holds
work that two people cannot do at the same time, and the wave stops being what §2.1 says it is.

Fourteen more edges are real dependencies that the requirement text does not state — broadcast needs
a complete single send before it multiplies one, the pickup needs to know every reason a message is
not outstanding, and so on. Those are in §1.3.2.

The edges below are different. They carry no meaning about the design, and each direction is a
choice rather than a fact. The rule used is: the requirement that the graph already places earlier
goes first.

| Edge | Code | Why |
|---|---|---|
| REQ-MAIL-117 ← REQ-MAIL-112 | ca | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-114 ← REQ-MAIL-126 | ca | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-147 ← REQ-MAIL-140 | conditions | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-135 ← REQ-MAIL-133 | record | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-070 ← REQ-MAIL-136 | record | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-071 ← REQ-MAIL-061 | record | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-118 ← REQ-MAIL-071 | record | Both change the same code. Neither needs the other to be true. |
| REQ-MAIL-111 ← REQ-MAIL-102 | tls | Both change the same code. Neither needs the other to be true. |

**Everything else is free because of REQ-MAIL-148.** A request path is an ordered list of stages,
one module for each. So a requirement that adds a check to the send path adds a file, and does not
edit a function that another requirement is also editing. Without that requirement this table would
hold 33 more edges, the build would need 25 waves instead of 16, and no wave would hold more than 5
requirements. §4.1 gives the numbers.

### 1.4 Cycles, and how each resolves

Five pairs point at each other. None is a deadlock. Each one splits into a smaller first step.

| Cycle | Why it looks circular | How it resolves |
|---|---|---|
| **113 ↔ 042 ↔ 114** | 113 registers the architect, which needs the registry. 042 refuses an unregistered caller, which needs an identity. 114 needs the authority that 113 makes. | Build the registry **store** first, with no tool on it. 113 then writes the architect row directly at launch. 114 comes last, and is the only tool that adds a row. |
| **004 ↔ 082** | Criterion 004.6 points at 082. 082 returns messages in the order that 004 gives. | Build 004 first. It is only an ordering rule. The pointer in 004.6 is a cross-reference, not a dependency. |
| **020 ↔ 011** | 020 says that a push which succeeds sets DELIVERED. 011 says that a push which fails sets `push_state`. | Build 020 with SENT and READ only. Then wire the push in 011, and add DELIVERED. |
| **138 ↔ 129** | 138 needs a mode that does not wait. 129 needs a grant that is complete. | Build 138 first. 129 is the test, for each harness, that proves the mode which 138 assumed. |
| **110 ↔ 111** | 110 serves HTTPS. 111 reads the peer certificate from it. | This is not a cycle. 113, 126, and 127 all come before 110, and 111 comes after it. |

### 1.5 The critical path

The longest chain is sixteen deep, which is the same as the number of waves. No requirement waits
longer than its own dependencies force:

`112 → 117 → 113 → 126 → 127 → 110 → 102 → 111 → 042 → 144 → 011 → 010 → 145 → 015 → 082 → 062`

Read as names: the SAN format, then key files on disk, then the authority, the serving certificate,
trust at both ends, the daemon, the loopback bind, identity from the peer certificate, the registry,
the harness-agnostic wake command, the wake itself, the two classes, the critical section, the
preemption, the pickup, and finally the tool description that tells a seat to read its mail.

Each requirement up to the daemon is one thread of work with no way to split it. The graph opens
after the registry.

### 1.6 Tracks, by area

The five tracks below group the work by area. **They are not the build order** — §3 is. They are
kept because they show which parts of the system a reader can think about separately.

| Track | Requirements |
|---|---|
| **A — Signatures** | 120, 121, 139, 124, 122, 123, 125 |
| **B — Delivery and state** | 020, 021, 060, 022, 063, 011, 012, 010, 004, 082, 062, 061, 071, 072 |
| **C — Authorization** | 040, 041, 014, 130, 131, 138, 129 |
| **D — Interrupts** | 145, 015 |
| **E — Blocking** | 137, 141, 142, 146, 147, 140, 143 |

Under REQ-MAIL-148 these tracks no longer collide in code the way they once did. Track A adds
signing and verifying stages to the send path; Track B adds state and push stages to the same path;
they meet in the stage list and nowhere else.

---

## 2. How the build runs

### 2.1 The rule for a wave

The build goes in **waves of dependencies**. Ruled by the lead, 2026-08-15:

> A wave holds **every requirement whose predecessor requirements are all satisfied**.

Nothing else selects the contents of a wave. The wave is computed from the graph in §1, and no
person groups it by theme, by area, or by convenience. This gives one property that matters more
than any other:

**No requirement in a wave depends on any other requirement in the same wave.** They are
independent by construction. Therefore a wave can be split across workers with no order between
them, and no worker waits for another to finish.

The graph gives 13 waves. That number is the same as the depth of the critical path in §1.5, which
confirms that no requirement is left waiting longer than its dependencies force.

### 2.2 The two phases of a wave

Each wave has a red phase and then a green phase. The whole wave completes one phase before it
starts the next.

**Red phase.** Write a test for **each acceptance criterion of each requirement in the wave**. Run
them. Each one must fail. Read each failure and confirm that it fails because the feature is
absent, and not because of a name that is wrong, a missing file, or an accident of setup. A red
test that fails for the wrong reason proves nothing, and the earlier round of work produced
several.

The red phase ends with a written statement that gives, for each criterion, the test that covers it
and the reason that it now fails.

**Green phase.** Implement until each test in the wave is green, and then until the whole suite is
green. Take one requirement at a time. Do not start the next requirement while the tests of the
last one are red.

The green phase ends with a mutation check: change the new code in a scratch copy, and confirm that
a test fails. A green test that survives a mutation of the code that it covers is not a test.

### 2.3 Why the phases are separated

If one worker writes a test and its implementation together, the test records what the code does.
It does not record what the requirement asks for. To write each test in the wave first, and to see
each one fail, is what keeps the test bound to the criterion.

### 2.4 A constraint is tested by what would regress

Some requirements ask for the **absence** of something: the server makes no AWS call (REQ-MAIL-103),
the server sends nothing outside loopback (REQ-MAIL-102), no key file is inside the record
(REQ-MAIL-117), no code path opens a published record for writing (REQ-MAIL-136).

A test written directly against an absence passes on the first day and can never fail, because there
is no feature to break. "The server makes no AWS call" is true of a server that makes no call at
all. Such a test sits in the suite and looks like coverage while it measures nothing.

**Test the change that would regress.** For the AWS limit: no AWS package in the dependencies, no
AWS client imported in `src/`, no socket opened to an address that is not loopback. Each of those
fails on the day somebody adds an AWS client, which is the real risk, and keeps failing until it
goes.

The rule: name the change that would break the constraint, and write the test that catches **that**.

*Found in the Wave 1 red phase, 2026-08-15: two of its seven passing tests were of this kind.*

### 2.5 Every test names its criterion

Each test SHALL name the criterion that it covers, in the form `REQ-MAIL-nnn.n`. Coverage is then
measured, and not assumed. A test that names no criterion is a test that nobody can trace.

### 2.6 When a wave is complete

A wave is complete when all five are true:

1. Each criterion of each requirement in the wave has a test that names it.
2. Each of those tests failed in the red phase, for the right reason.
3. Each of those tests is now green.
4. The whole suite is green.
5. A mutation of the new code makes at least one new test fail.

Only then does the next wave start. A wave that is partly complete does not release the next wave,
because the next wave is defined as the requirements whose predecessors are **satisfied**.

### 2.7 If a wave cannot be completed

Stop. Do not carry an unfinished requirement into the next wave, and do not remove it from the wave
to make the wave pass. Report which criterion cannot be met and why. A requirement that turns out
to be wrong is a change to `mail-mcp-prd.md`, which the lead rules on, and the graph is then
computed again.

### 2.8 A wave is not always safe to split across working trees

Requirements in one wave are independent **as requirements**. They are not always independent **as
code**. Wave 9 holds both REQ-MAIL-120, which adds a signature to the send path, and REQ-MAIL-011,
which adds a push to the same path. Two workers in one tree would collide there.

Therefore: split a wave by worker freely, and give each worker its own working tree where two
requirements touch one file. §4 names the collisions that are known.

### 2.9 What the lead checks

The lead is not a seat and does not call tools. The lead reads files. Each wave therefore ends with
a **record that a person can read**, and not with a report from a worker that says the work is
done. `TESTING.md` holds the form of that check.

---

## 3. The waves

### Wave 0 — Clear the ground

This wave closes no requirement. It removes code that the requirements no longer ask for, and it
measures what is left. It has no red phase, because it adds no behaviour.

**0.1 — Remove what the design abandoned.** Delete `src/escalation.ts` and every import of it. Remove
`deadline_seconds`, `expects_reply`, `reply_status`, `ttl_seconds`, and the escalation ladder.
Remove the soft send limit of the withdrawn REQ-MAIL-081. Remove the current `blocked_seats`
implementation. Delete the tests that assert the removed behaviour.

- **Done when.** No `setInterval` and no `setTimeout` loop is in `src/`. No reference to any removed
  field is in `src/` or `tests/`. `npm test`, `npm run build`, and the smoke test all pass.
  `git diff --stat` shows deletions only. The report gives the count of tests before and after.
- **Watch for.** A worker that repairs what it should delete. The blocking code is **not**
  repairable, because the design changed. Waves 10 to 16 rebuild it.

**0.2 — Map the tests that survive.** State which remaining test covers which criterion, and which
covers none.

- **Done when.** Each remaining test names a criterion or is listed as covering none. The list of
  criteria with no test is written down.
- **Watch for.** A test that appears to cover a criterion and does not. The earlier round produced a
  test that passed because an empty registry refused the call for an unrelated reason. Read the
  assertion, and not the name of the test.

*The brief for 0.1 is written and is not yet given to a worker.*

### Wave 1 — Substrate and the shape of the code

**Delivers.** A clock, an atomic record, a certificate name format, and the rule that a request path is a list of stages.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-091 | The clock of the server owns time | 4 |
| REQ-MAIL-103 | No product data | 3 |
| REQ-MAIL-104 | Output follows ASD-STE100 | — |
| REQ-MAIL-112 | The seat name is in the Subject Alternative Name | 6 |
| REQ-MAIL-134 | A file is the unit; the directory is the log | 10 |
| REQ-MAIL-148 | A request path is an ordered list of stages | 12 |
| | **6 requirements** | **35** |

**Watch for.** REQ-MAIL-148 comes first for a reason. Every later request-path requirement adds a stage to a list that this wave creates. If it is built late, the requirements that should have been stages become edits to one function, and the waves collapse back into a chain.

### Wave 2 — Keys, kinds, and an envelope that grows

**Delivers.** Key files that only their owner reads, a closed list of kinds, and an envelope that is written once.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-005 | The kind vocabulary is closed | 4 |
| REQ-MAIL-117 | Key material on disk, and the risk that stays | 5 |
| REQ-MAIL-133 | The envelope grows; it is never rewritten | 10 |
| | **3 requirements** | **19** |

**Watch for.** The order of read-only and rename in REQ-MAIL-134 was set in Wave 1, and REQ-MAIL-133 must not undo it. A record is made read-only **before** it becomes visible.

### Wave 3 — The authority, and damage that is found

**Delivers.** A root certificate authority that the launch makes, and a chain that finds a changed byte.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-113 | The server makes the authority and the architect certificate at launch | 12 |
| REQ-MAIL-135 | Damage is found, located, and never ignored | 10 |
| | **2 requirements** | **22** |

**Watch for.** REQ-MAIL-113 registers the architect, and the registry arrives in Wave 9. The launch writes the architect row **directly** into the store. `mail_register_seat` comes in Wave 10 and is the only tool that adds a row.

### Wave 4 — The serving certificate, and records that do not change

**Delivers.** A certificate for the server itself, and immutability enforced four ways.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-126 | The server makes its own serving certificate | 5 |
| REQ-MAIL-136 | Records do not change, enforced four ways | 9 |
| | **2 requirements** | **14** |

**Watch for.** Two criteria of REQ-MAIL-136 are searches of the source, and not behaviour. A worker that tests only behaviour closes half of it.

### Wave 5 — Trust at both ends

**Delivers.** A client and a server that each verify the other.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-127 | Both ends configure trust; no one disables verification | 8 |
| | **1 requirements** | **8** |

**Watch for.** The shortcut. A self-signed root gives one error that is easy to predict, and `rejectUnauthorized: false` removes it. That shortcut makes the whole identity design an ornament. The test that searches the repository for the flag and for its environment variable belongs in this wave.

### Wave 6 — The daemon

**Delivers.** One long-lived process, on loopback, over HTTPS, that many clients reach.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-110 | One daemon owns the mailbox | 9 |
| | **1 requirements** | **9** |

**Watch for.** This wave holds one requirement and it is the narrowest point of the build. Every later wave waits on it. It is also what the earlier round missed: 90 tests were green while the shipped server could not be used, because no test started the program the way a person starts it. End this wave with a launch that a person performs.

### Wave 7 — Order, and the limits of the server

**Delivers.** Sequence numbers that the server owns, a loopback-only bind, and a seat that stops and reports.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-001 | The server assigns identity and order | 13 |
| REQ-MAIL-090 | Stop and report; never write files by hand | 4 |
| REQ-MAIL-102 | Local only | 3 |
| | **3 requirements** | **20** |

**Watch for.** REQ-MAIL-001 asks for 1000 sends at the same time to give 1000 different sequence numbers with no gap. This is the Week-3 collision cascade, and it is the failure that the project exists to stop. Test it under real concurrency, and not in a loop.

### Wave 8 — Identity, state, and the thread

**Delivers.** A server that knows which seat calls it, a message state model, and a thread that its opener closes.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-020 | Four states | 8 |
| REQ-MAIL-024 | Each message expects a reply; the opener closes the thread | 8 |
| REQ-MAIL-111 | Identity comes from the TLS peer certificate | 7 |
| | **3 requirements** | **23** |

**Watch for.** Build REQ-MAIL-020 with SENT and READ only. DELIVERED arrives with the push in Wave 11, because a push that succeeds is what sets it.

### Wave 9 — Seats, senders, and dispositions

**Delivers.** A registry of seats, a sender that the server derives, and an ack that states what happened.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-002 | The server derives the sender; the client does not declare it | 4 |
| REQ-MAIL-021 | The disposition is explicit | 8 |
| REQ-MAIL-042 | Seat registration | 11 |
| | **3 requirements** | **23** |

**Watch for.** REQ-MAIL-002 and REQ-MAIL-042 are both stages on a request path. They are independent only because Wave 1 made that true. If either is written as an edit to a shared handler, this wave stops being parallel.

### Wave 10 — Registration, the record, and the first blocks

**Delivers.** A seat that makes its own key and gets a certificate, a mailbox that a person can read as files, and a block that marks the right seat.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-003 | The recipient is named and checked | 5 |
| REQ-MAIL-022 | Read receipts replace the `Seen:` header | 3 |
| REQ-MAIL-060 | Repeated calls are safe | 6 |
| REQ-MAIL-063 | Supersede | 7 |
| REQ-MAIL-070 | The record is files, and a person can read them | 9 |
| REQ-MAIL-114 | Registration signs a client-made CSR; private keys do not move | 19 |
| REQ-MAIL-137 | Two block forms, with opposite subjects | 14 |
| REQ-MAIL-144 | Harness-agnostic by construction | 7 |
| | **8 requirements** | **70** |

**Watch for.** REQ-MAIL-114 holds 19 criteria, the most of any requirement. Nine of them say that a private key is not in a request, a response, a log line, or a file. Test each one. A key that reaches a log is the failure this requirement exists to stop. This is also the widest wave so far: eight requirements, and each one is independent.

### Wave 11 — The wake, the topology, and the sender signature

**Delivers.** Mail that arrives without depending on the wake, a topology the server enforces, and a message that proves who wrote it.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-011 | The wake is a courtesy, not the delivery mechanism | 7 |
| REQ-MAIL-040 | Access control | 7 |
| REQ-MAIL-061 | The queue survives a restart and an idle seat | 6 |
| REQ-MAIL-115 | Deregistration is revocation | 8 |
| REQ-MAIL-120 | Each message carries a signature from its sender | 11 |
| | **5 requirements** | **39** |

**Watch for.** Two things. REQ-MAIL-011 must add **no timer** — the server watches no clocks, and a retry timer on the push rebuilds what this design deleted. REQ-MAIL-120 needs a canonical encoding whose test covers the order of fields and text that is not ASCII; an encoding that depends on how a program lays out text gives a check that fails at random.

### Wave 12 — Classes, the shim, and authority over conditions

**Delivers.** A class that states intent, a shim that holds the key of a seat, an orchestrator that makes its own workers, and a condition that only the server may run.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-010 | Two delivery classes, which state intent | 6 |
| REQ-MAIL-012 | The wake carries no content | 5 |
| REQ-MAIL-071 | A sent message is never edited | 5 |
| REQ-MAIL-072 | Artifact integrity | 7 |
| REQ-MAIL-116 | Certificates have a long life | 5 |
| REQ-MAIL-121 | The server signs the fields that it adds | 6 |
| REQ-MAIL-130 | An orchestrator may make workers in its own lane | 6 |
| REQ-MAIL-139 | The per-seat shim holds the key and signs | 8 |
| REQ-MAIL-141 | The server holds the condition and is the only authority | 14 |
| | **9 requirements** | **62** |

**Watch for.** Nine requirements, and the widest wave in the build alongside Wave 13. REQ-MAIL-139 is the first part that is not the server: the shim is a separate program, and it is what lets a harness with no support for client certificates take part at all.

### Wave 13 — Service order, broadcast, and verification with no server

**Delivers.** An order for the queue, one send that becomes many, and a program that checks the record with nothing running.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-004 | Service order is defined | 6 |
| REQ-MAIL-014 | Broadcast | 9 |
| REQ-MAIL-041 | Who may interrupt | 6 |
| REQ-MAIL-118 | Secrets do not enter the record | 4 |
| REQ-MAIL-122 | The record can be checked with no server | 8 |
| REQ-MAIL-124 | What is needed to check a message travels with it | 8 |
| REQ-MAIL-138 | Permission is given when a seat is made, not asked for later | 7 |
| REQ-MAIL-142 | The outcome of a condition, and how it changes | 16 |
| REQ-MAIL-145 | A critical section holds a message; it does not stop work | 12 |
| | **9 requirements** | **76** |

**Watch for.** REQ-MAIL-014 multiplies a send, so every per-send behaviour must already be right. It arrives here rather than earlier for exactly that reason. REQ-MAIL-122 must need no network and no server; a checker that calls the server proves nothing about the server.

### Wave 14 — Preemption, provisioning limits, and running a condition

**Delivers.** An interrupt that cancels the work it interrupts, a grant that cannot be widened, and a condition that runs as a child process.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-015 | An interrupt cancels the work that it interrupts | 9 |
| REQ-MAIL-123 | The record outlives the session, the seat, and the certificate | 6 |
| REQ-MAIL-129 | No seat waits for a person with no end | 5 |
| REQ-MAIL-131 | A seat may not give more than it holds | 5 |
| REQ-MAIL-146 | How a condition runs: requests, locks, and processes | 14 |
| | **5 requirements** | **39** |

**Watch for.** REQ-MAIL-146 must start a script as a **child process**. The server serves each seat from one thread, so a script inside the process of the server stops all traffic, and a small test will not show it. Test that a slow script does not stop another seat from being served. REQ-MAIL-129 needs a recorded test **for each harness**, and not an argument.

### Wave 15 — The pickup, and what the system admits

**Delivers.** One call that takes all outstanding mail, and documentation that claims exactly what is true.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-082 | One pickup takes all outstanding mail | 18 |
| REQ-MAIL-125 | What signatures prove, and what they do not | 5 |
| REQ-MAIL-140 | Condition scripts run with no limits | 5 |
| | **3 requirements** | **28** |

**Watch for.** In REQ-MAIL-082 a parameter that limits the count will look helpful. It gives a seat a way back to one message at a time, which is the behaviour that the requirement exists to remove.

### Wave 16 — Lifetime, and the last of the documents

**Delivers.** A condition whose result survives a restart, and the tool description that tells a seat when to read its mail.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-062 | Read the queue before other work | 3 |
| REQ-MAIL-143 | Scripts are asked to change nothing; nothing enforces it | 4 |
| REQ-MAIL-147 | The lifetime of a condition, and what closing a session does | 16 |
| | **3 requirements** | **23** |

**Watch for.** REQ-MAIL-062 puts its trigger in the **tool description**, and not in contract text, because contract text decays and a tool description does not. This is the cheapest durable instruction channel the design has, and it is largely unused.

---

## 4. The shape of the whole build

| Wave | Requirements | Criteria | Share |
|---|---|---|---|
| 0 | — | — | — |
| 1 | 6 | 35 | 6% |
| 2 | 3 | 19 | 3% |
| 3 | 2 | 22 | 4% |
| 4 | 2 | 14 | 2% |
| 5 | 1 | 8 | 1% |
| 6 | 1 | 9 | 1% |
| 7 | 3 | 20 | 3% |
| 8 | 3 | 23 | 4% |
| 9 | 3 | 23 | 4% |
| 10 | 8 | 70 | 13% |
| 11 | 5 | 39 | 7% |
| 12 | 9 | 62 | 12% |
| 13 | 9 | 76 | 14% |
| 14 | 5 | 39 | 7% |
| 15 | 3 | 28 | 5% |
| 16 | 3 | 23 | 4% |
| **Total** | **66** | **510** | |

*Two more requirements, REQ-MAIL-080 and REQ-MAIL-081, are withdrawn and appear in no wave. The
count in `mail-mcp-prd.md` is 68.*

### 4.1 What REQ-MAIL-148 bought

The wave rule needs each wave to hold work that people can do at the same time. Two requirements
that change one function do not qualify, even when neither depends on the other. Three shapes were
measured:

| Build | Waves | Largest wave | Mean | Independent? |
|---|---|---|---|---|
| Requirement dependencies only | 14 | 10 | 4.6 | **No.** Requirements collide in code inside a wave. |
| True independence, one handler for each path | 25 | 5 | 2.6 | Yes |
| True independence, a stage list for each path | **16** | **9** | **4.1** | Yes |

The middle row is what independence costs when the code fights it. Fourteen requirements all change
the send handler, so they serialise into a chain fourteen long, and the build needs 50 red and green
phases to place 66 requirements.

That chain is not in the requirements. Nothing about verifying a signature and pushing a wake makes
them sequential. They are sequential only when both are edits to one function. REQ-MAIL-148 removes
the cause, and 9 code edges remain instead of 33.

**This is not a rewrite of what exists.** The send handler is being replaced in any case: it takes
`caller_seat_id`, which REQ-MAIL-111 forbids, and carries `expects_reply`, `deadline_seconds`, and
`ttl_seconds`, which this design deleted. The choice was only whether to write it again as one
function or as a list of stages.

### 4.2 What the shape shows

**The build is thin at the start and wide in the middle.** Waves 1 to 9 hold 173 criteria, which is
33 percent of the work, over 9 waves. Waves 10 to 16 hold 337 criteria, which is 66 percent,
over 7 waves.

**Waves 5 and 6 hold one requirement each.** This is correct and it is not efficient. Trust at both
ends needs a serving certificate, and a daemon that serves HTTPS needs both. That stretch of the
graph is a single line and no architecture removes it, because the dependency is real: a certificate
must exist before something can verify it.

**Every wave holds work that is independent.** Verified by machine: no two requirements in one wave
change the same code. That property is what lets a wave go to several workers with no order between
them, and it is the reason this plan is worth computing rather than writing by hand.

### 4.3 Working trees

Because every wave is independent, a wave can be split across workers with no shared tree and no
merge order. Give each worker its own tree, and merge when the wave is complete.

The nine edges in §1.3.3 are the places where that is **not** true, and each one is an ordering
between waves rather than inside one. They need no special handling during a wave.

---

## 5. Who does the work

| Role | Who | Notes |
|---|---|---|
| Requirements and this plan | The architect seat | Documents are not given to a worker. |
| Each wave | One worker for each area of the wave | A worker gets a written brief, and returns a report. A wave is independent by construction, so its workers do not wait for each other. |
| The red phase of a wave | One worker, or the architect seat | Whoever writes the tests does not write the code for them in the same wave. |
| Verification | The architect seat, independently | Re-run the tests. Read the diff. Mutate a green test and confirm that it fails. Never repeat a claim from a report as a fact. |
| Acceptance | The lead | Reads the record as files. |

**The harness.** Use prime-agent for now, and prove REQ-MAIL-129 against it in the same batch. The
choice of harness changes by lane and by model, and opencode, Claude Code, and a Grok client are
each expected later. REQ-MAIL-144 keeps that choice out of the server, and REQ-MAIL-129 needs one
recorded test for each harness that a lane uses.

**Working trees.** §4.3 covers this. Every wave is independent by construction, so give each worker its own tree and
merge when the wave is complete.

**The architect seat verifies, and does not accept a report.** Re-run the tests. Read the diff.
Mutate the new code and confirm that a test fails. A worker that says a wave is complete has made a
claim, and a claim is not a fact.

---

## 6. What this plan does not cover

- **A date, and a duration for any wave.** No measurement of this team on this code exists, so any
  number would be a guess. The counts of requirements and of criteria are the size that this plan
  reports.
- **A limit on the number of workers.** Removed by ruling on 2026-08-15. Add one when a real limit
  or a crash gives the number.
- **A limit on the depth of a mailbox.** Withdrawn as REQ-MAIL-080, for the same reason.
- **The root key in hardware.** Deferred by ruling. `openssl` signs with a key file, and a hardware
  key is deliberately not a file. See REQ-MAIL-117.
- **A sweep that closes a session whose opener has gone.** Deferred to v1.1 by REQ-MAIL-147.

---

## 7. The risks that matter

| Risk | Why it matters | What reduces it |
|---|---|---|
| **A red test that fails for the wrong reason** | A test that fails on a typo, a missing file, or an accident of setup proves nothing. It then goes green when the accident is fixed, and it never tested the requirement at all. | The red phase of every wave ends with a written reason for each failure, and the reason must be the absent feature. |
| **A green test that proves nothing** | The earlier round produced a test that passed because an empty registry refused the call for an unrelated reason. A suite that is green for the wrong reason is worse than no suite, because it stops the search. | Wave 0.2 maps each test to a criterion. Every wave ends with a mutation that must make a test fail. |
| **A server that passes its tests and cannot be used** | The earlier round shipped a server whose registry nobody could register into, with 90 tests green. No test started the program the way a person starts it. | `TESTING.md` runs against a launched server. Wave 6 ends with a launch that a person performs. |
| **The verification shortcut** | One flag removes the one error that a self-signed root produces, and makes the whole identity design an ornament. | Wave 5 includes the test that searches the repository for that flag and for its environment variable. |
| **A worker that repairs what it should delete** | Wave 0.1 removes a subsystem that looks repairable and is not. | The brief states the reason for each deletion, so that the worker can judge an edge case. |
| **A timer that comes back** | The server watches no clocks. A retry, a deadline, or an evaluation on a timer rebuilds what this design removed. | Wave 11 and Wave 14 each end with a check that no `setInterval` and no `setTimeout` loop is in `src/`. |
| **A wave that is declared complete while one criterion is open** | The next wave is defined as the requirements whose predecessors are **satisfied**. One open criterion makes that definition false, and the error moves forward invisibly. | §2.6 gives five conditions. All five, or the wave is not complete. |
| **Nine thin waves at the start** | Waves 1 to 9 hold 173 criteria, a third of the work, over 9 waves, and Waves 5 and 6 hold one requirement each. | Accept it. That stretch is a single line of certificates, and no architecture removes it, because a certificate must exist before anything can verify it. Do not merge waves, because a merge builds against a predecessor that is not satisfied. |
| **REQ-MAIL-148 is built late or built loosely** | It is what makes every later wave independent. A stage list that requirements bypass by editing a shared function returns the build to 25 waves, and nobody notices until the waves stop parallelising. | It is in Wave 1. Criterion 148.8 — to add a check changes no other stage — is the one to test hardest, and to re-check in every later wave. |
