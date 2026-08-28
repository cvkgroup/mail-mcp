<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# agent-mail — Batch fix list

| Field | Value |
|---|---|
| Date | 2026-08-15 |
| Source | Gap analysis of `src/` and `tests/` against `mail-mcp-proposal.md` and `mail-mcp-prd.md` (V1 scope: REQ-MAIL-001…005, 010…014, 020…022, 030, 040…042, 060…062, 070…071, 090…091) |
| Baseline | Branch `develop`, commit `f4fe67a`. All 15 existing tests pass; `tsc` builds clean. |
| ID scheme | `def-<domain>-<nnn>`. IDs are stable; do not renumber. Each item is one unit of work with acceptance criteria. |

Severity: **critical** = defeats a core goal of the design; **major** = V1 requirement not met; **minor** = deviation or hardening.

---

## Architecture and identity

### def-arch-001 — Single-owner mailbox assumption is violated by stdio deployment (critical)
- **Status:** SUPERSEDED by `mail-mcp-identity-spec.md` REQ-MAIL-110 (one HTTPS daemon owns the mailbox). Decision D7-https-daemon taken 2026-08-15. Not done; scheduled as the next red/green batch.
- **Refs.** REQ-MAIL-001; proposal §2 ("One MCP server. It owns the mailbox."); PRD §1 (Week-3 collision cascade).
- **Problem.** The server runs over `StdioServerTransport` (`src/index.ts:426`). Each MCP client spawns its own process. Each process has its own in-memory `MailStore` map and `Sequencer`, loaded once at `init()`. Two seats running two processes against the same `week7/mail` directory will: (a) allocate colliding `seq` values (the mutex is in-process only), (b) never see each other's messages (the JSONL index is read once at startup), and (c) interleave `appendFile` writes with no lock. This recreates the exact failure class the proposal exists to kill.
- **Fix.** Make one process own the mailbox. Recommended: keep the store/service as is, but run a single daemon exposing the MCP server over a local socket or streamable-HTTP transport; agents connect to that one endpoint. Alternative (if stdio must stay): a thin stdio shim per agent that proxies to the daemon. Do NOT attempt multi-process file locking on the JSONL — that rebuilds the problem.
- **Acceptance.** Two concurrently connected clients send 500 messages each through the shared server; all 1000 seqs are unique and gapless; both clients see each other's messages in `mail_inbox`/`mail_audit` without restart. A README section states the single-instance deployment model.

### def-ident-001 — Caller identity is self-declared, not bound (critical)
- **Status:** SUPERSEDED by `mail-mcp-identity-spec.md` REQ-MAIL-111…118 (mutual-TLS identity; the token-handshake approach proposed here is replaced by x.509 client certificates, minted at launch and at registration). Decisions D8-mtls-client-auth, D9-mint-at-launch, D10-register-is-enroll, D11-identity-in-cert, D12-dereg-is-revocation, D14-client-generated-keys taken 2026-08-15. Not done; scheduled as the next red/green batch.
- **Refs.** REQ-MAIL-002 ("The server SHALL derive `from` from the caller's authenticated seat identity"); proposal §2.2.
- **Problem.** Every tool takes `caller_seat_id` as an ordinary string parameter (`src/index.ts:30-78`). Any caller can pass any seat's id and thereby forge `from`, read another seat's inbox, ack another seat's mail, or audit as lead. The PRD's whole point — "agents cannot set or forge" — is defeated.
- **Fix.** Bind identity per connection, not per call. On connect (or via a one-time `mail_hello` handshake carrying a per-seat token issued at registration), the server fixes the session's seat id. Remove `caller_seat_id` from all tool schemas; derive the caller from the bound session identity. If a transitional per-call token is easier, require `seat_token` (a secret issued by `mail_register_seat`, stored server-side hashed) instead of a bare id.
- **Acceptance.** A connection bound to seat `worker-a` calling any tool acts as `worker-a` only; there is no request parameter that can change the effective caller. A test proves a session cannot read or ack mail addressed to a different seat, and every stored message's `from` equals the bound identity of the sending session.

