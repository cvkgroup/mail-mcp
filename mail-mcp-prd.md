<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# Product Requirements — `agent-mail` MCP server

| Field | Value |
|---|---|
| Status | **AUTHORITATIVE.** The single description of what this system does. Supersedes `mail-mcp-identity-spec.md` and the earlier draft of this document. Where anything disagrees with this, this wins. |
| Version | 1.0, 2026-08-15 |
| Supersedes on ratification | `message-exchange-protocol.md` §§2–8; architect contract §13; the Correspondence section of every contract |
| Method | Red/green, mandatory. See §6. The build order is `mail-agent-plan.md`. |
| Written in | ASD-STE100 |
| Reference style | `REQ-MAIL-nnn` requirements, `D<n>-<what-was-decided>` decisions, `F<n>-<what-was-found>` findings. Numbers preserve order; names mean a reader never looks anything up. Both halves stay stable once cited. |

---
## 1. Purpose and scope

### 1.1 What this is, and what it replaces

An MCP server that owns inter-agent correspondence for a multi-seat engagement. It exists because
the protocol previously lived in prompt text, which cost context in every agent, decayed at
different rates in each, and could not be enforced.

Three failures in the engagement record drive it. **The Week-3 collision cascade**: two agents
computed the same sequence number and citations broke. **The Week-3 night-run desync**: a numeric
watermark blinded one party and four filings went unread. **The R-2 doorbell deadlock**: a bare
wake signal was consumed by the wrong envelope and both parties waited on each other until a human
intervened. Each produced more prompt text, which raised cost and worsened decay.

On ratification this supersedes `message-exchange-protocol.md` §§2–8, architect contract §13, and
the Correspondence section of every contract, which shrink to roughly four lines.


### 1.2 What the system guarantees, and what it does not

This distinction is load-bearing and appears throughout. A promise the system cannot keep teaches
people to distrust the ones it can.

**Guaranteed — the server makes these impossible.** A seat cannot forge a sender, claim a sequence
number, address a seat the topology forbids, edit a stored record, clear a block imposed on it, or
evaluate its own condition. Messages are delivered, ordered, and recorded whatever any agent does.

**Requested — the server asks, records, and imposes consequences.** That a recipient stops when
interrupted, finishes what it started, honors its contract, or writes a side-effect-free condition
script. None of these can be compelled. The design never depends on them, and records what
actually happened instead.

**The two layers decay differently.** Server-side mechanism does not erode. Contract text lives in
agent context and degrades with compaction and distance. So the design puts as little as possible
in the decaying layer, and pairs whatever must live there with a durable consequence.

**On the limits recorded here.** Where a requirement says something cannot be guaranteed, it
records what we could not find a way to do — not a proof of impossibility. Each names its obstacle
and, where visible, the path that would remove it.

---

## 2. Definitions

These words have one meaning each in this document. Some of them look like synonyms and are not.

| Term | Meaning |
|---|---|
| **Seat** | A registered identity in the mail system, with a name, a role, a lane, and a certificate. A seat outlives the process that acts as it: a seat that stops and starts again is the same seat. A seat is **not** the same as a client, an agent, or a recipient. |
| **Agent** | The running program that acts as a seat. One seat has one agent at a time, or none while it is stopped. |
| **Harness** | The software that runs an agent: prime-agent, opencode, Claude Code, or a later equivalent. The server knows nothing about harnesses (REQ-MAIL-144). |
| **Client** | One MCP connection to the server. An agent reaches the server through a shim, so the client is the shim, not the agent. |
| **Shim** | A small local program, one for each seat, that holds that seat's private key. The agent speaks to the shim; the shim speaks to the server and signs (REQ-MAIL-139). |
| **Lane** | A named group of seats that do one kind of work, for example `deploy`. One orchestrator owns each lane. A worker belongs to the lane of its orchestrator. |
| **Sender**, **recipient** | Roles in one message. The same seat is a sender in one message and a recipient in another. |
| **Obligor**, **obligee** | Roles in one block. The **obligor** imposes the condition. The **obligee** is the blocked seat, and it asks for the condition to be evaluated when it believes it is ready. |
| **Message** | One item of mail, with a `kind` (what it is) and a `class` (how urgently the sender wants it read). |
| **Kind** | What a message is, from a closed list: `request`, `ruling`, `submission`, and so on (REQ-MAIL-005). |
| **Class** | `interrupt` or `when_ready`. The class states the sender's intent. It does not control the recipient (REQ-MAIL-010). |
| **Thread**, **session** | The same thing. One exchange, from the message that opens it to the moment its opener closes it. The thread is the unit of relationship and of lifetime (D23-the-thread-is-the-session). |
| **Block** | A statement that work must wait. Two forms: a seat declares that it is blocked, or a seat imposes a block on another seat (REQ-MAIL-137). A block stops work. It never stops mail. |
| **Condition** | The test that ends a block. Either a predicate the server can answer from its own state, or a script the server runs. |
| **Wake** | A signal to a harness that mail has arrived. A courtesy only: the message is in the mailbox and the seat finds it at its next `mail_inbox` whether or not the wake arrives (REQ-MAIL-011). |
| **Record** | Everything the server writes to disk: message files, event records, and the index. The record is the lead's interface, not only an audit trail. |
| **Envelope** | The file for one message: an unchanging header and body, with its events beside it (REQ-MAIL-133). |
| **Index** | A rebuildable cache over the record. The directory of files is the source of truth, not the index (REQ-MAIL-134). |
| **Critical section** | A period a seat declares, in which the server holds interrupts and does not deliver them (REQ-MAIL-145). |
| **Provision** | To create a seat: its key, its certificate, its registry row, its permission grant, and its contract, in one act. |
| **Lead** | The human. Not a seat. Reaches agents by typing into a TUI, and is reached over the iMessage MCP. |

---

## 3. Actors and topology

| Actor | Rights |
|---|---|
| **Lead** | **Not a mail seat.** A human, out of band: reaches agents by typing into a TUI, and is reached over the iMessage MCP. Holds no certificate, no mailbox, no ACL rights. Reads the record as files, which makes §8 a primary interface rather than an audit trail. |
| **Architect** | Root of the mail topology; the only seat a human provisions. Sends any class to anyone, reads all mailboxes, provisions orchestrators, and bridges escalations to the lead over iMessage — recording in mail that it did so. |
| **Orchestrator** | Sends `interrupt` to its own lane's workers, `when_ready` to any seat. Reads its own mailbox. Provisions workers in its own lane (REQ-MAIL-130). |
| **Worker** | Sends `when_ready` only, to its own orchestrator only. Reads its own mailbox. Provisions nothing. |
| **Child agent** | No mailbox, no credentials, no access. Reports to its parent in process. |

Out-of-band human instruction that touches an open mail item SHALL be recorded in mail, or the
record silently diverges from reality.

---

## 4. Requirements

### 4.1 Identity

#### REQ-MAIL-002 — The server derives the sender; the client does not declare it
- **Requirement.** The server SHALL set `from` from the caller's authenticated identity. A client SHALL NOT set `from`.
- **Acceptance.**
  1. A request that sets `from` gets an error.
  2. The error names the field that the client may not set.
  3. The server stores no message from a request that sets `from`.
  4. Each stored message shows the identity of the caller that sent it.

#### REQ-MAIL-111 — Identity comes from the TLS peer certificate
- **Requirement.** The server SHALL identify the calling seat from the verified peer certificate of the connection. No tool schema SHALL contain `caller_seat_id`. No field in a request SHALL change the caller.
- **Acceptance.**
  1. A connection that shows the `worker-a` certificate acts as `worker-a`.
  2. No tool schema contains `caller_seat_id`.
  3. A connection cannot read mail addressed to a different seat.
  4. A connection cannot ack a message addressed to a different seat.
  5. A connection cannot send as a different seat.
  6. A connection cannot audit as a different seat.
  7. The `from` of each stored message equals the identity of the connection that sent it.

#### REQ-MAIL-112 — The seat name is in the Subject Alternative Name
- **Requirement.** The seat name SHALL be in a SAN entry, and SHALL NOT be in the Common Name, because TLS software ignores the Common Name for identity. The server SHALL refuse a certificate that has no usable SAN.
- **Acceptance.**
  1. A certificate with `orch` in its SAN identifies seat `orch`.
  2. A certificate with the seat name only in the Common Name is refused.
  3. A certificate with no SAN is refused.
  4. A refusal for a missing or unusable SAN gives a named error.
  5. The documentation states the SAN format.
  6. Each certificate that the server makes uses that one format.

#### REQ-MAIL-113 — The server makes the authority and the architect certificate at launch
- **Requirement.** At first launch the server SHALL make a self-signed root certificate authority with basic constraints `CA:TRUE` and key usage for certificate signing. The server SHALL make the architect certificate and SHALL register the architect seat. The launch configuration SHALL give the architect name and lane. No tool, endpoint, or unauthenticated caller SHALL make a certificate.
- **Reason.** The person who starts the process already controls the machine. To give that person the root identity adds no new permission. Each other method to start the system only moves the same question of trust.
- **Exception.** The architect key is the one exception to D14-client-generated-keys. The process that the lead starts makes the key and writes it with owner-only permission. It does not send the key on any channel. An implementation MAY accept a key that already exists, and then there is no exception.
- **Acceptance.**
  1. A first launch makes a root certificate authority.
  2. The root has basic constraints `CA:TRUE`.
  3. The root has key usage for certificate signing.
  4. A first launch makes an architect key and certificate at a documented path.
  5. A first launch registers the architect seat.
  6. A second launch uses the same root and does not make a new one.
  7. A second launch does not add a second registry row for the architect.
  8. No code path signs a certificate for an unauthenticated caller.
  9. The architect key is not in the record.
  10. The architect key is not in any log.
  11. The architect key is not sent on any connection.
  12. The server removes the architect key from memory after it writes it.

#### REQ-MAIL-114 — Registration signs a client-made CSR; private keys do not move
- **Requirement.** The seat SHALL make its own key pair and a certificate signing request. `mail_register_seat`, from an authenticated architect or orchestrator, SHALL carry that request, SHALL make the registry row, SHALL sign the request, and SHALL return the certificate. A private key SHALL NOT go on any channel, and the server SHALL NOT hold one. The server SHALL take the seat name, role, and lane from the authenticated call, and SHALL set the SAN itself. The server SHALL NOT use an identity from inside the request.
- **Reason.** A private key that moves is a private key that a log, a cache, or an attacker can hold. Client-made keys also prevent a server with a defect from signing as a different seat.
- **Acceptance.**
  1. Registration accepts a certificate signing request.
  2. Registration returns a certificate.
  3. The returned certificate has the registered seat name in its SAN.
  4. The new seat connects with its local key.
  5. The new seat acts as itself and not as another seat.
  6. No private key is in any request.
  7. No private key is in any response.
  8. No private key is in any log line.
  9. No private key is in any file that the server writes.
  10. A request that names a different seat does not get a certificate for that seat.
  11. No registered seat is without a certificate.
  12. No certificate exists for an unregistered seat.
  13. A worker that calls `mail_register_seat` gets a named error.
  14. A malformed request gets a named error.
  15. A malformed request leaves no registry row.
  16. A request for a name that is already registered gets a named error.
  17. A refused registration leaves the seat that already exists unchanged.
  18. A failure after the server writes the row leaves neither the row nor a certificate.
  19. To register the same seat twice with the same request makes no second identity.

