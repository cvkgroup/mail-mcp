<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# Product Requirements — `venus-mail` MCP server

| Field | Value |
|---|---|
| Document version | 0.1 DRAFT |
| Date | 2026-08-15 |
| Author | Shadow architect |
| Status | For lead review. The six §11 decisions are agreed in principle (lead, 2026-08-15). Each one is being walked through individually before it becomes final. |
| Supersedes (on ratification) | `message-exchange-protocol.md` §§2–8; architect contract §13; the Correspondence section of every week-7 contract |
| Source | `week7/mail-mcp-proposal.md` |
| Written in | ASD-STE100 |
| Requirement style | House style: Required behavior / Current state / Acceptance criteria. Each `REQ-MAIL-nnn` is one testable unit. |

## 1. Purpose

Move the inter-agent communication protocol out of prompt text and into an enforced service.

Three failures drive this change. All three are in the engagement record.

| Failure | Cost |
|---|---|
| Week-3 collision cascade | Two agents claimed one sequence number. Citations broke. |
| Week-3 night-run desync | A numeric watermark blinded one party. Four filings went unread. |
| R-2 doorbell deadlock | A bare wake signal was consumed by the wrong envelope. Both parties waited on each other until the lead intervened. |

Each failure produced more prompt text. More text raised context cost and made decay worse. The service ends that cycle.

## 2. Goals

1. Sequence every message. Record sender and receiver. Define service order.
2. Deliver two classes: `interrupt` (act now) and `when_ready` (act after the current action, before the next one).
3. Remove the naming, numbering, collision, and desync rules from every prompt.
4. Keep a human-readable record. The mail IS the engagement's debugging record.
5. Enforce what prompts can only request.

## 3. Non-goals

1. This server does not carry payloads. Artifacts stay as files. Messages link them.
2. This server does not replace the round board. Coordination state stays on the board.
3. This server does not rule. It routes, orders, and records.
4. Version 1 does not support cross-machine agents.

## 4. Actors

| Actor | Rights |
|---|---|
| Lead | Sends any class to anyone. Reads all mailboxes. |
| Overall architect | Sends any class to anyone. Reads all mailboxes. |
| Lane orchestrator | Sends `interrupt` to its own workers. Sends `when_ready` to any seat. Reads its own mailbox. |
| Worker | Sends `when_ready` only. Addresses its own orchestrator only. Reads its own mailbox. |
| Child agent | No mailbox. No access. Reports to its parent in-process. |

## 5. Functional requirements

### 5.1 Message model and sequencing

#### REQ-MAIL-001 — Server-assigned identity and order
- **Required behavior.** The server SHALL assign `id`, `seq`, `sent_at`, and `thread` on every send. `seq` SHALL come from one monotonic counter per scope. The server SHALL reject any client attempt to set these fields.
- **Current state.** Agents compute `max+1` by listing a directory. Two agents can compute the same number.
- **Acceptance criteria.** Two concurrent sends receive different `seq` values. No gap and no repeat occurs in 1000 concurrent sends. A client that supplies `seq` receives an error.

#### REQ-MAIL-002 — Sender identity is bound, not declared
- **Required behavior.** The server SHALL derive `from` from the caller's authenticated seat identity. A client SHALL NOT set `from`.
- **Current state.** The author token is part of a filename the agent types.
- **Acceptance criteria.** A seat that sets `from` to another seat receives an error. Every stored message names its true sender.

#### REQ-MAIL-003 — Recipient is explicit and validated
- **Required behavior.** `to` SHALL name one registered seat, or one broadcast group. The server SHALL reject an unknown recipient at the tool boundary.
- **Acceptance criteria.** A send to an unregistered seat fails with a named error and stores nothing.