### def-ident-002 — Registration allows privilege escalation (critical)
- **Status:** DONE (Batch B)
- **Refs.** REQ-MAIL-042 ("The architect SHALL register each seat at launch"); PRD §4.
- **Problem.** In `MailService.registerSeat` (`src/index.ts:164-186`): (a) any unregistered caller may self-register with **any role, including `lead`**; (b) any registered seat may re-register **itself** with a new role/lane (the `existingCaller.id !== parsed.id` check only guards registering *others*), so a worker can promote itself to lead in one call.
- **Fix.** (a) Bootstrap: the first lead/architect seat comes from server configuration (env var or config file read at startup), never from an unauthenticated tool call. (b) Only `lead` and `architect` may register or re-register any seat. (c) Self-registration is removed. (d) Re-registration that changes `role` or `lane` requires a lead/architect caller.
- **Acceptance.** An unregistered caller's `mail_register_seat` fails with a named error. A worker attempting to re-register itself with role `lead` fails. Registration by the architect succeeds and is persisted. Tests cover all three.

---

## Missing V1 features

### def-send-001 — Broadcast is not implemented (major)
- **Status:** DONE (Batch D)
- **Refs.** REQ-MAIL-014 (in V1 per PRD §8); proposal §5.7.
- **Problem.** `to` accepts exactly one registered seat (`src/index.ts:192`). Group addressing (`*orchestrators`) does not exist.
- **Fix.** Accept `to` values beginning with `*` as group names. Define groups by role (`*orchestrators`, `*workers`) and optionally by lane (`*lane-a`). On a group send, fan out one stored message per recipient (each with its own `id`, `seq`, and per-recipient state; share one `thread`), run the ACL per recipient, and push one wake per recipient. Return the list of created message ids.
- **Acceptance.** A broadcast to a group with six registered seats stores six messages with six independent states. After four recipients read, `mail_audit`/`mail_status` shows four READ and two DELIVERED/SENT. A worker attempting a broadcast fails the ACL.

### def-send-002 — `mail_reply` and `mail_thread` tools are missing (major)
- **Status:** DONE (Batch C)
- **Refs.** Proposal §2.1 tool table; REQ-MAIL-020/022 (thread is a server-set field); prerequisite for V2 REQ-MAIL-023/024.
- **Problem.** The proposal's tool set includes `mail_reply` (server sets `in_reply_to`, thread, and recipient) and `mail_thread` (read one thread in order). Neither exists; `mail_send` also has no `in_reply_to` parameter. With no reply primitive, `expects_reply` can only ever be satisfied by an ack, and threads can never contain more than one message.
- **Fix.** Add `mail_reply { id, kind, class?, subject?, body }`: server resolves the original message, sets `to` = original `from`, `thread` = original thread, records `in_reply_to` = original id, applies the ACL (a reply follows the same topology rules), and defaults `class` to `when_ready`. Add `in_reply_to?: string` to the `Message` model and file/index record. Add `mail_thread { thread }`: returns all messages in the thread in ascending `seq`, readable by any participant of the thread (or lead/architect).
- **Acceptance.** A reply to message M carries M's thread and `in_reply_to: M.id`, and is addressed to M's sender without the caller naming a recipient. `mail_thread` returns the original and the reply in order. A non-participant calling `mail_thread` fails.

### def-send-003 — `artifacts[]` is missing from `mail_send` (major)
- **Status:** DONE (Batch D)
- **Refs.** Proposal §2.1 (`mail_send` params include `artifacts[]`); PRD §3 non-goal 1 ("Artifacts stay as files. Messages link them."); `mail_read` "returns the body and artifact list".
- **Problem.** The send schema (`src/index.ts:40-52`) has no artifacts parameter; the `Message` model has no artifact field; message files render no artifact section.
- **Fix.** Add `artifacts?: string[]` (file paths) to `mail_send` and `mail_reply`, store them on the message, include them in `mail_read` output and in the rendered `.md` file. Structure each entry as `{ path, sha256 }` with the hash computed at send time — the hash field satisfies V2 REQ-MAIL-072 later; for V1, compute and store it but drift reporting may be deferred.
- **Acceptance.** A message sent with two artifact paths returns both from `mail_read` and lists both in its `.md` file. A stored artifact entry carries a content hash taken at send time.

### def-reg-001 — Registry is not queryable (minor)
- **Status:** DONE (Batch B)
- **Refs.** REQ-MAIL-042 acceptance ("The registry is queryable").
- **Problem.** No tool exposes the seat registry.
- **Fix.** Add `mail_seats` (no parameters beyond bound identity) returning id, role, lane, and escalation target for all seats. All registered seats may call it (they need valid recipient names); tokens/secrets (per def-ident-001) are never returned.
- **Acceptance.** A registered seat lists all seats with roles and lanes. An unregistered caller fails.