#### REQ-MAIL-115 — Deregistration is revocation
- **Requirement.** The server SHALL read role and lane from the registry on each call. To remove a seat SHALL make its certificate useless. The system SHALL NOT use a certificate revocation list or OCSP.
- **Acceptance.**
  1. A deregistered seat with a valid certificate cannot send.
  2. A deregistered seat cannot read.
  3. A deregistered seat cannot ack.
  4. A deregistered seat cannot audit.
  5. Each refusal after deregistration gives a named error.
  6. The connection of a deregistered seat can still authenticate.
  7. The stored mail of a deregistered seat does not change.
  8. Each access check reads the registry at the moment of the call, so removal takes effect at once.

#### REQ-MAIL-116 — Certificates have a long life
- **Requirement.** The server SHALL remove access by deregistration. The server SHALL NOT use expiry to control access. A seat that stops and starts again SHALL use the key and certificate in its home directory.
- **Reason.** Short certificate lives limit the damage from a stolen key when revocation is not possible. Revocation is possible here. To remove a registry row stops access immediately, and expiry only stops it after a delay.
- **Acceptance.**
  1. A seat that starts again after some days connects with its first certificate.
  2. That seat reads its queued mail in order.
  3. A deregistered seat with a valid certificate is refused.
  4. No part of the system uses expiry to control access.
  5. The certificate life is a documented setting.

#### REQ-MAIL-126 — The server makes its own serving certificate
- **Requirement.** The server SHALL make a serving certificate that the root signs, with SAN entries for the loopback names that it binds. The server SHALL NOT use the root as its serving certificate.
- **Reason.** A root is a point of trust, not the identity of a server. To use the root for both puts the key that signs all seats on each connection.
- **Acceptance.**
  1. A client that connects gets a certificate that chains to the root.
  2. That certificate has a SAN for the address that the client used.
  3. The serving certificate and the root are different certificates.
  4. The client verifies the host name.
  5. The client disables no check to connect.

#### REQ-MAIL-127 — Both ends configure trust; no one disables verification
- **Requirement.** The server SHALL use the root as its certificate authority, SHALL request a client certificate, and SHALL refuse an unauthorized peer. Each client SHALL get the root directly, and SHOULD NOT make trust wider for all connections of the process.
- **Prohibition.** `rejectUnauthorized: false` and `NODE_TLS_REJECT_UNAUTHORIZED=0` SHALL NOT be in the repository. A self-signed root causes one error that is easy to predict and one shortcut that is easy to take. To take that shortcut makes this design an ornament, because a connection without verification identifies no one.
- **Acceptance.**
  1. A client with the root connects.
  2. A client with the root completes an authenticated call.
  3. A client without the root does not connect.
  4. The error for a client without the root names the untrusted certificate.
  5. A client that shows no certificate is refused.
  6. Every TLS context in the server verifies its peer against the root.
  7. Every TLS context in the shim verifies its peer against the root.

#### REQ-MAIL-117 — Key material on disk, and the risk that stays
- **Requirement.** The server SHALL write keys with owner-only permission, and SHALL write them outside the record. The server MAY accept a passphrase at launch to encrypt the root key.
- **Risk that stays, accepted.** All seats run as one operating-system user. Therefore a seat that can read the disk can read the root key and make any identity. This design stops accidental impersonation, forged author names, and each error of the type "a different seat wrote this". It does not stop a hostile seat that can read the disk.
- **Future work, NOT IN SCOPE FOR 1.0** (ruled 2026-08-15). A later version SHOULD keep the root key in hardware that does not release it: the Secure Enclave on an Apple Silicon Mac, a TPM on a PC. The reason to defer is concrete. `openssl` signs with a key file, and a hardware key is deliberately not a file. An implementation would need an OpenSSL provider that bridges to the hardware, or it would move certificate signing out of `openssl` into native code, which rewrites the authority instead of moving its key.
- **What hardware storage does and does not remove.** It stops a seat from **taking** the key: a seat could no longer copy the authority, use it on another machine, or use it after the engagement ends. It does **not** stop a local process from **asking** the hardware to sign, because that process runs as the same user. Separate operating-system users, or an access policy on the signing operation, are necessary for that part.
- **Acceptance.**
  1. Each key file has owner-only permission.
  2. No key file is inside the record.
  3. The README contains the paragraph about the risk that stays.
  4. The server accepts a passphrase for the root key at launch.

#### REQ-MAIL-118 — Secrets do not enter the record
- **Requirement.** A private key SHALL NOT be in a message file, in the index, in the registry, or in a log line.
- **Acceptance.**
  1. After a registration that makes a key, no message file contains part of that key.
  2. After that registration, the index contains no part of that key.
  3. After that registration, the registry contains no part of that key.
  4. After that registration, no log line contains part of that key.

### 4.2 Transport

#### REQ-MAIL-110 — One daemon owns the mailbox
- **Requirement.** The server SHALL run as one long-lived process. It SHALL offer the MCP Streamable HTTP transport over HTTPS. It SHALL bind a loopback address only, and SHALL refuse any other address. Many clients SHALL connect to that one endpoint.
- **Reason.** One process per client gives each its own store and its own sequence counter over one directory. Two seats then take the same sequence number, do not see each other's mail, and write over each other. That is the Week-3 collision cascade, rebuilt inside the tool that exists to stop it.
- **Acceptance.**
  1. Two clients connect at the same time.
  2. Each of the two clients sends 500 messages.
  3. All 1000 sequence numbers are different.
  4. The 1000 sequence numbers have no gap.
  5. The first client sees the messages of the second through `mail_inbox`, with no restart.
  6. The first client sees the messages of the second through `mail_audit`, with no restart.
  7. An attempt to bind an address that is not loopback fails.
  8. That failure gives a named error.
  9. A second server that starts on the same mailbox refuses to start, and names the running server.

#### REQ-MAIL-139 — The per-seat shim holds the key and signs
- **Requirement.** Each seat SHALL reach the daemon through a small local program that holds that seat's private key. The agent SHALL speak plain MCP over stdio to that program. The program SHALL speak mutual TLS to the daemon, and SHALL make the signatures of REQ-MAIL-120.
- **Reason.** An agent cannot make a signature over a canonical encoding: it has no key and no cryptographic operations. Therefore something in the path of each client must sign for it, whatever the transport does. The same program is also the one part written once instead of once for each harness, because each harness speaks stdio.
- **Acceptance.**
  1. A seat's private key stays in that seat's home directory.
  2. The agent process never holds the private key.
  3. Each message carries a valid signature.
  4. The agent computed no part of that signature.
  5. A client with no support for client certificates connects through the shim.
  6. The shim refuses to start if it cannot read its key.
  7. The shim refuses to start if its certificate does not match its key.
  8. If the daemon is not running, the shim gives a named error and does not lose the request.

#### REQ-MAIL-011 — The wake is a courtesy, not the delivery mechanism
- **Requirement.** On each send the server SHALL push a wake to the recipient through the harness. The message SHALL already be in the mailbox. The recipient SHALL find it at its next `mail_inbox` whether or not the wake arrives. A failed push SHALL set `push_state` to UNDELIVERED. A failed push SHALL NOT lose the message. The server SHALL NOT retry on a timer.
- **Correction of record.** `prime-agent send --steer` and `--follow-up` do not exist. The help text documents them and the argument parser refuses them; `runSend` sends `type: "send_message"` and takes no steering option. Plain `prime-agent send` works and delivers inside a turn (F7-steer-flag-does-not-exist). How the transport carries the class is not resolved. The message carries the class in either case.
- **Acceptance.**
  1. A send pushes a wake to the named recipient.
  2. A message is in the recipient's mailbox before the wake goes out.
  3. A recipient that never gets a wake still finds the message at its next `mail_inbox`.
  4. A failed push sets `push_state` to UNDELIVERED.
  5. A failed push leaves the message in the mailbox.
  6. No timer retries a failed push.
  7. No test depends on a `--steer` option.

#### REQ-MAIL-012 — The wake carries no content
- **Requirement.** The pushed text SHALL carry the message name, the class, and the sender only. The body SHALL stay in the server. A recipient SHALL act on mail state, and SHALL NOT act on wake text or on the number of wakes.
- **Reason.** The R-2 doorbell deadlock happened because a bare wake was consumed by the wrong envelope. A wake that carries content invites an agent to act on the wake instead of the record.
- **Acceptance.**
  1. No wake contains any part of a message body.
  2. Each wake contains the message name.
  3. Each wake contains the class.
  4. Each wake contains the sender.
  5. An agent that gets the same wake twice takes one action only.

#### REQ-MAIL-144 — Harness-agnostic by construction
- **Requirement.** No harness name, option, or configuration format SHALL be in the server. To wake a seat SHALL run a `wake_command` that the registry holds for that seat, which the server SHALL run and SHALL NOT read. Permission grants SHALL be written once for each role and SHALL be rendered for each harness by the launcher.
- **Reason.** Seats run prime-agent, opencode, Claude Code, or a later client, and the choice changes by lane and by model. A server that knows harness detail makes each new harness a change to the server.
- **Assume the weakest model.** Weaker models write condition scripts with more defects and lose context sooner. Therefore authority stays in the server.
- **Acceptance.**
  1. To add a harness needs no change to the server.
  2. A seat with no `wake_command` still receives its mail.
  3. The permission grant for a role is written once.
  4. The launcher renders that grant for each harness.
  5. A `wake_command` that fails does not stop the send.

### 4.3 Messages, classes, and threads

#### REQ-MAIL-001 — The server assigns identity and order
- **Requirement.** The server SHALL set `id`, `seq`, `sent_at`, and `thread` on each send. `seq` SHALL come from **one counter for the whole server**, which only increases. There SHALL NOT be a counter for each scope: the purpose of `seq` is to fix order for a sender and a recipient, and one global counter does that. It is also simpler to reason about and to recover after a restart. The server SHALL refuse a request that sets any of these fields.
- **Reason.** Agents computed the next number by listing a directory. Two agents then computed the same number.
- **Acceptance.**
  1. Each send returns an `id`.
  2. Each send returns a `seq`.
  3. Each send returns a `sent_at`.
  4. Each send returns a `thread`.
  5. Two sends at the same time get different `seq` values.
  6. 1000 sends at the same time produce 1000 different `seq` values.
  7. Those 1000 values have no gap.
  8. A request that sets `id` gets a named error.
  9. A request that sets `seq` gets a named error.
  10. A request that sets `sent_at` gets a named error.
  11. A request that sets `thread` gets a named error.
  12. A refused request stores no message.
  13. A refused request does not advance the counter.

#### REQ-MAIL-003 — The recipient is named and checked
- **Requirement.** `to` SHALL name one registered seat or one group. The server SHALL refuse an unknown recipient at the tool boundary.
- **Acceptance.**
  1. A send to a registered seat succeeds.
  2. A send to an unregistered name gets a named error.
  3. A refused send stores no message.
  4. A refused send pushes no wake.
  5. A send to a deregistered seat gets a named error.

