<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# Proposal — replace the prompt-defined mail protocol with an MCP mail server

| Field | Value |
|---|---|
| Status | PROPOSAL for the lead. Not law. No contract changes until you rule. |
| Author | Shadow architect, 2026-08-15 |
| Replaces (if ratified) | `message-exchange-protocol.md` §§2–8; architect contract §13; every contract's "Correspondence" section |
| Written in | ASD-STE100 |

## 1. The problem

The protocol lives in prompt text. Three costs follow:

1. **Context cost.** Every agent carries the naming rule, the numbering rule, the collision rule, the `Seen:` rule, the ritual, and the doorbell rules. Six orchestrators and many workers each pay for the same text.
2. **Decay.** Agents forget parts of the protocol at different times. The record shows the failures: the Week-3 collision cascade, the Week-3 night-run desync (four blind filings), the R-2 doorbell deadlock.
3. **No enforcement.** A prompt rule cannot stop a bad filing. It can only ask for a good one. Each hardening added more text, which increased cost 1 and made cost 2 worse.

An MCP server moves the rules from prompt text into a tool. The server enforces what the prompt could only request.

## 2. The design

One MCP server: **`venus-mail`**. It owns the mailbox. It assigns every field an agent currently computes by hand.

### 2.1 Tools

| Tool | Purpose |
|---|---|
| `mail_send` | Send a message. Parameters: `to`, `class` (`interrupt` \| `when_ready`), `kind`, `subject`, `body`, `artifacts[]`, `in_reply_to?`, `expects_reply?`, `deadline_seconds?`, `blocks?` |
| `mail_inbox` | List your messages. Filter by state. Returns headers only, never bodies. |
| `mail_read` | Read one message by id. Marks it READ. Returns the body and artifact list. |
| `mail_ack` | Close the loop on a message: `ACTED`, `BLOCKED`, or `SUPERSEDED`, with one line of disposition. |
| `mail_reply` | Reply to a message. The server sets `in_reply_to`, thread, and recipient. |
| `mail_thread` | Read one thread in order. |
| `mail_status` | Sender view of a sent message: DELIVERED, READ, ACKED, or OVERDUE. |
| `mail_audit` | Read-only view across all mailboxes. Architect and lead only. |

### 2.2 Fields the SERVER sets (agents cannot set or forge them)

`id`, `seq`, `from`, `to`, `sent_at`, `delivered_at`, `read_at`, `acked_at`, `thread`, `state`.

`from` binds to the caller's identity, not to a self-declared token. This removes the whole class of "wrong author token" errors.

### 2.3 The record stays human-readable

The server appends every message to a file: `week7/mail/<lane>/<seq>-<from>-to-<to>-<kind>.md`, plus a `mail.jsonl` index. Reason: the envelopes are the engagement's debugging record today. A database that only agents can read would lose that. Files stay the durable artifact; the server owns their names.

## 3. How the design meets your three goals

**Goal 1 — sequencing, sender, receiver, service order.**
The server assigns `seq` from one monotonic counter per scope. No agent computes `max+1`. No two agents can claim one number. `from` and `to` are recorded fields, not naming conventions. Service order is defined: interrupts first, in `seq` order; then `when_ready`, in `seq` order. `mail_inbox` returns the queue already sorted. The agent does not decide order.

This deletes, by construction: the numbering rule, the collision-repair rule, the author-token rule, and the `Seen:` desync tripwire (see §5.3).

**Goal 2a — interrupt.** Delivery stops the recipient's current work. The recipient must act on the content at once.

**Goal 2b — when-ready.** Delivery waits. The recipient finishes the current action, then processes the message before it starts the next action.

## 4. The honest limit: MCP cannot interrupt by itself

MCP is pull-based. The agent calls a tool; the server answers. A server cannot push into a running turn. So an MCP-only design gives you a good mailbox and NO interrupt.

The interrupt needs the harness. Prime-agent already has the exact two mechanisms your two classes need:

| Your class | Prime-agent mechanism | Behavior |
|---|---|---|
| `interrupt` | `prime-agent send --steer <agent> "<text>"` | Delivered as steering while the agent is busy |
| `when_ready` | `prime-agent send --follow-up <agent> "<text>"` | Queued after the current turn |

**Proposed hybrid:** the MCP server owns state, order, identity, and the record. On every `mail_send` the server calls `prime-agent send` with the flag its class requires. The pushed text is a pointer only — for example, "MAIL 0042 interrupt from red-lane. Call `mail_read('0042')` now." The body never rides the push. This keeps one rule that the record already proves: the message is the durable state, and the wake is only transport.

**Test this before you commit.** Confirm that `--steer` truly preempts a busy prime-agent turn, and that the steered text reliably reaches the model mid-turn. If steering only lands between turns, then `interrupt` and `when_ready` collapse to one class, and the design needs a different answer (for example, a critical-section poll at each tool boundary).

## 5. Attributes you did not name (my main answer to your question)

### 5.1 Reply pre-assignment becomes a reply CONTRACT
Today every envelope ends with `Reply as: <filename>`. It makes the reply findable. Under the server, `expects_reply: true` plus `deadline_seconds` does more: the server knows a reply is owed, from whom, and by when. It can then report OVERDUE without anyone watching.

### 5.2 Delivery states, and the difference between DELIVERED and READ and ACKED
Today the sender watches for a file. The server should track four states: SENT, DELIVERED, READ, ACKED. "The agent read it" and "the agent acted on it" are different facts. The doorbell deadlock happened because nobody could see that difference.