### def-send-004 — `mail_inbox` has no state filter (minor)
- **Status:** DONE (Batch A)
- **Refs.** Proposal §2.1 ("List your messages. Filter by state.").
- **Problem.** Inbox always returns only SENT/DELIVERED messages (`src/index.ts:212-221`).
- **Fix.** Add optional `state?: "SENT"|"DELIVERED"|"READ"|"ACKED"` filter. Default behavior (unprocessed only, interrupts first) is unchanged.
- **Acceptance.** `mail_inbox` with `state: "ACKED"` returns acked messages, headers only; without the filter, behavior is unchanged and the REQ-MAIL-004 ordering holds.

---

## Behavior defects

### def-trans-001 — Wake push never names the target agent (major)
- **Status:** DONE (Batch A)
- **Refs.** REQ-MAIL-011; proposal §4 (`prime-agent send --steer <agent> "<text>"`).
- **Problem.** `PrimeAgentTransport.pushWake` ignores `_targetSeatId` and spawns `prime-agent ["send", flag]` with no agent argument (`src/transport.ts:19-25`). The wake cannot reach the intended seat.
- **Fix.** Spawn `prime-agent ["send", flag, targetSeatId]` (adjust to the real prime-agent CLI syntax; the text continues to ride stdin). Update `tests/transport.test.ts` to assert the target argument — the existing test asserted the args exactly and still missed this, so the new assertion must include the seat id.
- **Acceptance.** A transport test proves the spawned argv contains the target seat id for both classes.

### def-state-001 — DELIVERED state semantics are inconsistent (major)
- **Status:** DONE (Batch A)
- **Refs.** REQ-MAIL-020 (four states, four timestamps).
- **Problem.** A successful wake push only sets `push_state` (`src/index.ts:332`); `message.state` stays SENT until the recipient happens to call `mail_inbox`. A recipient that follows the wake text and calls `mail_read` directly jumps SENT→READ and the DELIVERED timestamp is never recorded, so the required four-timestamp chain has a hole.
- **Fix.** Define DELIVERED = the wake push succeeded. On successful push, `markState(id, "DELIVERED")` in `sendInternalMessage`. In `readMessage`, if state is SENT (push failed or pending), record a DELIVERED timestamp at read time before marking READ, so the chain is always complete. `mail_inbox` keeps marking SENT→DELIVERED for pull-based delivery.
- **Acceptance.** After a successful send-and-push, `mail_status` shows state DELIVERED before any recipient action. After read and ack, all four `state_timestamps` entries exist — including when the recipient called `mail_read` without ever calling `mail_inbox`.

### def-state-002 — Failed pushes are never retried for ordinary messages (major)
- **Status:** DONE (Batch E)
- **Refs.** REQ-MAIL-011 ("A push failure marks the message UNDELIVERED and retries per REQ-MAIL-030"); REQ-MAIL-061.
- **Problem.** `EscalationManager.maybeEscalate` returns immediately unless `expects_reply && deadline_seconds` (`src/escalation.ts:48-50`). A message without a reply contract whose push failed stays UNDELIVERED forever with no retry.
- **Fix.** In the escalation sweep, also select messages with `push_state === "UNDELIVERED"` and state SENT, and re-push them on a configurable retry interval with a bounded retry count; record each attempt as a `repush` escalation event. After exhausting retries, escalate per REQ-MAIL-030 (this covers V2 REQ-MAIL-092 as a byproduct).
- **Acceptance.** A message whose initial push fails is re-pushed by the timer without any reply contract set; when the transport recovers, `push_state` becomes DELIVERED. Repeated failure produces an escalation message and the send is never reported as delivered.

### def-escal-001 — Escalation messages forge their sender (major)
- **Status:** DONE (Batch E)
- **Refs.** REQ-MAIL-002 ("Every stored message names its true sender"); REQ-MAIL-032.
- **Problem.** The escalation message is created with `from: message.to` — the unresponsive seat (`src/index.ts:130-141`). The record shows the silent seat "sending" its own escalation, which is false and pollutes the audit trail.
- **Fix.** Reserve a system seat id (e.g. `agent-mail`) registered at bootstrap with a role exempt from the ACL, and send escalations from it. Include the trigger chain (original message id, original sender and recipient, deadline, re-push count) in the body.
- **Acceptance.** An escalation message's `from` is the system identity; its body names the original message id and both parties; it appears in `mail_audit` with its trigger chain (REQ-MAIL-032 acceptance).