#### REQ-MAIL-004 — Service order is defined
- **Requirement.** `mail_inbox` SHALL return unprocessed messages in this order: each `interrupt` by increasing `seq`, then each `when_ready` by increasing `seq`. The agent SHALL NOT change that order.
- **Acceptance.**
  1. An inbox with two interrupts and three when-ready messages returns the two interrupts first.
  2. The two interrupts come back in increasing `seq` order.
  3. The three when-ready messages come back in increasing `seq` order.
  4. A second call returns the same order.
  5. An interrupt sent after a when-ready message still comes back first.
  6. `mail_inbox` returns the body of each message (REQ-MAIL-082).

#### REQ-MAIL-005 — The kind vocabulary is closed
- **Requirement.** `kind` SHALL be one of `request`, `ruling`, `submission`, `review`, `fix-response`, `run-report`, `acceptance`, `question`, `answer`, `contest`, `status`, `handoff`, `escalation`. The server SHALL refuse any other value. To add a kind SHALL be a change to this document.
- **Reason.** The closed list is what makes the record easy to scan.
- **Acceptance.**
  1. Each of the thirteen kinds is accepted.
  2. A kind outside the list gets a named error.
  3. A refused send stores no message.
  4. The error names the kinds that are allowed.

#### REQ-MAIL-010 — Two delivery classes, which state intent
- **Requirement.** `class` SHALL be `interrupt` or `when_ready`, and SHALL state the intent of the sender. The contract SHALL ask the recipient to act on that intent: on `interrupt`, to stop at the next tool boundary, to process the message, and then to say whether it continued the earlier work.
- **What the server guarantees.** Delivery. The close of an interrupted message as `PREEMPTED`. A record of the time between the wake and the next mail action of the recipient.
- **What the server only requests.** That the recipient stops. The server cannot make a model stop. No reader SHALL take this requirement to promise otherwise.
- **Reason to keep two classes.** With one class a sender cannot state the intent at all. Compliance is expected to fall as context degrades, and the design does not depend on it.
- **Acceptance.**
  1. Each message carries its class to the recipient.
  2. The record stores the class.
  3. The server records the time of the wake.
  4. The server records the time of the next mail action of the recipient.
  5. The difference between those two times is available to a reader.
  6. No test asserts that a recipient stopped work.

#### REQ-MAIL-014 — Broadcast
- **Requirement.** `to` MAY name a group of a role, for example `*orchestrators`. The server SHALL make one message for each recipient, each with its own `id`, `seq`, and state, and all with one `thread`. The server SHALL check the access rules for each recipient. The server SHALL push one wake for each recipient.
- **Acceptance.**
  1. A broadcast to a group of six seats makes six messages.
  2. Each of the six has a different `id`.
  3. Each of the six has a different `seq`.
  4. All six have the same `thread`.
  5. Each of the six has its own state.
  6. After four recipients read, the record shows four read and two unread.
  7. A worker that sends to a group gets a named error.
  8. A broadcast to a group with no members gets a named error.
  9. A broadcast to an unknown group gets a named error.

#### REQ-MAIL-015 — An interrupt cancels the work that it interrupts
- **Requirement.** When the server delivers an `interrupt` to a seat, it SHALL close each message that the seat has READ and not ACKED, with disposition `PREEMPTED`, and SHALL name the interrupting message. A preempted message SHALL leave the queue and SHALL NOT be delivered again. A message that is only DELIVERED SHALL NOT be preempted, because the seat did not start it. An interrupt that a critical section holds SHALL preempt nothing until the server releases it.
- **What is enforced.** The consequence, not the behavior. The server cannot make the agent stop. Work that the agent finishes anyway has no place to land, because the server refuses a late ack on a preempted message.
- **Acceptance.**
  1. A READ and unacked message becomes `ACKED` with disposition `PREEMPTED` when an interrupt arrives.
  2. That message names the interrupting message.
  3. That message no longer appears in `mail_inbox`.
  4. That message is never delivered again.
  5. A DELIVERED and unread message is not preempted.
  6. The interrupting message itself is not preempted.
  7. A late ack on a preempted message gets a named error.
  8. An interrupt held by a critical section preempts nothing until release.
  9. The sender sees the preemption through `mail_status`.

#### REQ-MAIL-024 — Each message expects a reply; the opener closes the thread
- **Requirement.** Each message SHALL be understood to expect a reply with content, not an ack alone. No message SHALL carry `expects_reply`, because the value would always be true. No message SHALL carry `deadline_seconds`. A thread SHALL stay open until the seat that opened it closes it. A seat SHALL NOT close a thread that it did not open. `acceptance` is the kind that closes a thread.
- **Reason.** In a relationship of a driver and a driven seat, each exchange expects an answer until the relationship ends. Closure belongs to the opener, because only the opener knows whether it got what it needed. This also stops the recursion: without it, each reply would expect a reply.
- **What this replaces.** Open threads are the view of outstanding work. Not "is this late", which nothing can answer, but "is this still open", which the record answers exactly.
- **Acceptance.**
  1. A seat can list each thread that it opened and that is still open.
  2. A seat can list each thread in which it owes a reply.
  3. A thread closes when its opener closes it.
  4. A seat that did not open a thread gets a named error when it tries to close it.
  5. No message carries `expects_reply`.
  6. No message carries `deadline_seconds`.
  7. A closed thread does not appear in the list of open threads.
  8. To close a thread twice is safe and changes nothing.

#### REQ-MAIL-020 — Four states
- **Requirement.** Each message SHALL hold one of SENT, DELIVERED, READ, ACKED. The server SHALL record the time of each change. A push that succeeds SHALL set DELIVERED. A recipient that reads without a call to `mail_inbox` SHALL still get a DELIVERED time, so that the sequence has no hole.
- **Reason.** "The agent read it" and "the agent acted on it" are different facts. The R-2 doorbell deadlock was hard to diagnose because nobody could see the difference.
- **Acceptance.**
  1. A new message is SENT.
  2. A push that succeeds makes the message DELIVERED.
  3. A read makes the message READ.
  4. An ack makes the message ACKED.
  5. Each of the four states has a time.
  6. The four times are in order.
  7. A pickup of a message that no wake reached still records a DELIVERED time.
  8. `mail_status` reports the current state to the sender.

#### REQ-MAIL-021 — The disposition is explicit
- **Requirement.** `mail_ack` SHALL require one of `ACTED`, `BLOCKED`, `SUPERSEDED`, `PREEMPTED`, and one line of text. The server SHALL set `PREEMPTED` and SHALL refuse it from a recipient.
- **Acceptance.**
  1. An ack with no disposition gets a named error.
  2. An ack with a value outside the list gets a named error.
  3. An ack with no text gets a named error.
  4. An ack with text of more than one line gets a named error.
  5. A recipient that sends `PREEMPTED` gets a named error.
  6. The disposition appears in the record.
  7. The disposition appears in `mail_status`.
  8. The one line of text appears in the record.

#### REQ-MAIL-022 — Read receipts replace the `Seen:` header
- **Requirement.** The server SHALL know what each seat has read. Each contract SHALL remove the `Seen:` header and the rule that goes with it.
- **Acceptance.**
  1. `mail_audit` shows, for two seats, each message that one sent and the other has not read.
  2. `mail_inbox` alone tells a seat which messages it has not processed.
  3. The correspondence section of each contract refers to the mail tools and to nothing else.

#### REQ-MAIL-060 — Repeated calls are safe
- **Requirement.** Each message SHALL hold one name that does not change. `mail_read` SHALL be safe to call more than once. A recipient SHALL NOT act twice on one message. The server SHALL ignore a repeated wake.
- **Acceptance.**
  1. Two calls to `mail_read` for one message return the same content.
  2. The second call does not change the READ time.
  3. Two calls to `mail_ack` for one message keep the first disposition.
  4. The second ack keeps the first line of text.
  5. The second ack keeps the first ack time.
  6. Two wakes for one message cause one action.

#### REQ-MAIL-061 — The queue survives a restart and an idle seat
- **Requirement.** Mail SHALL persist to disk. A queue SHALL survive a restart of the server. A queue SHALL wait for a seat that is idle or that starts again.
- **Reason.** Seats that finish stay idle by design. Mail must wait for them.
- **Acceptance.**
  1. Mail sent to a stopped seat is there when the seat starts again.
  2. A restart of the server loses no message.
  3. A restart keeps the state of each message.
  4. A restart keeps the order of the queue.
  5. After a restart the counter continues and repeats no number.
  6. After a restart a message that was UNDELIVERED is still UNDELIVERED.

#### REQ-MAIL-062 — Read the queue before other work
- **Requirement.** At the start of a session, and after each compaction, a seat SHALL call `mail_inbox` and SHALL process the queue in order before other work. *This is contract text and it decays. The trigger belongs in the tool description (D25-tool-descriptions-are-the-durable-instruction-layer).*
- **Acceptance.**
  1. The description of `mail_inbox` states when to call it.
  2. A seat that starts again with three queued messages processes all three before other work.
  3. The record shows the order in which it processed them.

#### REQ-MAIL-063 — Supersede
- **Requirement.** A sender MAY supersede a message that the recipient has not read, and the server SHALL NOT deliver it. A message that the recipient has read SHALL be marked, SHALL stay readable, and SHALL NOT be hidden. A message that the recipient has acked SHALL NOT be superseded.
- **Reason.** A stale interrupt is worse than no interrupt. A read message that is now wrong must still be visible, because the recipient acted on it.
- **Acceptance.**
  1. A superseded unread message is never delivered.
  2. A superseded unread message does not appear in `mail_inbox`.
  3. A superseded read message is marked as superseded.
  4. A superseded read message stays readable.
  5. `mail_status` shows the superseded mark to the sender.
  6. An attempt to supersede an acked message gets a named error.
  7. An attempt to supersede a message that the caller did not send gets a named error.

### 4.4 Blocking and conditions

#### REQ-MAIL-137 — Two block forms, with opposite subjects
- **Requirement.** `i_am_blocked_by: <condition>` SHALL mark the **sender** blocked from the moment it sends. `you_are_blocked_until: <condition>` SHALL mark the **recipient** blocked. A seat MAY hold more than one block, each with its own condition, and each SHALL clear on its own.
- **A block stops work. It never stops mail.** A blocked seat SHALL keep full use of the mail system: it may send, read, reply, and ack. Any other rule causes a deadlock, because the thing that ends a block arrives as mail.
- **Reason.** The first form is the case that contract §13.7 exists for: a seat asked a question and must not proceed. The second is a constraint that one seat puts on another. The earlier design had one field for both and marked the wrong seat for the first case.
- **Acceptance.**
  1. A seat that sends `i_am_blocked_by` is blocked at once.
  2. That seat is blocked on the condition that it named.
  3. A recipient of `you_are_blocked_until` is blocked.
  4. A blocked seat can send mail.
  5. A blocked seat can read mail.
  6. A blocked seat can reply.
  7. A blocked seat can ack.
  8. A seat with two blocks reports both.
  9. When one of two blocks ends, the other stays.
  10. `mail_audit` names the condition of each open block.
  11. `mail_audit` names the message that made each open block.
  12. A reply does not end a block.
  13. An ack does not end a block.
  14. A read does not end a block.