### 5.3 Read receipts replace the `Seen:` tripwire
The `Seen:` header exists to detect a blinded counterpart. The server knows exactly what each agent has read. Desync becomes impossible to hide. Delete the header and its rule.

### 5.4 Escalation as a server timer
Today: watch a bounded window, re-ring, escalate after 3 unanswered re-rings. The server should own this. On deadline breach it re-pushes; after N breaches it sends a message to the escalation target named in the contract. No agent has to remember the rule, and no agent can forget it.

### 5.5 Idempotency
An at-least-once push can arrive twice. Each message needs a stable id, and `mail_read` must be safe to call twice. An agent must never act twice on one message. This risk is real today and is not written down.

### 5.6 "Silence is never approval" needs a machine form
Contract §13.7 says the absence of a reply authorizes nothing. Give it a field: `blocks: "<what the recipient must not do until answered>"`. The server can then show a blocked agent as BLOCKED, not as idle. This makes a stall visible instead of silent.

### 5.7 Broadcast
The architect will often address all six orchestrators. Today that is one file read by many. Add `to: ["*orchestrators"]` with per-recipient state, so a broadcast that four seats read and two ignored is visible as such.

### 5.8 The topology is enforceable
The contracts say: workers address only their orchestrator; children file no envelopes; only the architect addresses the lead. Today those are prompt rules. The server should hold an ACL and reject a violating send at the tool boundary. Turn a rule that decays into a rule that cannot be broken.

### 5.9 Delivery to an idle or dead seat
Completed agents persist idle. The daemon may restart. Queued mail must survive both. On resurrection the agent must drain its queue in order before it does anything else. Without this rule, a persisted seat wakes with a stale view.

### 5.10 Supersede and expire
The "ride-along disclosure" rule exists because a queued status can become moot. Give the sender `mail_supersede(id)`. Give `when_ready` messages an optional TTL. A stale interrupt is worse than no interrupt.

### 5.11 Artifact integrity
Envelopes link artifacts by path. Add a hash per artifact. Then a reader knows whether the artifact changed after the message was written. The record shows claims that drifted from their evidence; this closes that gap cheaply.

### 5.12 Interrupt safety
An interrupt during an AWS mutation is dangerous. The deploy lane is the sole mutator, and a half-finished stack operation is the worst possible stopping point. Define a critical section: `mail_critical_begin()` / `mail_critical_end()`. During a critical section the server holds interrupts and pushes them at the end. The deploy lane and the merge lane need this. Without it, "act immediately" can mean "corrupt the environment".

### 5.13 Interrupt authority
Not every seat should be able to stop another seat's work. Propose: the lead and the overall architect may interrupt anyone; an orchestrator may interrupt its own workers; a worker may never interrupt. Everything else is `when_ready`. Otherwise "interrupt" becomes the default and loses its meaning.

### 5.14 Queue depth and flood control
An agent with 40 unread messages is failing, not busy. The server should cap depth per mailbox and report the breach as a saturation signal. This is the machine version of the contract's existing narrow-N rule.

### 5.15 Turn discipline
The current rule is "one envelope per turn". It exists to force batching and to keep the record legible. A tool call is cheaper than a file, so agents will send more, smaller messages. Decide whether you keep the limit. My recommendation: keep a soft limit per turn and let the server count it, because the alternative is chatter that costs more context than the protocol text you are removing.

### 5.16 Fallback when the server is down
Every seat depends on one server. Define the failure behavior now: halt and report, and never fall back to ad-hoc files. A silent fallback would recreate both systems at once.

### 5.17 Clock ownership
The server timestamps everything. Agents never write times. This matters for order, deadlines, and the audit record.

### 5.18 Kind vocabulary stays closed
Keep the closed `kind` list, and let the server reject an unknown kind. The vocabulary is what makes the record scannable.

## 6. What the contracts would say afterwards

Each contract's correspondence section shrinks to about four lines:

> Use the `venus-mail` MCP server for all correspondence. Call `mail_inbox` at every turn start and after any compaction. Process interrupts first, then when-ready messages, in the order the server returns. Call `mail_ack` on each message with its disposition. Never write mail files by hand.

The naming rule, the numbering rule, the collision rule, the `Seen:` rule, the ritual, and the doorbell rules all leave the prompt. That is the context saving. The behavior stays, because the server enforces it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Steering does not preempt a busy turn | Test first (§4). If it fails, the two classes collapse and the design needs revision before ratification. |
| One server becomes a single point of failure | Halt-and-report on unavailability. Never a silent file fallback (§5.16). |
| Tool schemas also cost context | They cost far less than the protocol text, and they do not decay. Keep the schema small. |
| The human record degrades into a database | The server writes message files plus a JSONL index (§2.3). Files stay the record. |
| Build cost lands inside week 7 | Build and prove the server BEFORE the week starts. It is process infrastructure, not week-7 scope. |

## 8. Decisions I need from you

1. Build the server before week 7, or run week 7 on the prompt protocol and adopt the server in week 8?
2. Do you accept the hybrid transport (MCP for state, prime-agent push for the wake)?
3. Interrupt authority: do you accept the §5.13 rule (lead and architect anyone; orchestrator its own workers; workers never)?
4. Critical sections (§5.12): mandatory for the deploy and merge lanes?
5. Turn discipline (§5.15): keep a per-turn message limit, or remove it?
6. Which §5 attributes do you want in version 1, and which can wait?