#### REQ-MAIL-004 — Defined service order
- **Required behavior.** `mail_inbox` SHALL return unprocessed messages in this order: all `interrupt` messages by ascending `seq`, then all `when_ready` messages by ascending `seq`. The agent SHALL NOT reorder.
- **Acceptance criteria.** An inbox holding two interrupts and three when-ready messages returns them in the specified order. Order is stable across repeated calls.

#### REQ-MAIL-005 — Closed kind vocabulary
- **Required behavior.** `kind` SHALL come from a closed list: `request`, `ruling`, `submission`, `review`, `fix-response`, `run-report`, `acceptance`, `question`, `answer`, `contest`, `status`, `handoff`, `escalation`. The server SHALL reject an unknown kind. Extending the list is a contract amendment.
- **Acceptance criteria.** An unknown kind fails. Each listed kind succeeds.

### 5.2 Delivery classes and transport

#### REQ-MAIL-010 — Two delivery classes
- **Required behavior.** `class` SHALL be `interrupt` or `when_ready`. `interrupt` SHALL stop the recipient's current work; the recipient SHALL act on the content before it continues. `when_ready` SHALL let the recipient finish the current action; the recipient SHALL then process the message before it starts the next action.
- **Acceptance criteria.** A busy recipient receiving an `interrupt` reads it before its next tool call. A busy recipient receiving a `when_ready` completes its current action first, then reads.

#### REQ-MAIL-011 — Hybrid transport
- **Required behavior.** On send, the server SHALL push a wake to the recipient through the harness: `prime-agent send --steer` for `interrupt`, `prime-agent send --follow-up` for `when_ready`.
- **Acceptance criteria.** Each class calls the matching harness flag. A push failure marks the message UNDELIVERED and retries per REQ-MAIL-030.

#### REQ-MAIL-012 — The wake carries no content
- **Required behavior.** The pushed text SHALL carry the message id, class, and sender only. The body SHALL stay in the server. The recipient SHALL act on mail state, never on wake text or wake count.
- **Current state.** Doorbell semantics already state this rule. Prompts must enforce it today.
- **Acceptance criteria.** No pushed wake contains body text. An agent that acts on a duplicate wake takes no second action (see REQ-MAIL-060).

#### REQ-MAIL-013 — Steering verification gate
- **Required behavior.** Before ratification, a test SHALL prove that `--steer` preempts a busy prime-agent turn and reaches the model mid-turn. If it does not, the two classes collapse into one, and this PRD SHALL be revised before any build.
- **Acceptance criteria.** A recorded test shows a steered message consumed mid-turn, with the transcript as evidence.

#### REQ-MAIL-014 — Broadcast
- **Required behavior.** `to` MAY name a group (for example `*orchestrators`). The server SHALL fan out one message per recipient and SHALL track state per recipient.
- **Acceptance criteria.** A broadcast to six seats shows six independent states. Four READ and two UNREAD is visible as such.

### 5.3 State, receipts, and disposition

#### REQ-MAIL-020 — Four states
- **Required behavior.** Each message SHALL hold one state: SENT, DELIVERED, READ, or ACKED. The server SHALL timestamp each transition.
- **Current state.** The sender watches for a reply file. "Read" and "acted" are indistinguishable.
- **Acceptance criteria.** A message moves SENT → DELIVERED → READ → ACKED with four timestamps. `mail_status` reports the current state to the sender.

#### REQ-MAIL-021 — Explicit disposition
- **Required behavior.** `mail_ack` SHALL require a disposition: `ACTED`, `BLOCKED`, or `SUPERSEDED`, plus one line of text.
- **Acceptance criteria.** An ack without a disposition fails. The disposition appears in the record and in `mail_status`.

#### REQ-MAIL-022 — Read receipts replace the `Seen:` header
- **Required behavior.** The server SHALL know what each seat has read. The `Seen:` header and the desync-tripwire rule SHALL be removed from all contracts.
- **Acceptance criteria.** `mail_audit` shows, for any two seats, every message one has sent and the other has not read. No agent maintains a processed-filename set.