#### REQ-MAIL-141 — The server holds the condition and is the only authority
- **Requirement.** The condition SHALL live in the block record, which does not change. A seat MAY **read** a condition, and SHALL be able to, because a seat that is blocked until a report exists must know to write that report. No seat SHALL run a condition. The server SHALL refuse a result that a seat reports.
- **When the server evaluates.** For a condition that the server can answer from its own state — a message acked, a reply that arrived, a message of a kind from a seat, a time reached — the server SHALL evaluate on the event, and SHALL wake the blocked seat. For a script the server SHALL evaluate on request, because the seat that satisfies it is the seat that does the work. **No condition SHALL be evaluated on a timer.**
- **Reason.** If the seat holds the script, a seat that has lost context can change it and report a pass. The split of when to evaluate follows who makes the condition become true.
- **Acceptance.**
  1. A blocked seat can read its condition.
  2. No tool lets a seat run a condition.
  3. No tool accepts a result from a seat.
  4. A seat that changes a local copy of a script changes nothing.
  5. A condition that the server can answer is evaluated when its event happens.
  6. That evaluation costs no script run.
  7. The server wakes the blocked seat when such a condition clears.
  8. A script condition is evaluated only when a seat asks.
  9. No timer evaluates conditions.
  10. The server knows the state of each block without asking a seat.
  11. `mail_audit` reports block state as fact.
  12. Each evaluation is in the record.
  13. Each evaluation record names its trigger.
  14. Each evaluation record names its result.

#### REQ-MAIL-142 — The outcome of a condition, and how it changes
- **Requirement — the outcome field.** A block SHALL hold one `outcome`: `NOT_ATTEMPTED` (the value at creation; never run), `NOT_SATISFIED` (run; not met), `BROKEN` (the script failed in a way that says the condition itself is wrong), `SATISFIED`, or `SESSION_CLOSED`. `BROKEN`, `SATISFIED`, and `SESSION_CLOSED` SHALL be final.
- **Requirement — the state machine.** `NOT_ATTEMPTED` MAY move to any of the other four. `NOT_SATISFIED` MAY move to `SATISFIED`, `BROKEN`, or `SESSION_CLOSED`. A final value SHALL move nowhere. After a final value the server SHALL run no evaluation for that block.
- **Requirement — how a result comes back.** The result SHALL be the exit code of the process: `0` for satisfied, `1` for not satisfied, any other code for `BROKEN`. A timeout SHALL NOT make a block `BROKEN`, and an abort SHALL NOT make a block `BROKEN`; neither says anything about whether the script is correct. The server SHALL capture `stdout` and `stderr` as context, SHALL NOT read them for the result, and SHALL store them with the evaluation.
- **Requirement — `BROKEN` needs a new block.** A condition does not change, so to correct one SHALL mean that the obligor makes a new block. The block that is `BROKEN` SHALL stay in the record.
- **Reason for the exit code.** To give the result as an exit code means that the process must end to give a result. A script that does not end never satisfies its condition. Therefore to end is in the interest of the person who wrote the script, and is not a rule that they must remember.
- **Acceptance.**
  1. A new block has outcome `NOT_ATTEMPTED`.
  2. An evaluation that exits `0` sets `SATISFIED`.
  3. An evaluation that exits `1` sets `NOT_SATISFIED`.
  4. An evaluation that exits `127` sets `BROKEN`.
  5. A timeout does not set `BROKEN`.
  6. An abort does not set `BROKEN`.
  7. A timeout leaves the outcome as it was.
  8. An abort leaves the outcome as it was.
  9. After `SATISFIED` no evaluation runs again.
  10. After `BROKEN` no evaluation runs again.
  11. After `SESSION_CLOSED` no evaluation runs again.
  12. `stdout` is stored with the evaluation.
  13. `stderr` is stored with the evaluation.
  14. Neither is used to decide the result.
  15. To correct a `BROKEN` block makes a new block.
  16. The `BROKEN` block stays in the record.

#### REQ-MAIL-146 — How a condition runs: requests, locks, and processes
- **Requirement — reads and requests.** Any seat MAY read the outcome, and a read SHALL NOT run anything. Only an explicit request SHALL run a script.
- **Requirement — how a request works.** A request SHALL return at once with a token. The obligee MAY use that token to stop the run. When the run ends the server SHALL send the obligee a message with the result.
- **Requirement — one run at a time.** The server SHALL hold a lock for each condition, and SHALL hold it itself. Requests that arrive during a run SHALL NOT start a second run.
- **Requirement — how a script runs.** The server SHALL start a script as a child process. The server SHALL NOT run a script in its own process, because it serves each seat from one thread and a script would stop all traffic.
- **Requirement — progress is visible.** A reader SHALL be able to see whether an evaluation runs now, and when it started.
- **Requirement — no evaluation at declaration.** The server SHALL NOT evaluate a condition when a seat declares it. At that moment a correct condition is expected to be false, so the result cannot separate a broken script from work that is not finished.
- **Reason for a request that returns at once.** If the obligee waited inside the call, it could neither stop the run that it started nor ask the obligor about a condition that takes far too long. Those are its only two remedies, and both would be unavailable exactly when it needs them.
- **Acceptance.**
  1. A read of an outcome runs no script.
  2. Twenty reads of one outcome run no script.
  3. A request returns a token at once.
  4. The obligee can stop a run with that token.
  5. The server sends the obligee a message when a run ends.
  6. That message carries the result.
  7. Two requests at the same time cause one run.
  8. Both requesters get the same result.
  9. A script runs as a child process.
  10. A slow script does not stop other seats from being served.
  11. No script runs when a seat declares a condition.
  12. A reader can see whether an evaluation runs now.
  13. A reader can see when that evaluation started.
  14. An evaluation that passes its time limit is stopped.

#### REQ-MAIL-147 — The lifetime of a condition, and what closing a session does
- **Requirement — what closing a session does.** When a session closes, each block with a value that is not final SHALL move to `SESSION_CLOSED`. A block with a final value SHALL keep it, because a condition that was satisfied was satisfied and a condition that was broken was broken. **The server SHALL NOT run the script for a closed session**, and SHALL check for a closed session **before** it evaluates.
- **Requirement — closing cancels work.** To close a session SHALL be the way to cancel work. On close the server SHALL wake each seat that holds a live block or owes a reply on that session.
- **Requirement — recovery after a restart.** The server SHALL record that a run started, and SHALL record enough to find the process again. At startup the server SHALL find each condition that was running, SHALL **stop any process that still runs**, SHALL record the abort, SHALL release the lock, and SHALL allow a retry. The server SHALL NOT only release the lock, because a server that stopped does not mean the script stopped.
- **Requirement — lifetime is the relationship.** A result SHALL survive a restart of the server and a lost connection. A block that was satisfied SHALL NOT return because the server stopped and started.
- **Requirement — a stuck condition is solved by asking.** A blocked seat may always send mail, so it SHALL ask the obligor when a condition takes far too long. The obligor may stop a run, release the block, make a new block, or close the session. An obligor that does not answer is an ordinary escalation. **No automatic time limit ends a block.**
- **Retry asks for a property it cannot guarantee.** A script that is stopped part way may have done half of its work, and a retry does it again. The contract SHALL ask that a condition be safe to run again. Nothing enforces that, for the reason in REQ-MAIL-143.
- **Deferred to v1.1.** A sweep by the lead to close sessions whose opener has gone.
- **Acceptance.**
  1. Closing a session moves a `NOT_ATTEMPTED` block to `SESSION_CLOSED`.
  2. Closing a session moves a `NOT_SATISFIED` block to `SESSION_CLOSED`.
  3. Closing a session leaves a `SATISFIED` block satisfied.
  4. Closing a session leaves a `BROKEN` block broken.
  5. A request on a closed session returns `SESSION_CLOSED`.
  6. A request on a closed session runs no script, shown by a script whose run is visible.
  7. A request on a closed session names the session and the time it closed.
  8. Closing a session wakes each seat with a live block on that session.
  9. Closing a session wakes each seat that owes a reply on that session.
  10. A restart stops a script that still runs.
  11. A restart records the abort.
  12. A restart releases the lock.
  13. A restart allows a retry.
  14. A block that was `SATISFIED` before a restart is still satisfied after it.
  15. The record shows the abort and the retry as separate events.
  16. No time limit ends a block on its own.

#### REQ-MAIL-140 — Condition scripts run with no limits
- **Requirement.** A condition script SHALL run with no sandbox, no limit on the network, and no list of allowed operations. It MAY read any file, run any command, and reach any service that the machine can reach. REQ-MAIL-102 and REQ-MAIL-103 SHALL be read to limit **the server**, not a script that it runs for a seat.
- **Reason.** Each seat runs as one operating-system user. A limit between seats would be advice only, and advice that looks like a limit invites trust that it does not deserve.
- **Consequences, written here so that nobody finds them later.** A block condition is a way to run code between seats. No limit on what a script may do also means no limit on what it may cost. A script holds whatever credentials the environment holds.
- **What a later limit would need.** A class of allowed operations for each block, which the server enforces; and separate operating-system users for each seat, without which no limit between seats is real.
- **Acceptance.**
  1. A script can read a file outside the mailbox.
  2. A script can run a command.
  3. The documentation states that a script runs with the permissions of the machine.
  4. The README states the same.
  5. A script inherits the environment and the permissions of the process that starts it, unchanged.

#### REQ-MAIL-143 — Scripts are asked to change nothing; nothing enforces it
- **Requirement.** A condition script SHOULD read state and change nothing, and SHOULD be safe to run at any time and any number of times. The contract SHALL say so. A script that writes files, changes remote state, or spends money is a defect in that script.
- **There is no guarantee.** With scripts that may do anything and no sandbox, this cannot be enforced. No analysis can decide it for a shell, because a shell can build a command while it runs. **No test SHALL claim to verify it.** A test that appeared to would be worse than no test, because it would create trust in a property that the system does not have.
- **What limits the risk is how often a script runs, not enforcement.** Evaluation stops for good at a final outcome. A read runs nothing. A closed session runs nothing. No timer runs anything. Only the obligee starts a run.
- **Acceptance.**
  1. The contract states the expectation.
  2. The README states that nothing enforces it.
  3. The record of evaluations is enough to find a script whose effect changed between runs.

### 4.5 The record

#### REQ-MAIL-070 — The record is files, and a person can read them
- **Requirement.** Each message SHALL exist as a readable file at `<mail>/<lane>/<seq>-<from>-to-<to>-<kind>.md`. The server SHALL own those names. No agent SHALL write one by hand.
- **Reason.** The lead is not a seat and does not call tools. The lead reads these files. Therefore the record is an interface, not only evidence.
- **Acceptance.**
  1. Each message has a file.
  2. Each file name holds the sequence number.
  3. Each file name holds the sender.
  4. Each file name holds the recipient.
  5. Each file name holds the kind.
  6. Each file is under the lane directory of its recipient.
  7. After 1000 messages there are 1000 files.
  8. After 1000 messages the index and the files agree.
  9. A person can read one file and learn who sent what to whom, and when.