### def-escal-002 — Re-push cadence is a 1-second flood, not a bounded window (minor)
- **Status:** DONE (Batch E)
- **Refs.** REQ-MAIL-030; proposal §5.4 ("watch a bounded window, re-ring, escalate").
- **Problem.** `checkDeadlines` runs every 1s and re-pushes on **every** tick once the deadline passes (`src/escalation.ts:27-30, 61-74`): three re-pushes land within ~3 seconds of the breach, then escalation at ~4s — regardless of the deadline's size. The existing test drives `checkDeadlines()` manually four times, which masks this.
- **Fix.** Space re-pushes by a configurable `repushIntervalSeconds` (default 60): re-push only if `now >= dueAt + attempts * interval`. Escalate only after the third re-push has itself gone unanswered for one interval.
- **Acceptance.** With a fake clock, a breached 600s deadline produces re-pushes at breach, +60s, and +120s, and one escalation at +180s; a tick 1 second after a re-push produces nothing.

### def-escal-003 — Missing escalation target is silently swallowed (minor)
- **Status:** DONE (Batches B + E)
- **Refs.** REQ-MAIL-030 (escalation chain worker→orchestrator→architect→lead); REQ-MAIL-032 ("never silent").
- **Problem.** If the overdue seat has no `escalation_target`, `maybeEscalate` returns without recording anything (`src/escalation.ts:80-83`), and the breach disappears.
- **Fix.** Require `escalation_target` at registration for every role except `lead`. As a backstop, when a target is still missing at escalation time, record an `escalated` event with `success: false` and an error, and escalate to the lead seat if one exists.
- **Acceptance.** Registering a worker without an escalation target fails. An orphaned overdue message still produces a recorded, queryable escalation event.