#### REQ-MAIL-023 — Blocking declaration
- **Required behavior.** A sender MAY set `blocks: "<what the recipient must not do until this is answered>"`. A recipient holding an unanswered blocking message SHALL show as BLOCKED, not idle.
- **Rationale.** Contract §13.7: silence is never approval. This gives that rule a machine form.
- **Acceptance criteria.** A seat with an open blocking message reports BLOCKED in `mail_audit`. The state clears on reply.

#### REQ-MAIL-024 — Reply contract
- **Required behavior.** A sender MAY set `expects_reply: true` with `deadline_seconds`. The server SHALL record the owed reply, its owner, and its due time.
- **Current state.** `Reply as:` pre-assigns a filename. It makes a reply findable but not trackable.
- **Acceptance criteria.** An owed reply appears in `mail_status` as PENDING before the deadline and OVERDUE after it.

### 5.4 Escalation

#### REQ-MAIL-030 — Server-owned re-push and escalation
- **Required behavior.** On deadline breach the server SHALL re-push the wake. After three unanswered re-pushes the server SHALL send an `escalation` message to the seat's escalation target: a worker escalates to its orchestrator; an orchestrator escalates to the architect; the architect escalates to the lead.
- **Current state.** The sender must remember to watch, re-ring three times, then escalate.
- **Acceptance criteria.** An unanswered message with a 600-second deadline produces three re-pushes and then one escalation message. No agent code performs the watch.

#### REQ-MAIL-031 — Bounded windows by class
- **Required behavior.** Default deadlines SHALL be configurable per kind. Wake-and-file replies default to 600 seconds. Work products take the deadline the sender states.
- **Acceptance criteria.** A message with no explicit deadline uses its kind's default.

#### REQ-MAIL-032 — Escalation is visible, never silent
- **Required behavior.** Every escalation SHALL be recorded as a message with its own id and SHALL appear in `mail_audit`.
- **Acceptance criteria.** Each escalation is queryable after the fact with its trigger chain.

### 5.5 Topology enforcement

#### REQ-MAIL-040 — Access control list
- **Required behavior.** The server SHALL hold the §4 topology and SHALL reject a violating send at the tool boundary, with a named error.
- **Current state.** "Report to your orchestrator, exclusively" is a prompt rule that decays.
- **Acceptance criteria.** A worker sending to another lane's worker fails. A worker sending to its orchestrator succeeds. A child agent has no credentials at all.

#### REQ-MAIL-041 — Interrupt authority
- **Required behavior.** `interrupt` SHALL be limited to: the lead to anyone; the architect to anyone; an orchestrator to its own workers. All other senders SHALL receive `when_ready` treatment or an error.
- **Rationale.** If every seat can interrupt, interrupt becomes the default and loses meaning.
- **Acceptance criteria.** A worker requesting `interrupt` fails with a named error. An orchestrator interrupting a foreign lane's worker fails.

#### REQ-MAIL-042 — Seat registration
- **Required behavior.** The architect SHALL register each seat at launch with its role, lane, and escalation target. The server SHALL refuse traffic from unregistered callers.
- **Acceptance criteria.** An unregistered caller receives an error. The registry is queryable.

### 5.6 Critical sections

#### REQ-MAIL-050 — Interrupt holding
- **Required behavior.** A seat MAY call `mail_critical_begin(reason)` and `mail_critical_end()`. During a critical section the server SHALL hold interrupts and SHALL push them when the section ends. `when_ready` messages queue normally.
- **Rationale.** An interrupt during a stack mutation can corrupt the environment. "Act immediately" must never mean "stop mid-deploy".
- **Acceptance criteria.** An interrupt sent during a critical section is not pushed until the section ends, and is then pushed once. The sender sees state HELD.