#### REQ-MAIL-133 — The envelope grows; it is never rewritten
- **Requirement.** The header and body SHALL be written once and SHALL NOT change. They SHALL hold only facts that were true at the moment of the send. Each later event — a change of state, the ack with its disposition and text, a supersede, the result of a push, an escalation — SHALL be written as **its own record** beside the message, and SHALL NOT change the message. `state` and `push_state` SHALL NOT be in the header, because both stop being true at once. The current state of a message SHALL be the sum of its event records. A program SHALL be able to show one message, or one thread, as one view.
- **Reason.** Testing found a message that had been delivered, read, and acked, whose file still said `state: SENT` and `push_state: PENDING`, and whose ack was in no readable file at all (F10-record-shows-stale-state). To rewrite the file on each change does not scale, because each change would rewrite content that never changes.
- **Acceptance.**
  1. The header holds no `state`.
  2. The header holds no `push_state`.
  3. A field with no value is left out, not written empty.
  4. After SENT, DELIVERED, READ, and ACKED there are records for all four changes.
  5. Each of those records holds its time.
  6. There is a record for the ack disposition.
  7. There is a record for the ack text.
  8. The body after the ack is the same, byte for byte, as the body at the send.
  9. A reader can rebuild one exchange from the files alone, with no server running.
  10. The cost of writing an event does not grow with the size of the message.

#### REQ-MAIL-134 — A file is the unit; the directory is the log
- **Requirement.** Each record SHALL be written to a temporary file on the same file system and moved into place with a rename, which is atomic. A reader SHALL see a whole record or no record. Nothing SHALL be changed in place. To add to the log SHALL mean to make one more file. A record SHALL be made read-only **before** the rename, so that it is never both visible and writable.
- **The index is derived.** The directory SHALL be the source of truth. Any single index file SHALL be a cache that the server can rebuild from the directory.
- **What read-only gives, and what it does not.** It stops accident: a write path with a defect, a shell redirect, an editor. It does not stop intent, because the owner can change the mode. It does not stop deletion, because the file system decides deletion by the permission of the directory, and the directory must stay writable for new records. The chain of REQ-MAIL-135 finds a deletion after the fact.
- **Acceptance.**
  1. Each record is written to a temporary file first.
  2. Each record is moved into place with a rename.
  3. Each published record is read-only.
  4. An attempt to open a published record for writing fails.
  5. 1000 sends at the same time make 1000 whole files.
  6. None of those files is partial.
  7. To stop the server during a send leaves a whole record or no record.
  8. The index can be deleted and rebuilt from the directory.
  9. The rebuilt index is the same as the one that was deleted.
  10. A message lifetime can be rebuilt from its own files with no index.

#### REQ-MAIL-135 — Damage is found, located, and never ignored
- **Requirement.** Each record SHALL carry a value that covers its own content and the value of the record before it. A break in that chain SHALL name the record where it broke. On a parse failure, a value that does not match, or a break in the chain, the server SHALL refuse to start, and SHALL name the file and the check that failed. The server SHALL NOT load the records that survive and continue.
- **Reason.** Parsing finds a file that was cut short. It does not find one changed bit inside a string, which parses correctly and replays as fact. The chain finds that, and also finds a record that was deleted, moved, or inserted.
- **Acceptance.**
  1. One changed byte inside a record is found when the server starts.
  2. The report names that record.
  3. The server does not start.
  4. A record deleted from the middle is found as a gap.
  5. Two records that swapped places are found.
  6. A record inserted is found.
  7. A last record that was cut short is discarded and reported, and the server starts.
  8. Each other record before it stays.
  9. A damaged index can be rebuilt from the directory and then verifies.
  10. Each of these failures has a repair that is written down and tested.

#### REQ-MAIL-136 — Records do not change, enforced four ways
- **Requirement.** Once a record is visible its bytes SHALL NOT change. This SHALL be enforced four ways, because one way alone can be defeated: by mode, since a record is read-only before it is visible; by **the absence of a code path**, since the server SHALL hold no function that opens a published record for writing, that shortens one, or that renames another over one; by correction through addition, since a mistake SHALL be corrected by a new record that names the one it corrects; and by detection, since the chain of REQ-MAIL-135 finds a change that happens in spite of the first three.
- **Only a derived cache may be rewritten**, and only by a full rebuild. A cache is not a record. The boundary SHALL be clear in the code, so that "may I write here" is never a judgement.
- **Reason.** Evidence that can be wrong without anyone knowing is worse than evidence that is missing, because a reader still trusts it. This is also what makes a signature mean something: a signature over a record that can change proves only what the record said at the moment of signing.
- **Acceptance.**
  1. An attempt to open a published record for writing fails.
  2. Exactly one function writes a record, and it only ever creates a new file.
  3. That function refuses a path that already exists.
  4. That function is the only caller of rename on the record path.
  5. A correction is a new record.
  6. That new record names the record that it corrects.
  7. The corrected record is unchanged, byte for byte.
  8. A record changed from outside is found when the server starts.
  9. A rebuild of the cache changes no record.

#### REQ-MAIL-071 — A sent message is never edited
- **Requirement.** A message that is sent SHALL NOT be edited. A correction SHALL be a new message that names the original.
- **Acceptance.**
  1. No tool changes the body of a stored message.
  2. A correction is a new message.
  3. That message names the original.
  4. The original is unchanged after a read.
  5. The original is unchanged after an ack.

#### REQ-MAIL-072 — Artifact integrity
- **Requirement.** Each artifact that a message names SHALL carry a path and a hash of its content taken at the moment of the send. `mail_read` SHALL hash the file again and SHALL report whether it still matches.
- **Reason.** The record shows claims that moved away from their evidence. This closes that gap cheaply.
- **Acceptance.**
  1. A send with an artifact stores the path.
  2. A send with an artifact stores a hash from the moment of the send.
  3. A read reports the artifact as matching when the file has not changed.
  4. A read reports the artifact as changed when the file has changed.
  5. The stored hash does not change when the file changes.
  6. A second read does not change the READ time.
  7. A read reports an artifact that no longer exists, and does not fail.

### 4.6 Signatures

#### REQ-MAIL-120 — Each message carries a signature from its sender
- **Requirement.** The sender SHALL sign the payload with its private key and SHALL send the signature with the message. The server SHALL check that signature against the public key of the certificate that the connection holds. The server SHALL refuse a message whose signature is absent, malformed, or wrong. A refused message SHALL NOT be stored and SHALL NOT be pushed.
- **What is signed.** The client cannot sign `id`, `seq`, `sent_at`, or `thread`, because the server sets them after the send. The signature SHALL cover the part that the client wrote: `to`, `kind`, `class`, `subject`, `body`, and the path and hash of each artifact. It SHALL cover them in one encoding that is defined once, with a fixed order of fields and a fixed way to mark their length, so that a check never depends on how the text is laid out.
- **Reason.** Mutual TLS proves who holds a connection. It proves nothing about a message after that connection closes. A signature makes each message provable on its own, and turns the immutability of REQ-MAIL-071 into evidence of tampering.
- **Acceptance.**
  1. A message with a valid signature is stored.
  2. The stored message holds its signature.
  3. The index holds that signature.
  4. A message with no signature gets a named error.
  5. A message with no signature is not stored.
  6. A message signed by a different seat's key gets a named error.
  7. A message whose body changed after signing gets a named error.
  8. The encoding is covered by its own test.
  9. That test covers the order of fields.
  10. That test covers text that is not ASCII.
  11. Two encodings of the same message are the same, byte for byte.

#### REQ-MAIL-121 — The server signs the fields that it adds
- **Requirement.** After it sets `id`, `seq`, `sent_at`, and `thread`, the server SHALL sign the whole envelope — the signature of the sender and the fields that the server added — with its own key, whose certificate chains to the same root. The server SHALL store both signatures. A message that the server writes itself SHALL carry the server signature only, and SHALL be marked as written by the server.
- **Reason.** The signature of a sender proves who wrote the content. It cannot prove the order, because a sender does not know its own sequence number. Order is the failure that this project exists to fix, so it must be signed by the party that assigns it.
- **Acceptance.**
  1. Each stored message carries a server signature.
  2. That signature verifies.
  3. A change to `seq` in a stored record makes the check fail.
  4. A change to `sent_at` in a stored record makes the check fail.
  5. A message that says it came from the server, without a valid server signature, fails the check.
  6. A message written by the server is marked as such.

#### REQ-MAIL-122 — The record can be checked with no server
- **Requirement.** A program SHALL check a mailbox with no server running. For each message it SHALL check the signature of the sender, the signature of the server, and that both certificates chain to the trusted root. It SHALL report `OK`, `ALTERED`, `UNSIGNED`, or `UNKNOWN-SIGNER` for each message. It SHALL exit with an error if any message fails.
- **Reason.** Proof that needs the server of the accused party to confirm it is worth little. Anyone who holds the root certificate must be able to check the record.
- **Acceptance.**
  1. The program passes on a mailbox that nobody changed.
  2. One changed byte in one body makes that message report `ALTERED`.
  3. That run exits with an error.
  4. A message with no signature reports `UNSIGNED`.
  5. A message signed by a certificate outside the root reports `UNKNOWN-SIGNER`.
  6. A deleted index line is reported.
  7. The program needs no network.
  8. The program needs no running server.

#### REQ-MAIL-123 — The record outlives the session, the seat, and the certificate
- **Requirement.** A check of a stored message SHALL depend only on the signatures and the chain, and SHALL NOT depend on anything that is live. A message SHALL still check as authentic after its sender disconnects, after that seat is removed, and after its certificate expires. The check SHALL confirm that the signing certificate was valid **at the `sent_at` of the message**, and SHALL NOT ask whether it is valid now. The record SHALL keep the chain of the signer.
- **Reason.** Two different questions get confused. "May this seat act?" is a question about now, and the registry answers it. "Did this seat write this?" is a question about the past, and the signature answers it for ever. To remove a seat answers the first and must never touch the second.
- **Acceptance.**
  1. A message from a seat that was later removed still checks as authentic.
  2. That check names the original signer.
  3. A message whose signing certificate has expired still checks as authentic.
  4. The checking program gives the same result on a mailbox where each seat is removed.
  5. The checking program gives the same result on a mailbox where each certificate has expired.
  6. The record holds the chain of each signer.

#### REQ-MAIL-124 — What is needed to check a message travels with it
- **Requirement.** `mail_read`, `mail_thread`, and `mail_inbox` SHALL return, with each message, the signature of the sender, the signature of the server, and the certificate chain of the sender. A recipient SHALL be able to check a message from that answer and the root alone: with no second call, no lookup in the registry, and no trust in what the server says.
- **Reason.** The recipient trusts the root, not the server. To carry the certificate with the message closes the loop: the sender signed the content, the server signed the fields that it added, both chain to one root.
- **Acceptance.**
  1. `mail_read` returns the sender signature.
  2. `mail_read` returns the server signature.
  3. `mail_read` returns the certificate chain of the sender.
  4. A recipient checks a message from that answer alone.
  5. A message whose body changed after signing fails that check.
  6. A message whose certificate does not chain to the root fails that check.
  7. `mail_inbox` returns enough to check each header.
  8. `mail_inbox` returns a signature for each message that it returns.