### def-audit-001 — `mail_audit` has no ACL and leaks bodies (major)
- **Status:** DONE (Batch B)
- **Refs.** Proposal §2.1 ("Architect and lead only"); PRD §4 (only lead/architect read all mailboxes); REQ-MAIL-022.
- **Problem.** `MailService.audit` only checks that the caller is registered (`src/index.ts:279-296`); any worker can audit any pair of seats and receives full `StoredMessage` records including bodies.
- **Fix.** Restrict `mail_audit` to callers with role `lead` or `architect`. Keep the pair-unread query (it matches REQ-MAIL-022's acceptance) but return headers plus state/escalation history, not bodies; add an optional `include_read?: boolean` for the full cross-mailbox view the proposal describes.
- **Acceptance.** A worker or orchestrator calling `mail_audit` fails with a named error. Lead and architect succeed. Default results contain no message bodies.

### def-cli-001 — Direct-invocation guard breaks on paths with spaces (minor)
- **Status:** DONE (deployability task, R1)
- **Refs.** Server startup.
- **Problem.** `import.meta.url === \`file://${process.argv[1]}\`` (`src/index.ts:430`) fails when the script path contains characters that URL-encode — including spaces, as in this repo's actual path `/Volumes/repo 1/…` — so `main()` never runs when launched directly.
- **Fix.** Compare with `pathToFileURL(process.argv[1]).href` from `node:url`.
- **Acceptance.** `node dist/index.js` starts the server from a directory whose path contains a space.

### def-store-001 — Superseding a read message is rejected instead of flagged (minor, V2 alignment)
- **Status:** DONE (Batch F)
- **Refs.** REQ-MAIL-063 ("A superseded READ message is flagged, not hidden") — V2, but supersede shipped in V1 with the opposite behavior.
- **Problem.** `supersede` throws once the message is READ or ACKED (`src/index.ts:305-307`). The PRD says a read message may still be flagged superseded (so the recipient knows it is moot) while remaining visible.
- **Fix.** Allow superseding READ messages: keep state ACKED-with-SUPERSEDED-disposition semantics for unread, and add a `superseded: true` flag (visible in `mail_read`/`mail_status`) without hiding it for read ones. Continue rejecting supersede on ACKED. Either implement now or explicitly re-scope; do not leave the silent contradiction.
- **Acceptance.** Superseding an unread message prevents delivery. Superseding a read, un-acked message marks it flagged and it remains readable. Superseding an acked message fails.


### def-boot-001 — Entrypoint never wired bootstrap seats, so the shipped server started unusable (critical)
- **Status:** DONE (deployability task, R3)
- **Refs.** def-ident-002; `main()` in `src/index.ts`.
- **Problem.** `main()` called `createMailService()` with no options, so the built server started with an EMPTY registry. With self-registration removed (def-ident-002), no caller could ever register the first seat — the shipped server was unusable in production while every test passed (tests inject options directly and never exercise the real entrypoint).
- **Fix.** `main()` now reads `AGENT_MAIL_BASE_DIR` and `AGENT_MAIL_BOOTSTRAP` (JSON array of seats, validated by `bootstrapSeatSchema` via the exported `parseBootstrapSeats`). Malformed JSON / invalid seats fail at startup with a clear, named error. If neither the env var nor the persisted `seats.json` contains a lead/architect, the server fails fast naming `AGENT_MAIL_BOOTSTRAP` instead of serving an empty registry. Coverage: `tests/bootstrap.test.ts`.
- **Acceptance.** `node dist/index.js` with `AGENT_MAIL_BOOTSTRAP` serves a mailbox whose first seat can register others; without any bootstrap or persisted leader it exits 1 with an actionable message; a persisted mailbox restarts without the env var.

### def-build-001 — `rootDir` mismatch put the entrypoint at `dist/src/index.js` (major)
- **Status:** DONE (deployability task, R2)
- **Refs.** `package.json` `main`/`start`; `tsconfig.json`.
- **Problem.** `tsconfig.json` used `"rootDir": "."`, so `tsc` emitted `dist/src/index.js` while `package.json` `main` and the `start` script pointed at `dist/index.js` — the build output never matched the declared entrypoint.
- **Fix.** `"rootDir": "src"` so output lands at `dist/index.js`. Verified with `rm -rf dist && npm run build && npm start` and the stdio smoke test.
- **Acceptance.** `npm run build` produces `dist/index.js`; `npm start` launches the server.

---

## Process

### def-proc-001 — REQ-MAIL-013 steering gate has no recorded evidence (major, blocking ratification)
- **Status:** NOT DONE — the live `prime-agent send --steer` experiment and its committed transcript have not been run yet.
- **Refs.** REQ-MAIL-013; PRD §9 ("The steering test SHALL pass before any other work begins"); proposal §4.
- **Problem.** The repo contains no recorded test or transcript proving `prime-agent send --steer` preempts a busy turn. Per the PRD this gates the whole design: if steering only lands between turns, the two classes collapse and the PRD must be revised.
- **Fix.** Run the steering experiment against a busy prime-agent, capture the transcript showing mid-turn consumption, and commit it (e.g. `docs/steering-gate/`) with a short pass/fail note referencing REQ-MAIL-013.
- **Acceptance.** A committed transcript demonstrates a steered message consumed mid-turn, or a documented failure with the PRD revision it triggers.

### def-proc-002 — Test artifacts are committed to git (minor)
- **Status:** NOT DONE — `git rm -r --cached test-workdir` requires a commit; deliberately deferred (no commits in this workflow).
- **Refs.** Repo hygiene.
- **Problem.** `test-workdir/**` (mail files, `mail.jsonl`, `seats.json` from test runs) is tracked in git even though `.gitignore` lists `test-workdir/` — the files were committed before the ignore entry, so every test run dirties the tree.
- **Fix.** `git rm -r --cached test-workdir` and commit.
- **Acceptance.** `git status` stays clean after `npm test`.

---

## Missing tests (for behavior that already exists)

### def-test-001 — Concurrent-send sequencing acceptance test (major)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-001 acceptance ("No gap and no repeat occurs in 1000 concurrent sends"; index and files agree — REQ-MAIL-070).
- **Problem.** `sequencer.test.ts` covers 25 concurrent `next()` calls on the bare class only. Nothing exercises concurrency through `MailService.sendMessage` → store → file write, where the `wx` file flag and JSONL append could still collide.
- **Fix.** Add a service-level test: fire 200+ `sendMessage` calls via `Promise.all`; assert seqs are unique and gapless, one `.md` file exists per message, and the `mail.jsonl` index replays to the same message set (reload a fresh `MailStore` and compare).
- **Acceptance.** The test exists, passes, and fails if the sequencer mutex or the `wx` flag is removed.

### def-test-002 — Server-assigned-field rejection tests (minor)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-001/002 acceptance ("A client that supplies `seq` receives an error"; "A seat that sets `from` … receives an error").
- **Fix.** Add tests that `sendMessage` with each of `id`, `seq`, `sent_at`, `thread`, `from` in the input throws and stores nothing (no file, no index line, sequencer unchanged). This pins both `assertNoServerAssignedFields` and the strict schema.
- **Acceptance.** Five rejection cases pass; each asserts nothing was persisted.

### def-test-003 — Inbox service-order test (major)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-004 acceptance ("two interrupts and three when-ready messages returns them in the specified order… stable across repeated calls").
- **Problem.** No test covers mixed-class ordering; the only inbox test has one message.
- **Fix.** Send interleaved messages (when_ready, interrupt, when_ready, interrupt, when_ready) to one seat; assert `mail_inbox` returns both interrupts first by ascending seq, then the when_readys by ascending seq, and that a second call returns the identical order.
- **Acceptance.** The test matches the PRD's exact scenario and passes.

### def-test-004 — Rejection-stores-nothing tests for unknown recipient and kind (minor)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-003 acceptance ("fails with a named error and stores nothing"); REQ-MAIL-005.
- **Fix.** Tests: send to an unregistered seat → named error, no file written, no index line, no wake pushed; send with an unknown kind → schema error; every kind in the closed list succeeds (loop over `MESSAGE_KINDS`).
- **Acceptance.** All three tests pass; the unknown-recipient test asserts the transport recorded zero calls.

### def-test-005 — Idempotency tests (major)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-060 acceptance ("A repeated `mail_read` returns the same content and does not change state after the first call").
- **Fix.** Tests: `mail_read` twice → identical content, READ timestamp unchanged by the second call; `mail_ack` twice → second call returns the existing ack unchanged (disposition and note from the first call, even if the second supplies different values); ack-after-read and ack-without-prior-read both yield a complete timestamp chain.
- **Acceptance.** Tests pin the READ timestamp and the first ack's disposition.

### def-test-006 — Authorization negative tests at the service layer (major)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-040/041; recipient/sender guards in `readMessage`, `ackMessage`, `status`.
- **Problem.** ACL unit tests cover `assertCanSend` only. No test proves a non-recipient cannot read or ack, or a non-sender cannot query status, through `MailService`.
- **Fix.** Tests: seat C reading a message addressed to B fails; C acking it fails; C querying status of A's sent message fails; a worker `interrupt` through `sendMessage` (not just `assertCanSend`) fails.
- **Acceptance.** Four negative cases pass with named errors.

### def-test-007 — Service-level restart durability test (minor)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-061 acceptance ("A daemon restart loses no message. Mail sent to a stopped seat is delivered after that seat resumes.").
- **Problem.** `store.test.ts` covers `MailStore` reload of a single fully-processed message; nothing covers a restart with mail in flight through the full service.
- **Fix.** Test: send messages (including one whose push failed → UNDELIVERED); construct a second `MailService` on the same `baseDir`; assert the recipient's inbox lists everything in correct order, states preserved, and the sequencer continues without repeats.
- **Acceptance.** The test passes and fails if index replay or `setCurrent` is broken.

### def-test-008 — Escalation edge-case tests (minor)
- **Status:** DONE (acceptance suite; green at baseline)
- **Refs.** REQ-MAIL-030.
- **Fix.** Tests: a message ACKED before its deadline produces no re-push; a READ-but-not-ACKED overdue message still re-pushes and escalates; only one escalation message is ever created per overdue message even after many further ticks.
- **Acceptance.** Three tests pass with a fake clock and manual `checkDeadlines()` driving (updated for the def-escal-002 cadence).

### def-test-009 — MCP-layer round-trip test (minor)
- **Status:** DONE (acceptance suite; split in the fix phase, planned tool surface green at Batch C)
- **Refs.** Proposal §2.1 tool surface.
- **Problem.** All tests bypass the MCP layer; nothing verifies the tools are registered with working schemas or that results serialize.
- **Fix.** Using the SDK's `InMemoryTransport`, connect a client to `createMcpServer`, list tools (assert the full expected set), and drive one register→send→inbox→read→ack round trip through `callTool`.
- **Acceptance.** The round trip passes over a real MCP client/server pair.

---

## Suggested batch order

1. Identity and architecture first — def-arch-001, def-ident-001, def-ident-002 — they change tool schemas everything else builds on.
2. Behavior defects — def-trans-001, def-state-001, def-state-002, def-escal-001…003, def-audit-001, def-cli-001, def-store-001.
3. Missing features — def-send-001…004, def-reg-001.
4. Tests — def-test-001…009 (write alongside the fixes they pin; each feature item carries its own acceptance tests).
5. Process — def-proc-001 (gate, can run in parallel), def-proc-002 (one commit).