#### REQ-MAIL-051 — Critical sections are bounded and mandatory where ruled
- **Required behavior.** A critical section SHALL carry a maximum duration. On expiry the server SHALL log the breach and SHALL notify the architect. The deploy lane SHALL wrap every stack mutation, and the merge lane SHALL wrap every merge, in a critical section.
- **Acceptance criteria.** An unclosed critical section expires, logs, and notifies. A deploy performed without one is a review finding.

### 5.7 Reliability and durability

#### REQ-MAIL-060 — Idempotency
- **Required behavior.** Each message SHALL hold a stable id. `mail_read` SHALL be safe to call more than once. The recipient SHALL never act twice on one id. The server SHALL deduplicate repeated pushes.
- **Acceptance criteria.** Two wakes for one id produce one action. A repeated `mail_read` returns the same content and does not change state after the first call.

#### REQ-MAIL-061 — Queue survives restart and idle seats
- **Required behavior.** Mail SHALL persist to disk. A queue SHALL survive a daemon restart and SHALL wait for a seat that is idle or resurrected.
- **Rationale.** Completed seats persist idle by design. Mail must wait for them.
- **Acceptance criteria.** Mail sent to a stopped seat is delivered after that seat resumes. A daemon restart loses no message.

#### REQ-MAIL-062 — Drain before act
- **Required behavior.** On session start, and after any compaction, a seat SHALL call `mail_inbox` and SHALL process the queue in order before any other work.
- **Acceptance criteria.** A resurrected seat with three queued messages processes all three before its next substantive tool call.

#### REQ-MAIL-063 — Supersede and expire
- **Required behavior.** A sender MAY call `mail_supersede(id)` on an unread message. A `when_ready` message MAY carry a TTL. The server SHALL mark an expired message SUPERSEDED and SHALL NOT push it.
- **Rationale.** A stale interrupt is worse than no interrupt.
- **Acceptance criteria.** A superseded unread message is never delivered. A superseded READ message is flagged, not hidden.

### 5.8 Record and audit

#### REQ-MAIL-070 — File-backed record
- **Required behavior.** The server SHALL write each message to `week7/mail/<lane>/<seq>-<from>-to-<to>-<kind>.md` and SHALL append an index line to `week7/mail/mail.jsonl`. The server SHALL own these names. No agent SHALL write them by hand.
- **Rationale.** The envelopes are the debugging record. A database-only design would lose it.
- **Acceptance criteria.** Every message exists as a readable file. The index and the files agree after 1000 messages.

#### REQ-MAIL-071 — Immutability
- **Required behavior.** A sent message SHALL NOT be edited. A correction SHALL be a new message that cites the original.
- **Acceptance criteria.** No tool can modify a stored body. An edit attempt fails.

#### REQ-MAIL-072 — Artifact integrity
- **Required behavior.** Each linked artifact SHALL carry a path and a content hash taken at send time. `mail_read` SHALL report whether the artifact still matches its hash.
- **Rationale.** Claims can drift from their evidence. This closes the gap cheaply.
- **Acceptance criteria.** An artifact changed after sending is reported as DRIFTED on read.

### 5.9 Flow control

#### REQ-MAIL-080 — Queue depth limit
- **Required behavior.** The server SHALL cap unread depth per mailbox. On breach it SHALL notify the architect as a saturation signal.
- **Rationale.** This is the machine form of the contract's narrow-N rule.
- **Acceptance criteria.** A mailbox exceeding the cap produces one saturation message, not one per send.

#### REQ-MAIL-081 — Turn discipline
- **Required behavior.** The server SHALL count messages sent per seat per turn and SHALL warn above a soft limit.
- **Rationale.** A tool call is cheaper than a file. Cheap sending invites chatter that costs more context than the text this design removes.
- **Acceptance criteria.** A seat exceeding the soft limit receives a warning in its send result. The message still sends.

### 5.10 Failure behavior