#### REQ-MAIL-125 — What signatures prove, and what they do not
- **Requirement.** The documentation SHALL state the guarantee exactly. No test and no contract SHALL claim more.
- **Proven.** Who wrote the content, because only the holder of that key could have signed it. That the content did not change, because any change to body, subject, recipient, kind, class, or artifact hash is found. The order and time that the server attests. And that anyone with the root can check all of it later, including after a certificate expires or a seat is removed.
- **Not proven.** That a message arrives. A server with a defect, or a hostile one, can still drop, delay, or hold a message. Gaps in the sequence and missing server signatures make that **visible**, not impossible. Signatures also do not defend against a party that can read the key of the root, which on a machine with one user means any seat that can read the disk.
- **Acceptance.**
  1. The README states what is proven.
  2. The README states what is not proven.
  3. The contract text states both.
  4. A message that is dropped leaves a gap that a reader can see.

### 4.7 Authorization, provisioning, and permissions

#### REQ-MAIL-040 — Access control
- **Requirement.** The server SHALL hold the topology of §3 and SHALL refuse a send that breaks it, at the tool boundary, with a named error.
- **Acceptance.**
  1. A worker that sends to a worker in another lane gets a named error.
  2. A worker that sends to its own orchestrator succeeds.
  3. A worker that sends to the architect gets a named error.
  4. An orchestrator that sends `when_ready` to any seat succeeds.
  5. A caller that is not registered gets a named error.
  6. A child agent has no credentials and cannot connect.
  7. A refused send stores no message.

#### REQ-MAIL-041 — Who may interrupt
- **Requirement.** `interrupt` SHALL be limited to the architect, to any seat; and to an orchestrator, to a worker in its own lane. Each other sender SHALL get a named error. The lead is not a seat and holds no rights here.
- **Reason.** If each seat can interrupt, then interrupt becomes the ordinary case and means nothing.
- **Acceptance.**
  1. A worker that sends `interrupt` gets a named error.
  2. An orchestrator that interrupts a worker in its own lane succeeds.
  3. An orchestrator that interrupts a worker in another lane gets a named error.
  4. An orchestrator that interrupts its own architect gets a named error.
  5. The architect may interrupt any seat.
  6. No rule in the server names the lead.

#### REQ-MAIL-042 — Seat registration
- **Requirement.** Each seat SHALL be registered with a role, a lane, and an escalation target. The server SHALL refuse traffic from a caller that is not registered. A worker or an orchestrator SHALL NOT be registered without an escalation target. The registry SHALL be readable through `mail_seats`.
- **Acceptance.**
  1. A caller that is not registered gets a named error.
  2. Registration by the architect succeeds.
  3. A registered seat persists across a restart of the server.
  4. A worker registered without an escalation target gets a named error.
  5. An orchestrator registered without an escalation target gets a named error.
  6. An architect may be registered without one.
  7. `mail_seats` lists each seat with its role.
  8. `mail_seats` lists each seat with its lane.
  9. `mail_seats` lists each seat with its escalation target.
  10. `mail_seats` returns no key and no secret.
  11. A caller that is not registered cannot call `mail_seats`.

#### REQ-MAIL-130 — An orchestrator may make workers in its own lane
- **Requirement.** An orchestrator SHALL be able to register a seat whose role is `worker`, whose lane is its own, and whose escalation target is itself. The server SHALL check all three and SHALL refuse any other registration by an orchestrator, with a named error.
- **Reason.** Workers are made as work arrives, so nobody knows the list in advance. An orchestrator already owns the workers of its lane, so to let it make them adds no authority. To send each new worker through the architect would put a waiting person in the fast path.
- **No limit on the number of workers** (ruled 2026-08-15). An earlier draft set a limit for each orchestrator. The lead removed it: a limit chosen now would be a guess about capacity that nobody has measured. Add one when a real limit or a crash shows what the number is.
- **Acceptance.**
  1. An orchestrator registers a worker in its own lane and gets a certificate for it.
  2. An orchestrator that registers into another lane gets a named error.
  3. An orchestrator that registers a role other than `worker` gets a named error.
  4. An orchestrator that names a different escalation target gets a named error.
  5. A worker cannot register anything.
  6. A failed registration leaves no partial seat.

#### REQ-MAIL-131 — A seat may not give more than it holds
- **Requirement.** When one seat makes another, the permission grant, role, and lane that it writes SHALL be within its own.
- **Reason.** Once a seat can make another seat, that becomes a way to gain authority: an orchestrator that could make a worker with wider permissions would have a way to do what it may not do itself.
- **Acceptance.**
  1. An orchestrator cannot make a worker with a grant wider than its own.
  2. A worker made by an orchestrator holds the rights of a worker only.
  3. That worker is in the lane of that orchestrator.
  4. An attempt to gain authority this way gets a named error.
  5. That attempt is visible in the record.

#### REQ-MAIL-138 — Permission is given when a seat is made, not asked for later
- **Requirement.** The permission configuration of a seat SHALL be written when the seat is made, with its key, its certificate, its contract, and its registry row. It SHALL NOT be obtained while the seat runs. The grant for the mail tools SHALL be **one rule for the whole server**, so that it stays complete when a tool is added. Grants SHALL be templates for each role, kept with the launcher, and SHALL NOT be written by hand for each seat. No seat SHALL be started with a grant that allows everything.
- **Why the mail rule is the important one.** It is the one part of a grant that can be **shown** to be complete. Each other part may be wrong, because a seat that can always reach its mailbox can always report what it could not do.
- **The circular case, and how it closes.** A seat whose mail grant is missing cannot report that it cannot speak. The launcher SHALL therefore complete a mail exchange **as the new seat**, with the configuration that it has just written, before it says that the seat is ready. That is the only check that runs while the way out is itself broken.
- **Acceptance.**
  1. A new seat completes each mail tool with no prompt for permission.
  2. To add a twelfth tool needs no change to the configuration of any seat.
  3. No seat configuration contains a grant that allows everything.
  4. The launcher completes a mail exchange as the new seat before it reports success.
  5. A seat that cannot complete that exchange is reported as failed.
  6. A failed provisioning leaves no seat that appears ready.
  7. The grant for a role is written once.

#### REQ-MAIL-129 — No seat waits for a person with no end
- **Requirement.** A seat SHALL NOT be started in a way that lets a request for permission wait with no end. The whole set of tools that a seat needs SHALL be granted when the seat is made. A seat that runs with nobody watching SHALL be started in a mode that is shown **by test, for each harness**, not to wait. The grant SHALL stay narrow: a seat that cannot wait because it may do anything is not a solution.
- **What is known.** An interactive Claude Code session waits for an answer to a local permission request **with no end**; the setting that bounds such a wait covers only requests sent to a remote client. A session that is not interactive does not wait, but was seen to allow more than expected.
- **Acceptance.**
  1. For each harness there is a recorded test of what an unattended seat does when a tool is outside its grant.
  2. That test shows whether the seat continues, fails, or waits.
  3. No seat is started in a configuration where it can wait with no end.
  4. The documentation states what the chosen mode allows beyond the mail tools.
  5. A seat that is refused a tool can still send mail.

### 4.8 Critical sections

#### REQ-MAIL-145 — A critical section holds a message; it does not stop work
- **Requirement.** A seat MAY call `mail_critical_begin(reason)` and `mail_critical_end()`. While a section is open the server SHALL hold each `interrupt` for that seat and SHALL deliver it once when the section ends. `when_ready` messages SHALL be unaffected. A section SHALL carry a maximum time. When that time passes the server SHALL record the breach and SHALL send a message to the architect. A seat SHALL be able to see that it is inside a section, and for how long.
- **Restated purpose.** A critical section does not stop an interrupt from disturbing a deploy, because nothing can stop a model. It **holds the message**, so that a seat in the middle of a change to a stack is never given a reason to leave it. To hold a message is enforceable. To compel a stop is not. That is the only lever that this system has during a dangerous operation.
- **Long is not the same as dangerous.** A section is for a dangerous operation, and not for one that is merely long.
- **Prefer a mechanism to a memory.** That the deploy lane wraps each change to a stack is contract text, and it decays. Where the shim can offer a command line, the wrapping SHOULD become part of the deploy procedure itself.
- **Acceptance.**
  1. An `interrupt` sent to a seat in a section is not delivered during the section.
  2. That message is delivered when the section ends.
  3. It is delivered once.
  4. A `when_ready` message is delivered during a section as usual.
  5. The sender of a held message sees that it is held.
  6. A seat can read that it is inside a section.
  7. A seat can read how long its section has been open.
  8. A section that passes its maximum time is recorded as a breach.
  9. That breach sends a message to the architect.
  10. A section that ends normally sends no message to the architect.
  11. The description of `mail_critical_begin` states when to use it.
  12. A reader who has not seen the contract can tell from the tool list when to use it.

### 4.9 Flow control

#### REQ-MAIL-080 — WITHDRAWN: no limit on unread depth
*Withdrawn 2026-08-15 on the lead's ruling: drop it until there is data.*
- **What it said.** The server counted unread messages for each mailbox and sent the architect one message when a mailbox passed a limit.
- **Why it is withdrawn.** The limit would be a number that nobody has measured, and the same objection removed the cap on workers in REQ-MAIL-130 earlier the same day. A threshold that is guessed produces either noise or silence, and neither teaches anything. It was also the last place where the server acted on its own — the same shape as the escalation ladder that REQ-MAIL-030 withdrew.
- **What to do instead.** Count nothing automatically. A reader who wants to know how deep a mailbox is can count the unread messages in it. When a real mailbox saturates, that event gives the number, and this requirement can return with a threshold that reality chose.
- **Acceptance.** The server sends no message about depth. No setting names a depth limit.

#### REQ-MAIL-081 — WITHDRAWN: no count of messages for each turn
*Withdrawn 2026-08-15 on the lead's ruling. REQ-MAIL-082 answers the same worry.*
- **What it said.** The server counted the messages that each seat sent in one turn, and warned the sender above a soft limit.
- **Why it is withdrawn.** The server cannot see a turn. It receives tool calls on a connection, and MCP marks no boundary between one turn and the next, so the server cannot count the thing that this requirement names. The limit would also be a guess, which is the objection that withdrew REQ-MAIL-080 and the cap on workers in REQ-MAIL-130. The first fault is enough on its own: a warning that the server cannot calculate is not a soft limit, it is nothing.
- **The worry that remains.** A tool call costs less than a file, so agents send more messages and smaller ones. Chatter can cost more context than the protocol text that this design removes. REQ-MAIL-082 answers that worry at delivery, where the server has the facts it needs.
- **Acceptance.** The server counts no turn. No setting names a limit for each turn.

#### REQ-MAIL-082 — One pickup takes all outstanding mail
- **Requirement.** `mail_inbox` SHALL return every outstanding message for the seat in one result. It SHALL return the body of each message. It SHALL return them in the order that REQ-MAIL-004 gives. It SHALL set each message that it returns to READ. It SHALL NOT accept a parameter that limits the count. It SHALL NOT accept a parameter that selects a range. `mail_read` SHALL stay available for a message that the seat already has.
- **Reason.** Most of the cost of chatter is the wrapper, not the words: each pickup is a tool call with its own envelope, schema and result frame, and for a short message that overhead is as large as the payload. One result pays it once. The words cost the same either way, because every message expects a reply and the seat cannot skip any of them — so a limit on the count would raise the total cost, not lower it, and would give the seat a way back to one message at a time. The whole set in one result also lets the recipient see that a later message supersedes an earlier one before it starts the work.
- **Acceptance.**
  1. A pickup returns every outstanding message for the seat.
  2. A pickup returns the body of each message.
  3. A pickup returns the messages in the order that REQ-MAIL-004 gives.
  4. A pickup of one outstanding message returns one message.
  5. A pickup with no outstanding message returns an empty result.
  6. A pickup of ten outstanding messages returns one result.
  7. The tool accepts no parameter that limits the count.
  8. The tool accepts no parameter that selects a range.
  9. Each message in the result keeps its own name.
  10. Each message in the result keeps its own signature.
  11. Each message in the result keeps its own state.
  12. Each message in the result becomes READ.
  13. The result holds the count of the messages in it.
  14. A pickup adds no record for the group.
  15. A second pickup returns no message that the first pickup returned.
  16. A message that arrives during a pickup goes to the next pickup.
  17. A pickup that fails leaves each message not READ.
  18. `mail_read` returns a message that an earlier pickup returned.

### 4.10 Operational rules

#### REQ-MAIL-090 — Stop and report; never write files by hand
- **Requirement.** If the server is not available, a seat SHALL stop and report. A seat SHALL NOT write mail files by hand.
- **Reason.** A quiet fallback would run two systems at once and split the record.
- **Acceptance.**
  1. With the server stopped, a send attempt ends the turn with a report.
  2. That attempt writes no file.
  3. The report names the server as unavailable.
  4. No contract text describes a fallback.

#### REQ-MAIL-091 — The clock of the server owns time
- **Requirement.** The server SHALL set the time of each event. An agent SHALL NOT write a time into the data of a message. Each decision about order SHALL use the time of the server.
- **Acceptance.**
  1. A request that sets a time gets a named error.
  2. The `sent_at` of a message is the time of the server.
  3. Each state change carries a time from the server.
  4. Order in `mail_inbox` follows sequence numbers, which the server assigns.

#### REQ-MAIL-102 — Local only
- **Requirement.** The server SHALL run on one machine, SHALL send nothing outside loopback, and SHALL hold no secret in a message body. *This limits the server. It does not limit a condition script (REQ-MAIL-140).*
- **Acceptance.**
  1. The server binds loopback only.
  2. The server makes no connection outside the machine.
  3. The documentation states that this does not cover condition scripts.

#### REQ-MAIL-103 — No product data
- **Requirement.** The server SHALL hold no product data and SHALL NOT reach AWS. *This limits the server. It does not limit a condition script.*
- **Acceptance.**
  1. The server holds no product data.
  2. The server makes no call to AWS.
  3. The documentation states that this does not cover condition scripts.

#### REQ-MAIL-104 — Output follows ASD-STE100
- **Requirement.** Each message that the server writes SHOULD follow ASD-STE100: short sentences, one idea in each, the actor named, and one word for one idea.
- **No test** (ruled 2026-08-15). This is asked for and not tested. A test would need a checker for the controlled language, and a weak test that appeared to verify the style would create trust that it does not earn. This is the same rule as REQ-MAIL-143: state the expectation, and do not pretend to enforce it.
- **Acceptance.** None. This requirement is a request to whoever writes the text, and a reviewer judges it.

### 4.11 The shape of the code

#### REQ-MAIL-148 — A request path is an ordered list of stages
- **Requirement.** The server SHALL build each request path as an ordered list of stages. Each stage SHALL be one module. Each stage SHALL make one check or one action. A list SHALL name the stages of a path and their order, and the server SHALL run them in that order. To add a check SHALL mean to add a module and to name it in the list. To add a check SHALL NOT mean to change another stage.
- **Reason.** Two reasons, and each is enough on its own. First, one acceptance criterion then maps to one module, so a test names one criterion and reads one file. Second, requirements that share a request path can be built at the same time. Without this, fourteen requirements all change the send handler, and the build becomes a chain that is fourteen long (`mail-agent-plan.md` §4.1). That chain is a property of the code and not of the requirements, and this requirement removes it.
- **What this does not mean.** It does not mean that the code that exists is discarded. The handler for a send is being rewritten in any case, because it takes `caller_seat_id`, which REQ-MAIL-111 forbids, and carries `expects_reply`, `deadline_seconds`, and `ttl_seconds`, which this design deleted. The choice is only whether it is written again as one function or as stages.
- **Acceptance.**
  1. Each request path is an ordered list of stages.
  2. Each stage is in its own module.
  3. A list names the stages of each path.
  4. That list gives the order of the stages.
  5. The server runs the stages in the order of the list.
  6. To add a check adds a module.
  7. To add a check adds one entry to the list.
  8. To add a check changes no other stage.
  9. A stage that refuses gives a named error.
  10. A stage that refuses stops the path.
  11. A stage that refuses leaves no partial record.
  12. A test exercises one stage alone.

## 5. What the system does not do

Recorded so nobody builds on an assumption it does not support.

**It watches no clocks.** No deadlines, no automatic escalation, no re-push ladder, no background timer. A driver that wants to know whether work is progressing **asks**, and investigates if it gets no answer. *A deadline promises an end time, and the system cannot guarantee one for the same reason it cannot guarantee interruption. Worse, a clock cannot distinguish slow from stuck: a twenty-minute deploy and a seat wedged after five minutes look identical, so the ladder fired on bad estimates and taught readers to ignore escalations.*

**It cannot stop a model, or make one finish.** Only request, record, and impose consequences.

**It cannot guarantee a condition script is side-effect free**, is idempotent on retry, or terminates — only make termination the author's own interest.

**It does not defend against a hostile seat with filesystem access.** One operating-system user, and the CA key is readable.

**It does not carry payloads.** Artifacts stay as files; messages link and hash them.

**It does not rule.** It routes, orders, and records.

**Deferred:** cross-machine seats; a lead-driven sweep of dangling threads (v1.1); per-block capability classes for scripts; separate operating-system users per seat.

---

## 6. Method — red/green, mandatory

House practice, not a suggestion.

1. Enumerate failure modes first, as acceptance tests derived from these requirements.
2. Run them and **show them failing for the right reason** — a missing feature, never a setup accident. A red test that fails on a typo proves nothing.
3. Implement one item at a time: its tests green, then the full suite green, then the next.
4. **Never edit a test to make it pass.** If a test is wrong, stop and say so.
5. An existing test may change only where it pins behavior these requirements declare defective, and every such change is reported with its justification.
6. **Prove the greens detect regressions**: mutate each fix in a scratch copy and confirm the matching test fails.

### 6.1 What makes an acceptance criterion valid

**An empty repository SHALL fail every acceptance criterion.** A criterion that an empty repository
satisfies cannot tell "built correctly" from "not built at all", which is the one thing a criterion
is for. Ruled 2026-08-16 by the lead, after the first red phase produced seventeen passing tests on
a system that did not exist.

Therefore a criterion SHALL state a property that is present, and SHALL NOT state the absence of a
fault. "A search of the source finds no function that writes to a published record" is satisfied by
an empty directory. "Exactly one function writes a record, and it only ever creates a new file"
fails until the writer exists, and is also the stronger claim, because the negative form is defeated
by any function whose name a search does not match.

### 6.2 Rules for the test suite, which are not acceptance criteria

These are rules for whoever writes the tests. They are not properties of the system, so they hold no
criterion number and no test proves them. They were criteria until 2026-08-16 and were removed
because each one passed on the day it was written and could never fail.

- No test claims a guarantee stronger than the requirement states (was REQ-MAIL-117.4).
- No test asserts that a message cannot be dropped (was REQ-MAIL-125.4).
- A test enforces the checks on disabled verification (was REQ-MAIL-127.8).
- No test claims to verify that a condition script changes nothing (was REQ-MAIL-143.3).
- No test depends on an option or a configuration path of one harness (was REQ-MAIL-144.3, .4).

### 6.3 A red test defines an interface

A test written before the code decides what the code will be called and where it will live. If that
is not written down, every author invents one: the first red phase produced 65 files importing 40
different module paths, so the suite described forty systems instead of one. The module each
requirement belongs to SHALL be named before its test is written. `scripts/module-map.json` holds
that map.

**And for anything an agent must do unprompted, the trigger belongs in the tool description** (D25) — contract text decays with context; a tool description is re-presented with every listing and does not. It is the cheapest durable instruction channel available, and this design leaves it largely unused.

---

## 7. Sources

Decisions `D1`–`D26`, findings `F1`–`F12`, the open-question register, and the disposition of previously built code live in `mail-mcp-identity-spec.md` §2, §7, §8, and its code-disposition section. `mail-mcp-prd.md` and `mail-mcp-proposal.md` are retained as history. Where any of them disagrees with this document, this document wins.

---

## Appendix A — Decisions of record

Provenance, not specification. Each requirement traces to one of these. A decision that a later one amends names its amendment. The full reasoning for each is in `mail-mcp-identity-spec.md` §2.

Each requirement traces to one of these. A decision amended by a later one names its amendment.