#### REQ-MAIL-090 — Halt, never fall back
- **Required behavior.** If the server is unavailable, a seat SHALL halt and report. A seat SHALL NEVER fall back to hand-written mail files.
- **Rationale.** A silent fallback would run both systems at once and split the record.
- **Acceptance criteria.** With the server down, a seat's send attempt ends its turn with a report and writes no file.

#### REQ-MAIL-091 — Server clock owns time
- **Required behavior.** The server SHALL timestamp every event. Agents SHALL NOT write times into message metadata.
- **Acceptance criteria.** All ordering and deadline decisions use server time only.

#### REQ-MAIL-092 — Push failure is visible
- **Required behavior.** A failed harness push SHALL mark the message UNDELIVERED and SHALL retry. Repeated failure SHALL escalate per REQ-MAIL-030.
- **Acceptance criteria.** A push to a dead seat retries, then escalates, and never reports success.

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| REQ-MAIL-100 | Send-to-wake latency under 2 seconds at 20 seats. |
| REQ-MAIL-101 | The tool schema stays small. Total schema text must cost less context than the protocol text it removes. Measure both before ratification. |
| REQ-MAIL-102 | The server runs locally. No network egress. No secrets in message bodies. |
| REQ-MAIL-103 | The server holds no product data and never touches AWS. |
| REQ-MAIL-104 | All server output follows ASD-STE100. |

## 7. Contract impact

Each contract's Correspondence section shrinks to four lines:

> Use the `venus-mail` MCP server for all correspondence. Call `mail_inbox` at every turn start and after any compaction. Process the returned queue in order. Call `mail_ack` with a disposition on each message. Never write mail files by hand.

Removed from every prompt: the naming rule, the numbering rule, the collision-repair rule, the `Seen:` rule, the session ritual, and the doorbell rules.

## 8. Phasing

| Phase | Content |
|---|---|
| V1 (must have) | REQ-MAIL-001…005, 010…014, 020…022, 030, 040…042, 060…062, 070…071, 090…091 |
| V2 (should have) | REQ-MAIL-023, 024, 031, 032, 050, 051, 063, 072, 080, 081, 092 |
| Deferred | Cross-machine seats. Web viewer. Message search ranking. |

V1 is the smallest set that can carry a week. V2 adds the safety and visibility features. The lead may move any item between phases in the §11 walkthrough.

## 9. Acceptance for the server itself

The server is process infrastructure. It SHALL pass its own red/green treatment before week 7 starts: failure modes enumerated first, reds shown failing, then implementation, then a blind reproduction. The steering test (REQ-MAIL-013) SHALL pass before any other work begins.

## 10. Risks

| Risk | Mitigation |
|---|---|
| `--steer` does not preempt a busy turn | REQ-MAIL-013 gates the build. |
| One server is a single point of failure | REQ-MAIL-090 halt-and-report. No fallback path. |
| Tool schemas cost context | REQ-MAIL-101 measures both sides before ratification. |
| The human record degrades | REQ-MAIL-070 file-backed record. |
| Build cost lands inside week 7 | Build before the week starts. Not week-7 scope. |

## 11. The six decisions (agreed in principle 2026-08-15; walked one at a time)

| # | Decision | Status |
|---|---|---|
| D1 | Build the server before week 7 | Agreed in principle. Walkthrough pending. |
| D2 | Hybrid transport: MCP for state, prime-agent for the wake | Agreed in principle. Walkthrough pending. |
| D3 | Interrupt authority per REQ-MAIL-041 | Agreed in principle. Walkthrough pending. |
| D4 | Critical sections mandatory for deploy and merge | Agreed in principle. Walkthrough pending. |
| D5 | Keep a soft per-turn message limit | Agreed in principle. Walkthrough pending. |
| D6 | V1 / V2 split per §8 | Agreed in principle. Walkthrough pending. |

Each walkthrough records: how the decision is satisfied, what it costs, what can go wrong, and the mitigation. The outcome updates this document and the todo register.