| Decision | What was decided |
|---|---|
| D1-build-before-week-7 | Build the server before week 7 | Agreed in principle. Walkthrough pending. |
| D2-hybrid-transport | Hybrid transport: MCP for state, prime-agent for the wake | Agreed in principle. Walkthrough pending. |
| D3-interrupt-authority | Interrupt authority per REQ-MAIL-041 | Agreed in principle. Walkthrough pending. |
| D4-critical-sections-mandatory | Critical sections mandatory for deploy and merge | Agreed in principle. Walkthrough pending. |
| D5-soft-turn-limit | Keep a soft per-turn message limit | Agreed in principle. Walkthrough pending. |
| D6-v1-v2-split | V1 / V2 split per §8 | Agreed in principle. Walkthrough pending. |
| D7-https-daemon | Transport moves from stdio to Streamable HTTP over HTTPS on localhost, one daemon. |
| D8-mtls-client-auth | Client authentication is mutual TLS. The server trusts one root. Possession of the private key plus a valid chain to that root is sufficient — no allow-list of minted certificates. |
| D9-mint-at-launch | The **architect** is the root of the mail topology and the only seat a human provisions. The certificate authority is created and the architect's certificate minted **at launch**, by the process the lead starts. No other minting path exists. (Amended 2026-08-15 by D19-lead-is-out-of-band: the lead is not a mail seat and needs no certificate.) |
| D10-register-is-enroll | Registration and enrollment are one atomic operation. `mail_register_seat`, called by an authenticated lead or architect, carries the new seat's CSR and returns its signed certificate. (Amended by D14-client-generated-keys: the seat generates its own key pair; the server signs a CSR and never holds a private key.) |
| D11-identity-in-cert | Identity lives in the certificate. Role and lane stay in the seat registry. The certificate answers "who are you"; the registry answers "what may you do". |
| D12-dereg-is-revocation | Deregistration is revocation. No CRL, no OCSP. |
| D13-signatures-mandatory | Per-message signatures are **mandatory**, not deferred. Every message carries a sender signature and a server counter-signature, and the record is verifiable offline (REQ-MAIL-120…123). |
| D14-client-generated-keys | Seats generate their own key pairs and submit a CSR at registration. The server signs and returns a certificate; it never possesses a seat's private key. Delivered messages carry the sender's signature and certificate chain, so a recipient verifies against the root rather than trusting the server (REQ-MAIL-114, REQ-MAIL-124). |
| D15-long-lived-certs | Certificates are long-lived. Deregistration disables a seat's access immediately; expiry is never used as an access-control mechanism. A stored message stays verifiable after the session ends, after the seat is deregistered, and after the certificate expires — a valid chain is sufficient (REQ-MAIL-116, REQ-MAIL-123). |
| D16-incremental-record | The message file is never rewritten. Header and body are written once and stay immutable; every subsequent event — state transitions, the ack and its note, supersession, pushes, escalations — is recorded as an **additional record**, never as a modification. Rewriting does not scale; accretion is constant-cost and keeps the record honest. Each record is written beside and moved into place, so it is atomic by construction (REQ-MAIL-133, REQ-MAIL-134). |
| D17-immutable-records | A published log entry is immutable, without exception. Records are made read-only before they are moved into place, no code path exists that opens one for writing, a correction is always a new record citing the original, and any alteration is detectable after the fact. Only derived caches may be rewritten, and only by full rebuild (REQ-MAIL-136). |
| D18-two-block-forms | Blocking has two distinct forms with opposite subjects. `i_am_blocked_by: <condition>` marks the **sender** blocked from the moment it sends. `you_are_blocked_until: <condition>` marks the **recipient** blocked. In both cases BLOCKED constrains work only — a blocked seat still sends, reads, and acks mail, or it could never receive what unblocks it. Conditions are either server-evaluable predicates, cleared automatically with no round trip, or free text, cleared only by the seat that imposed them. A blocked seat has no surface by which to release an imposed block at all — enforced by absence, because a drifted agent will use any surface it is given (REQ-MAIL-137). |
| D19-lead-is-out-of-band | The lead is a human and not a mail seat at any level. Inbound to agents: typing into the architect's TUI, or any seat's prompt aperture. Outbound to the lead: the architect pages them over the iMessage MCP. The lead holds no certificate, no mailbox, and no ACL rights; every "lead or architect" rule collapses to architect. The lead reads the record as files, which makes REQ-MAIL-070 a primary interface rather than an audit trail. Out-of-band instruction that touches an open mail item must be recorded in mail, or the record silently diverges from reality. |
| D20-no-clocks | The server watches no clocks. No deadlines, no automatic escalation, no background timer. Every message expects a reply; a thread stays open until its opener closes it; open threads are the outstanding-work view. If a driver wants to know whether work progresses, it asks (REQ-MAIL-024, REQ-MAIL-030). |
| D21-scripts-run-unrestricted-for-now | A condition script may do anything the seat that wrote it may do — filesystem, network, AWS, anything. No sandbox, no allowlist, no capability limits in the first build. Ruled 2026-08-15 on the grounds that every seat already runs as one operating-system user, so there is no privilege boundary between them to enforce, and building one now would cost more than it protects. Revisited when seats gain separate identities at the OS level, or when a script causes a real incident. REQ-MAIL-140. |
| D22-server-holds-and-evaluates | The condition script lives in the immutable block record and the **server** is its only evaluator. A seat may read a condition — it must know what is expected of it — but no seat ever runs one or reports a result. The recipient's only move is to ask the server to check. Evaluation is event-driven for conditions the server can answer from its own state, and on request for scripts; nothing runs on a timer. Because the server evaluates, it always knows the true block state without asking anyone (REQ-MAIL-141). |
| D23-the-thread-is-the-session | The unit of lifetime is the **relationship**, not a process. A thread lives from the opener's first message until the opener closes it — across restarts, disconnections, and postponed work. Condition results live with the thread and survive any instance dying. Closing a thread makes its blocks **inert**, not deleted: the record keeps the condition, every evaluation, and the fact that it became moot on close. A lead-driven sweep to close dangling threads is deferred to v1.1 (REQ-MAIL-142). |
| D24-harness-agnostic-by-construction | The server SHALL know nothing about harnesses. Seats may run prime-agent, opencode, Claude Code, or anything later — xAI's Grok client is expected — and may differ by lane and by model. Harness knowledge lives in the seat launcher and in opaque per-seat registry data: a `wake_command` recorded at provisioning, and a permission grant rendered into whatever config shape that harness reads. Adding a harness is a launcher change and requires no server change. The protocol SHALL assume the weakest model in the fleet, never the strongest (REQ-MAIL-144). |
| D25-tool-descriptions-are-the-durable-instruction-layer | Contract text decays with context; an MCP tool description is re-presented with the tool list every time and does not. So for anything an agent must do **unprompted**, the description SHALL carry the *trigger* — when to reach for this — not merely the mechanics. This is the cheapest place to put behavior that must survive compaction (REQ-MAIL-145). |
| D26-critical-sections-withhold-rather-than-halt | Critical sections are kept, with an honest rationale. The server cannot compel a model to stop, but it can reliably **decline to hand it a reason to** — withholding is enforceable where compelling is not. That is the only lever available during a dangerous operation, and it is worth keeping (REQ-MAIL-145). |

---

---

## Appendix B — Traceability matrix

*Generated from §4. Regenerate it whole rather than editing a row, and keep Appendix C after it.*

Each criterion is addressable as `REQ-MAIL-nnn.n`. A test SHALL name the criterion that it covers. A withdrawn requirement keeps its number so that a reader who meets it elsewhere can find out what happened to it. §6.1 governs what a criterion may say.

| Requirement | Title | Criteria |
|---|---|---|
| REQ-MAIL-002 | The server derives the sender; the client does not declare it | 4 |
| REQ-MAIL-111 | Identity comes from the TLS peer certificate | 7 |
| REQ-MAIL-112 | The seat name is in the Subject Alternative Name | 6 |
| REQ-MAIL-113 | The server makes the authority and the architect certificate at launch | 12 |
| REQ-MAIL-114 | Registration signs a client-made CSR; private keys do not move | 19 |
| REQ-MAIL-115 | Deregistration is revocation | 8 |
| REQ-MAIL-116 | Certificates have a long life | 5 |
| REQ-MAIL-126 | The server makes its own serving certificate | 5 |
| REQ-MAIL-127 | Both ends configure trust; no one disables verification | 7 |
| REQ-MAIL-117 | Key material on disk, and the risk that stays | 4 |
| REQ-MAIL-118 | Secrets do not enter the record | 4 |
| REQ-MAIL-110 | One daemon owns the mailbox | 9 |
| REQ-MAIL-139 | The per-seat shim holds the key and signs | 8 |
| REQ-MAIL-011 | The wake is a courtesy, not the delivery mechanism | 7 |
| REQ-MAIL-012 | The wake carries no content | 5 |
| REQ-MAIL-144 | Harness-agnostic by construction | 5 |
| REQ-MAIL-001 | The server assigns identity and order | 13 |
| REQ-MAIL-003 | The recipient is named and checked | 5 |
| REQ-MAIL-004 | Service order is defined | 6 |
| REQ-MAIL-005 | The kind vocabulary is closed | 4 |
| REQ-MAIL-010 | Two delivery classes, which state intent | 6 |
| REQ-MAIL-014 | Broadcast | 9 |
| REQ-MAIL-015 | An interrupt cancels the work that it interrupts | 9 |
| REQ-MAIL-024 | Each message expects a reply; the opener closes the thread | 8 |
| REQ-MAIL-020 | Four states | 8 |
| REQ-MAIL-021 | The disposition is explicit | 8 |
| REQ-MAIL-022 | Read receipts replace the `Seen:` header | 3 |
| REQ-MAIL-060 | Repeated calls are safe | 6 |
| REQ-MAIL-061 | The queue survives a restart and an idle seat | 6 |
| REQ-MAIL-062 | Read the queue before other work | 3 |
| REQ-MAIL-063 | Supersede | 7 |
| REQ-MAIL-137 | Two block forms, with opposite subjects | 14 |
| REQ-MAIL-141 | The server holds the condition and is the only authority | 14 |
| REQ-MAIL-142 | The outcome of a condition, and how it changes | 16 |
| REQ-MAIL-146 | How a condition runs: requests, locks, and processes | 14 |
| REQ-MAIL-147 | The lifetime of a condition, and what closing a session does | 16 |
| REQ-MAIL-140 | Condition scripts run with no limits | 5 |
| REQ-MAIL-143 | Scripts are asked to change nothing; nothing enforces it | 3 |
| REQ-MAIL-070 | The record is files, and a person can read them | 9 |
| REQ-MAIL-133 | The envelope grows; it is never rewritten | 10 |
| REQ-MAIL-134 | A file is the unit; the directory is the log | 10 |
| REQ-MAIL-135 | Damage is found, located, and never ignored | 10 |
| REQ-MAIL-136 | Records do not change, enforced four ways | 9 |
| REQ-MAIL-071 | A sent message is never edited | 5 |
| REQ-MAIL-072 | Artifact integrity | 7 |
| REQ-MAIL-120 | Each message carries a signature from its sender | 11 |
| REQ-MAIL-121 | The server signs the fields that it adds | 6 |
| REQ-MAIL-122 | The record can be checked with no server | 8 |
| REQ-MAIL-123 | The record outlives the session, the seat, and the certificate | 6 |
| REQ-MAIL-124 | What is needed to check a message travels with it | 8 |
| REQ-MAIL-125 | What signatures prove, and what they do not | 4 |
| REQ-MAIL-040 | Access control | 7 |
| REQ-MAIL-041 | Who may interrupt | 6 |
| REQ-MAIL-042 | Seat registration | 11 |
| REQ-MAIL-130 | An orchestrator may make workers in its own lane | 6 |
| REQ-MAIL-131 | A seat may not give more than it holds | 5 |
| REQ-MAIL-138 | Permission is given when a seat is made, not asked for later | 7 |
| REQ-MAIL-129 | No seat waits for a person with no end | 5 |
| REQ-MAIL-145 | A critical section holds a message; it does not stop work | 12 |
| REQ-MAIL-080 | WITHDRAWN: no limit on unread depth | — (withdrawn) |
| REQ-MAIL-081 | WITHDRAWN: no count of messages for each turn | — (withdrawn) |
| REQ-MAIL-082 | One pickup takes all outstanding mail | 18 |
| REQ-MAIL-090 | Stop and report; never write files by hand | 4 |
| REQ-MAIL-091 | The clock of the server owns time | 4 |
| REQ-MAIL-102 | Local only | 3 |
| REQ-MAIL-103 | No product data | 3 |
| REQ-MAIL-104 | Output follows ASD-STE100 | — (asked for, not tested) |
| REQ-MAIL-148 | A request path is an ordered list of stages | 12 |
| **Total** | **68 requirements** | **504** |

## Appendix C — Dependency graph and build order

Moved to `mail-agent-plan.md` §1. The graph is derived from §4 of this document and changes
whenever §4 changes. It is kept in one place only, so that the two cannot disagree.

