<!-- Copyright (C) CVK Group LLC 2026. All rights reserved. -->

# Specification — mutual-TLS identity and single-daemon transport

| Field | Value |
|---|---|
| Document version | 0.1 DRAFT |
| Date | 2026-08-15 |
| Superseded by | **`mail-mcp-prd.md` is now the authoritative requirements document.** This file is retained for its decision record (§2), findings (§7), open-question register (§8), code disposition (§8.1), and sequencing (§9) — the reasoning behind the requirements. Where the two disagree, the PRD wins. |
| Status | **AUTHORIZED — the lead lifted the hold 2026-08-15.** Both conditions met: the hands-on testing session produced findings F8–F12, and the §8 register closed at 21 of 23. The steering gate ran (F7-steer-flag-does-not-exist). Client capability is scoped **into** the batch rather than gating it, and narrowed to prime-agent. Implementation proceeds under the red/green method of §6 — that method is not optional. |
| Supersedes | `FIXLIST.md` def-ident-001 (caller identity is self-declared) and def-arch-001 (stdio breaks the single-owner mailbox) |
| Extends | `mail-mcp-prd.md` REQ-MAIL-002 (sender identity is bound, not declared), REQ-MAIL-042 (seat registration), REQ-MAIL-102 (local only) |
| Method | **Red/green, mandatory.** See §6. |
| Written in | ASD-STE100 |

## 1. Why this exists

Two critical defects survive the first implementation round, and one change closes both.

`caller_seat_id` is a plain string parameter on all 13 tools. A caller states who it is; the server believes it. The registration ACL added in Batch B (only lead or architect may register a seat) is therefore a lock with no wall: any client can send `caller_seat_id: "lead"`. REQ-MAIL-002 requires the opposite — the server SHALL derive the sender from the caller's authenticated identity.

The server also runs on `StdioServerTransport`. Every MCP client spawns its own process, each with its own in-memory store and sequence counter over one shared directory. Two seats therefore collide on `seq`, never see each other's mail, and interleave writes to `mail.jsonl`. This is the Week-3 collision cascade rebuilt inside the tool that exists to prevent it.

Mutual TLS over one HTTPS daemon fixes both at once: the transport carries a cryptographic identity, and one process owns the mailbox.

## 2. Decisions taken (lead, 2026-08-15)

Decision references carry both halves: `D<n>-<what-was-decided>`. The number preserves the order
the decisions were taken; the name means a reader never has to look one up. Both halves are stable —
a decision is never renumbered or renamed. A decision amended by a later one names its amendment.

| Decision | What was decided |
|---|---|
| D7-https-daemon | Transport moves from stdio to Streamable HTTP over HTTPS on localhost, one daemon. |
| D8-mtls-client-auth | Client authentication is mutual TLS. The server trusts one root. Possession of the private key plus a valid chain to that root is sufficient — no allow-list of minted certificates. |
| D9-mint-at-launch | The **architect** is the root of the mail topology and the only seat a human provisions. The certificate authority is created and the architect's certificate minted **at launch**, by the process the lead starts. No other minting path exists. (Amended 2026-08-15 by D19-lead-is-out-of-band: the lead is not a mail seat and needs no certificate.) |
| D10-register-is-enroll | Registration and enrollment are one atomic operation. `mail_register_seat`, called by an authenticated lead or architect, carries the new seat's CSR and returns its signed certificate. (Amended by D14-client-generated-keys: the seat generates its own key pair; the server signs a CSR and never holds a private key.) |
| D11-identity-in-cert | Identity lives in the certificate. Role and lane stay in the seat registry. The certificate answers "who are you"; the registry answers "what may you do". |
| D12-dereg-is-revocation | Deregistration is revocation. No CRL, no OCSP. |
| D13-signatures-mandatory | Per-message signatures are **mandatory**, not deferred. Every message carries a sender signature and a server counter-signature, and the record is verifiable offline (REQ-MAIL-120…123). |
| D14-client-generated-keys | Seats generate their own key pairs and submit a CSR at registration. The server signs and returns a certificate; it never possesses a seat's private key. Delivered messages carry the sender's signature and certificate chain, so a recipient verifies against the root rather than trusting the server (REQ-MAIL-114, REQ-MAIL-124). |
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
| D15-long-lived-certs | Certificates are long-lived. Deregistration disables a seat's access immediately; expiry is never used as an access-control mechanism. A stored message stays verifiable after the session ends, after the seat is deregistered, and after the certificate expires — a valid chain is sufficient (REQ-MAIL-116, REQ-MAIL-123). |

## 3. Requirements

### REQ-MAIL-110 — One daemon owns the mailbox
- **Required behavior.** The server SHALL run as one long-lived process exposing the MCP Streamable HTTP transport over HTTPS, bound to loopback only. Many clients SHALL connect to that one endpoint. The server SHALL refuse to bind a non-loopback interface.
- **Current state.** `StdioServerTransport`; one process per client; per-process store and sequencer.
- **Acceptance criteria.** Two concurrently connected clients each send 500 messages; all 1000 `seq` values are unique and gapless, and both clients see each other's messages through `mail_inbox` and `mail_audit` without a restart. A bind attempt on a non-loopback address fails with a named error.

### REQ-MAIL-111 — Identity is bound to the TLS peer certificate
- **Required behavior.** The server SHALL derive the calling seat from the verified peer certificate of the TLS connection. `caller_seat_id` SHALL be removed from every tool schema. No request field SHALL be able to change the effective caller.
- **Acceptance criteria.** A connection presenting the `worker-a` certificate acts as `worker-a` for every tool call. There is no parameter by which it can read, ack, send as, or audit as another seat. Every stored message's `from` equals the connection's bound identity.

### REQ-MAIL-112 — Seat name in the Subject Alternative Name
- **Required behavior.** The seat id SHALL be carried in a SAN entry, not in the Common Name. The server SHALL parse the SAN and map it to a seat id. A certificate with no usable SAN SHALL be rejected at the handshake or on first call, with a named error.
- **Rationale.** Modern TLS stacks ignore CN for identity.
- **Acceptance criteria.** A certificate naming `orch` in its SAN binds to seat `orch`. A certificate carrying the seat name only in CN is rejected. The chosen SAN form (URI, for example `spiffe://agent-mail/lane-a/orch`, or dNSName under a reserved suffix) is documented and used consistently.

### REQ-MAIL-113 — The authority and the architect certificate are created at launch
*Amended 2026-08-15 (D19-lead-is-out-of-band): every reference to "the lead seat" below means **the architect**. The lead is not a mail seat and receives no certificate.*
- **Required behavior.** On first launch the server SHALL create a **self-signed root certificate authority** — its own trust anchor, signed by no one else — and SHALL mint the lead seat's key and certificate, and SHALL register the lead seat. The root SHALL be marked as a CA (basic constraints `CA:TRUE`) with key usage for certificate signing, and SHALL be written where clients can read the public certificate but only the server can read the private key. The lead's id and lane SHALL come from launch configuration. No tool, endpoint, or unauthenticated path SHALL mint a certificate.
- **Rationale.** The party that launches the process already holds filesystem control of the machine. Granting it the lead identity adds no privilege it does not already have. Every other bootstrap merely relocates the trust question.
- **The lead key is the one exception to D14-client-generated-keys, and only in the narrow sense.** The lead's key pair is generated at launch by the process the lead itself started, written straight to a file with owner-only permissions, and never transmitted over any channel. The server SHALL discard it from memory once written and SHALL NOT retain it. This is the same trust boundary, not a transfer across one. Every other seat follows REQ-MAIL-114 (client-generated key, CSR only). An implementation MAY instead accept a pre-generated lead key path at launch, which removes the exception entirely and is the preferred option if the launcher can provide one.
- **Acceptance criteria.** A first launch produces a CA, a lead key and certificate at a documented path, and a registered lead seat. A second launch reuses the CA and does not duplicate the registry row. There is no code path that signs a certificate for an unauthenticated caller. The lead key is never written to the record tree, never logged, and never sent over a connection.

### REQ-MAIL-114 — Registration signs a client-generated CSR; private keys never move
- **Required behavior.** The seat SHALL generate its own key pair locally and produce a certificate signing request. `mail_register_seat`, called over an authenticated connection by a lead or architect, SHALL carry that CSR, SHALL create the registry row, SHALL sign the CSR, and SHALL return the certificate. A private key SHALL NEVER be transmitted, and the server SHALL NEVER possess a seat's private key. A failure in either half SHALL leave neither a registry row nor a signed certificate behind.
- **CSR handling.** The server SHALL NOT trust any identity asserted inside the CSR. It SHALL take the seat id, role, and lane from the authenticated registration call, and SHALL set the SAN itself when signing. A CSR requesting a different subject SHALL be signed with the server's values, or rejected — never honored.
- **Who produces the CSR.** Only a lead or architect may register (REQ-MAIL-113), but the key must belong to the new seat. The primary flow is therefore: the seat launcher, running locally with the lead's authority, generates the key pair in the seat's own home directory and passes only the CSR to the lead's `mail_register_seat` call; the certificate is written back beside the key. A secondary flow MAY be specified later for a seat that must enroll itself (registration issues a single-use enrollment nonce, and the seat submits its CSR with that nonce), but it is not required by this batch.
- **Rationale.** A private key that travels is a private key that can be logged, cached, or intercepted. Client-generated keys also mean a compromised or buggy server cannot sign as any seat but itself.
- **Acceptance criteria.** Registration accepts a CSR and returns a certificate whose SAN names the registered seat. The new seat connects with its locally held key and is bound to its own id. No private key appears in any request, response, log line, or file written by the server. A CSR whose subject claims a different seat does not produce a certificate for that seat. No registered seat exists without a certificate, and no certificate exists for an unregistered seat. A worker calling `mail_register_seat` fails.

### REQ-MAIL-115 — Deregistration is revocation
- **Required behavior.** The server SHALL resolve role and lane from the registry on every call. `mail_deregister_seat`, restricted to lead and architect, SHALL remove a seat. A removed seat's certificate SHALL become inert: the connection may still authenticate, but every tool call SHALL fail with a named error.
- **Rationale.** Authorization already reads the registry on each call, so registry membership is the revocation mechanism. No CRL or OCSP infrastructure is required.
- **Acceptance criteria.** After deregistration, a seat holding a valid certificate and private key can no longer send, read, ack, or audit. Its stored mail record is unchanged.

### REQ-MAIL-116 — Certificates are long-lived; access is controlled by registration, not expiry
- **Required behavior.** Certificates SHALL carry a long validity period, configurable, defaulting to well beyond the expected engagement. Access SHALL be withdrawn by deregistration (REQ-MAIL-115), never by waiting for a certificate to expire. A seat that is stopped and resumed SHALL reuse the key and certificate already in its home directory, with no re-provisioning step.
- **Rationale.** Short lifetimes exist to bound the damage of a leaked key when revocation is impossible. Revocation is not impossible here: the server resolves role and lane from the registry on every call, so removing the row cuts access **immediately** — which is strictly better than waiting out an expiry window. Short-lived certificates would add a re-provisioning dance, a clock-skew failure mode mid-engagement, and no security the registry check does not already provide.
- **Acceptance criteria.** A seat stopped and resumed days later connects with its original certificate and drains its queued mail in order (REQ-MAIL-061). A deregistered seat holding a valid, unexpired certificate is refused on every call. Certificate expiry is not used anywhere as an access-control mechanism.

### REQ-MAIL-117 — Key material at rest, and the stated residual risk
- **Required behavior.** The CA private key and all seat private keys SHALL be written with owner-only permissions and SHALL NOT be written inside the mail record tree. The server SHALL support supplying a passphrase at launch to encrypt the CA key at rest. The documentation SHALL state the residual risk plainly (below).
- **Residual risk, accepted.** All seats run under one operating-system user. A seat with filesystem access can therefore read the CA key and mint any identity. This design defeats accidental impersonation, forged author tokens, and the whole "wrong seat wrote this" failure class. It does not defeat a hostile seat that already has filesystem access. Separate users or a hardware-backed keystore would be needed for that, and are out of scope.
- **Acceptance criteria.** Key files are mode 0600 and outside the record tree. The residual risk paragraph appears in the README. No test asserts a stronger guarantee than this.

### REQ-MAIL-118 — Secrets never enter the record
- **Required behavior.** A minted private key SHALL never be written to a message file, to `mail.jsonl`, to `seats.json`, or to any log line.
- **Acceptance criteria.** After a registration that mints a key, no file under the mail directory contains any part of that key.

### REQ-MAIL-119 — Launch configuration replaces the bootstrap variable
- **Required behavior.** `AGENT_MAIL_BOOTSTRAP` SHALL be removed. Launch configuration SHALL name the lead seat's id and lane, the bind port, the certificate directory, and the certificate lifetime. Startup SHALL fail fast with an actionable message when configuration is missing or malformed.
- **Acceptance criteria.** A documented launch command produces a running, reachable daemon with a registered lead. Every failure mode names the setting that is wrong.

### REQ-MAIL-120 — Every message carries a sender signature (MANDATORY)
- **Required behavior.** The sender SHALL sign the message payload with its private key and submit the signature with the send. The server SHALL verify the signature against the public key of the connection's bound certificate and SHALL reject any message whose signature is absent, malformed, or does not verify. An unsigned send SHALL NOT be stored and SHALL NOT be pushed.
- **What is signed.** The client cannot sign `id`, `seq`, `sent_at`, or `thread` — the server assigns those after the send. The sender signature SHALL therefore cover exactly the client-authored payload, over a canonical byte encoding defined once and documented: `to`, `kind`, `class`, `subject`, `body`, and each artifact `path` with its `sha256`. The canonical encoding SHALL be deterministic (fixed field order, explicit length framing or a canonical JSON form) so that verification never depends on formatting.
- **Rationale.** Mutual TLS authenticates the channel, not the stored artifact. Once the connection closes, nothing in the record proves who wrote a message. A signature makes every envelope provable on its own and turns REQ-MAIL-071 immutability into tamper evidence.
- **Acceptance criteria.** A send with a valid signature is stored with that signature in the envelope and in the index. A send with no signature is rejected with a named error and stores nothing. A send whose signature was made by a different seat's key is rejected. A send whose body is altered after signing is rejected. The canonical encoding is covered by its own unit test, including field-order and unicode stability.

### REQ-MAIL-121 — The server counter-signs its assigned fields
- **Required behavior.** After assigning `id`, `seq`, `sent_at`, and `thread`, the server SHALL sign the complete envelope — the sender signature plus its own assigned fields — with a dedicated server key whose certificate chains to the same root. Both signatures SHALL be stored. Server-authored messages (escalations, saturation and critical-section notices, sent as `agent-mail`) carry the server signature only, and SHALL be identifiable as server-authored.
- **Rationale.** The sender signature proves authorship; it cannot prove ordering, because the sender does not know its own `seq`. Without a counter-signature, sequence and timestamps remain unattested — and sequencing is the failure this whole project exists to fix.
- **Acceptance criteria.** Every stored message carries a verifiable server signature over its assigned fields. Altering `seq` or `sent_at` in a stored record makes verification fail. A message claiming to be from `agent-mail` without a valid server signature fails verification.

### REQ-MAIL-122 — The record is verifiable offline
- **Required behavior.** A verification tool SHALL check a mailbox with no running server: for each message file and index entry, it SHALL verify the sender signature against the sender's certificate, verify the server counter-signature, and verify both certificates chain to the trusted root. It SHALL report per-message OK, ALTERED, UNSIGNED, or UNKNOWN-SIGNER, and SHALL exit non-zero if any message fails.
- **Rationale.** Non-repudiation that requires the accused party's own server to confirm it is worth little. The engagement record must be checkable by anyone holding the root certificate.
- **Acceptance criteria.** The tool passes on an untampered mailbox. Editing one byte of one message body makes that message report ALTERED and the tool exit non-zero. Deleting an index line is reported. The tool needs no network and no running daemon.

### REQ-MAIL-123 — The record outlives the session, the seat, and the certificate
- **Required behavior.** Verification of a stored message SHALL depend only on the signatures and the certificate chain, never on live state. A message SHALL still verify as authentic after its sender disconnects, after that seat is deregistered, and after its certificate expires. Verification SHALL check that the chain is valid and that the signing certificate was within its validity window at the message's `sent_at` — never that the certificate is valid *now*. The record SHALL retain the signer's certificate chain so verification needs no registry lookup.
- **Rationale.** Two different questions get confused here. "May this seat act?" is a live question, answered by the registry at call time. "Did this seat write this?" is a historical question, answered forever by the signature and the chain. Deregistration answers the first and must never touch the second: the engagement record is the debugging record, and a message that stops being verifiable because a worker was retired is a record that erases itself.
- **Acceptance criteria.** A message sent by a seat that is later deregistered still verifies, naming its original signer. A message whose signing certificate has since expired still verifies. The offline verifier (REQ-MAIL-122) produces identical results on a mailbox whose seats have all been deregistered and whose certificates have all expired.

### REQ-MAIL-124 — Verification materials travel with the message
- **Required behavior.** `mail_read`, `mail_thread`, and `mail_inbox` SHALL return, with each message, the sender signature, the server counter-signature, and the sender's certificate chain. A recipient SHALL be able to verify authorship and ordering using only the response and the root certificate it already trusts — with no second call, no registry lookup, and no reliance on the server's assertion.
- **Rationale.** The recipient trusts the root, not the server. Carrying the sender's certificate with the message closes the loop end to end: the sender signed the content, the server counter-signed its assigned fields, both chain to the one root, so a genuine message is provable at the point of delivery.
- **Acceptance criteria.** A recipient verifies a received message offline from the response alone. A message whose body was altered after signing fails recipient-side verification. A message whose sender certificate does not chain to the trusted root fails. `mail_inbox` carries enough to verify headers without exposing bodies (REQ-MAIL-012).

### REQ-MAIL-125 — What signatures do and do not prove
- **Required behavior.** The documentation SHALL state the guarantee precisely, and no test or contract text SHALL claim more.
- **Proven.** Authorship (only the holder of the seat's private key could have written this content); integrity (any alteration of body, subject, recipient, kind, class, or artifact hash is detectable); ordering and time as attested by the server (`seq`, `sent_at`); and all of it verifiable after the fact by any holder of the root certificate, including after the signer's certificate expires or its seat is deregistered.
- **Not proven.** Availability — a faulty or hostile server can still drop, delay, or withhold a message; signatures make forgery detectable, not delivery guaranteed. Sequence gaps and missing counter-signatures make suppression *visible* in the record, but do not prevent it. Nor does any of this defend against a party that can read the certificate authority's private key, which on a single-user machine means any seat with filesystem access (REQ-MAIL-117).
- **Acceptance criteria.** The README and the contract text state both halves. A deliberate message-suppression scenario is documented as detectable-but-not-preventable.

### REQ-MAIL-126 — The server mints its own serving certificate from the root
- **Required behavior.** At launch, after creating or loading the root (REQ-MAIL-113), the server SHALL mint its own TLS **serving** certificate signed by that root, with SAN entries covering the loopback names it binds (`localhost`, `127.0.0.1`, `::1`), and SHALL present it on every connection. This is a leaf certificate, distinct from the root and from any seat certificate. The server SHALL NOT serve the root certificate itself as its serving certificate.
- **Rationale.** A self-signed root is a trust anchor, not a server identity. Serving the root directly conflates the two and means the key that signs every seat is also handling every connection.
- **Acceptance criteria.** A client connecting to the daemon receives a leaf certificate that chains to the root and whose SAN matches the address it dialed. The serving certificate and the root are different certificates. Hostname verification succeeds without the client disabling any check.

### REQ-MAIL-127 — Trust is configured explicitly at both ends; verification is never bypassed
- **Required behavior.**
  - **Server side.** The HTTPS listener SHALL be configured with the root as its certificate authority, SHALL request a client certificate, and SHALL reject unauthorized peers (`ca`, `requestCert: true`, `rejectUnauthorized: true`). A connection presenting no client certificate, or one that does not chain to the root, SHALL be refused at the handshake.
  - **Client side.** Every client SHALL be given the root certificate explicitly as its trust anchor for this connection — preferably by passing it to the client transport, rather than by widening process-global trust. The root is the *only* additional anchor required.
  - **Absolute prohibition.** No code, script, test, launcher, config, or documentation SHALL disable TLS verification. `rejectUnauthorized: false` and `NODE_TLS_REJECT_UNAUTHORIZED=0` SHALL NOT appear anywhere in the repository.
- **Rationale.** Self-signed roots produce exactly one predictable failure — an untrusted-certificate error on first connection — and exactly one tempting shortcut, which is to switch verification off. Taking that shortcut converts this entire design into decoration: an unverified channel authenticates nobody. The prohibition is written as a requirement so it is enforced by a test rather than by discipline.
- **Note on process-global trust.** `NODE_EXTRA_CA_CERTS` works, but it widens trust for *every* TLS connection the process makes, not just the mail connection. Prefer passing the root explicitly to the transport. If the environment variable is used because a client cannot be configured directly, that SHALL be documented as a deliberate exception.
- **Acceptance criteria.** A client with the root configured connects and completes an authenticated call. A client without the root fails to connect, and the failure names the untrusted certificate. A client presenting no certificate is refused. A repository-wide search finds no verification-bypass flag or environment variable — this check is itself a test.

### REQ-MAIL-128 — Seat provisioning grants the whole mail surface in one rule
- **Required behavior.** Whatever launches a seat SHALL provision that seat's harness permission configuration as part of creating the seat, alongside its key, certificate, and registry row. The grant SHALL be a single server-scoped rule covering the entire `agent-mail` tool surface — never a per-tool list. Adding a tool to the server SHALL NOT require editing any seat's configuration. No seat SHALL be launched with a blanket permission bypass (`--dangerously-skip-permissions` or any equivalent): the grant is scoped to this server's tools, not to everything the harness can do.
- **Rationale.** A per-tool allowlist is a latent deadlock. The tools a seat uses on day one get approved; the one it needs for the first time on day four prompts, and by then nobody is watching. A server-scoped rule is also the only future-proof form, since `mail_reply`, `mail_thread`, and `mail_seats` did not exist a week ago.
- **Acceptance criteria.** A freshly provisioned seat completes register, send, inbox, read, ack, reply, thread, status, audit, supersede, and seats without a single approval prompt. Adding a twelfth tool to the server requires no change to any seat's configuration. No seat configuration anywhere contains a blanket bypass flag.

### REQ-MAIL-129 — No seat ever waits indefinitely on a human decision
- **Harness reality, established 2026-08-15 — read this before designing around it.** An interactive Claude Code session waits on a local permission prompt **forever**. There is no timeout to configure: the `dialogExpiry` setting bounds only dialogs *forwarded to a remote client*, and its own documentation states that local-only prompts are unaffected. Testing also showed that non-interactive (`-p`) invocation does **not** block — the call proceeded without a prompt — but that same test showed a Bash command running with no allowlist entry, so the unattended path may be considerably more permissive than the attended one. Neither the semantics of `--permission-mode dontAsk` nor prime-agent's prompting behavior has been established; a print-mode test cannot distinguish them.
- **Required behavior.** Because no deadline exists for an attended session, **prevention is the only control**: a seat SHALL be provisioned so that a blocking prompt cannot arise, by granting its whole working tool surface up front (REQ-MAIL-128) and by launching unattended seats in a mode where a permission decision cannot block indefinitely. That mode SHALL be established per harness by test, not assumed. The grant SHALL remain scoped — a seat that cannot hang because it may do anything is not a solution. A refused call SHALL surface as an ordinary failure the seat can report by mail.
- **Rationale.** Contract §13.7 says silence is never approval. The harness inverts it: silence becomes an indefinite hold. Worker and orchestrator seats have no human attending them and no one watching, so a blocking prompt is not a delay — it is a stall nobody sees until escalation fires.
- **Acceptance criteria.** For each harness, a recorded test shows what an unattended seat does when a tool falls outside its grant — proceed, fail, or hang — and the launch configuration is chosen from that evidence. No seat is launched in a configuration where hanging is possible. A seat stalled anyway is caught by REQ-MAIL-030 escalation and named in the escalation body, so the stall is routed rather than silent. The permissiveness of the chosen unattended mode is documented, including what it allows beyond the mail tools.

### REQ-MAIL-130 — An orchestrator may provision workers in its own lane
- **Required behavior.** An orchestrator SHALL be able to call `mail_register_seat` for a seat whose role is `worker`, whose lane equals the orchestrator's own lane, and whose escalation target is that orchestrator. The server SHALL enforce all three conditions and SHALL reject any other registration by an orchestrator — a foreign lane, a non-worker role, or a different escalation target — with a named error. Lead and architect rights are unchanged. The server SHALL cap the number of live workers an orchestrator may hold, configurable, and SHALL refuse the cap-exceeding registration rather than silently allowing it.
- **Rationale.** Workers are created as work arrives, so the roster cannot be known in advance. The orchestrator already owns its lane's workers under the topology — it alone may interrupt them and they report only to it — so letting it create them adds no authority it does not already exercise. Routing every worker creation through the architect would put a waiting human back in the fast path. The cap exists because "create a worker" is now an autonomous action, and an orchestrator in a failure loop should hit a named error rather than fill the machine.
- **Acceptance criteria.** An orchestrator registers a worker in its own lane and receives a signed certificate for it. The same orchestrator registering into another lane fails; registering a role other than `worker` fails; naming a different escalation target fails. Past the cap, registration fails with a named error and no partial seat is left behind. A worker still cannot register anything.

### REQ-MAIL-131 — A provisioner may never grant more than it holds
- **Required behavior.** When a seat provisions another seat, the permission grant, role, and lane it writes SHALL be a subset of its own. The provisioning path SHALL NOT be usable to create a seat with authority the provisioner lacks.
- **Rationale.** Once provisioning is an autonomous act, it becomes an escalation path: an orchestrator that could mint a worker with broader permissions than itself could use that worker as a proxy for anything it is forbidden to do. The subset rule closes it, and mirrors REQ-MAIL-114's rule that the server never honors an identity asserted by the requester.
- **Acceptance criteria.** An orchestrator cannot provision a worker whose permission grant exceeds its own. A worker created by an orchestrator holds worker rights only, in that orchestrator's lane. An attempt to escalate through provisioning fails with a named error and is visible in the record.

### REQ-MAIL-133 — The envelope accretes its history; it is never rewritten
- **Required behavior.** The message file SHALL carry two parts. The **header and body** are written once at send and SHALL NEVER be modified — they hold only facts fixed at that moment (`id`, `seq`, `from`, `to`, `kind`, `class`, `thread`, `sent_at`, `in_reply_to`, `expects_reply`, `deadline_seconds`, artifacts). Fields with no value SHALL be omitted, not rendered empty. Every subsequent event SHALL be recorded as its **own record file** beside it — each state transition with its server timestamp, the ack with its disposition and note, supersession, push failures, re-pushes, and escalations — written to a temporary path and moved into place per REQ-MAIL-134. Nothing SHALL be modified in place, and `state` and `push_state` SHALL NOT appear in the header, since both are point-in-time values that become false immediately. A message's current state is the fold of its event records, and a renderer SHALL be able to present one message, or one thread, as a single readable view.
- **Rationale.** Ruled by the lead, 2026-08-15: rewriting does not scale — every state change would rewrite a whole file, and a busy mailbox turns into constant rewrites of immutable content. Appending is constant-cost per event and strictly preserves REQ-MAIL-071 immutability: the body is untouched, the history accretes beneath it. It also fixes what testing found — an envelope reading `state: SENT, push_state: PENDING` for a message that had been delivered, read, and acked, with the ack disposition and note appearing nowhere in the human-readable record at all.
- **Why it matters more than it looks.** The file record is the lead's primary interface, not an audit trail: the lead is out of band and reads `week7/mail/**` directly rather than calling tools. An envelope that misreports state is a lying UI.
- **Acceptance criteria.** After a message goes SENT → DELIVERED → READ → ACKED, its records show all four transitions with timestamps and the ack's disposition and note, and the original body file is byte-identical to what was written at send. No state value appears in the header. Absent optional fields are omitted rather than rendered blank. `mail.jsonl` and the file agree on the full lifecycle of every message after 1000 messages. A reader can reconstruct one exchange end to end from the file alone, with no server running and no log replay.

### REQ-MAIL-134 — The atomic unit is a file; the log is a directory
- **Required behavior.** Every durable record SHALL be written to a temporary file on the same filesystem and moved into place with `rename()`, which is atomic. A reader SHALL therefore see a complete record or no record — never a partial one. No file SHALL ever be modified in place, and no record SHALL ever be appended to a shared file. "Appending to the log" means **creating one more file**; the log is the directory, ordered by the seq and sequence numbers in the filenames.
- **Records land read-only.** The temporary file SHALL be made read-only **before** the rename, so a record is immutable from the instant it becomes visible — there is no window in which it exists and is writable. Because nothing is ever modified in place, this costs nothing operationally: the server never needs write access to a record it has already published.
- **What read-only does and does not buy.** It defeats accident: a buggy write path, a stray shell redirect, an editor saving over a record. It does **not** defeat intent — the owning user can `chmod` it back, exactly as they can read the CA key (REQ-MAIL-117), because every seat runs as one operating-system user. And it does **not** prevent deletion: on POSIX, unlinking a file is governed by the *directory's* permissions, not the file's, and the directory must stay writable so new records can be added. Deletion is therefore caught after the fact by the hash chain (REQ-MAIL-135), not prevented by the mode.
- **How this satisfies D16-incremental-record.** The message header and body are one file, written once. Each subsequent lifecycle event — state transition, ack with disposition and note, supersession, push result, escalation — is its own small file beside it. Nothing is rewritten as state changes, so the cost of an event is constant and independent of message size, and nothing is ever half-written.
- **`mail.jsonl` becomes a derived index, not the source of truth.** The directory tree is authoritative. Any consolidated index exists only as a rebuildable cache for fast startup, and SHALL be reconstructible from the tree at any time. Corruption of a cache is therefore recoverable by definition: delete it and rebuild.
- **Rationale.** This is the pattern the engagement already uses — write beside, then move into place — and it is strictly stronger than an append-only log. It removes torn writes, interleaved writes, and partial records as failure classes rather than detecting them after the fact.
- **Acceptance criteria.** Every published record is read-only the moment it is visible, and an attempt to open one for writing fails. 1000 concurrent sends produce 1000 complete message files and no partial ones. Killing the daemon at any point during a send leaves either a complete record or nothing, never a fragment. The derived index is deleted and rebuilt from the tree with an identical result. A message's full lifecycle is reconstructible from its own files with no index present.

### REQ-MAIL-135 — Corruption is detected, located, and never silently tolerated
- **Required behavior.**
  - **Each record carries its own integrity value, chained to its predecessor.** Every record file SHALL include a hash covering its content and the hash of the record before it in its scope. A break SHALL identify the exact record at which it broke.
  - **Detection covers what parsing cannot.** Parsing catches truncation and structural damage; it does not catch a flipped bit inside a string, which parses cleanly and replays as fact. The chain closes that, and additionally makes deletion, reordering, and insertion detectable — not merely accidental corruption but any alteration of the record. Atomic writes prevent torn files; the chain catches everything that happens to a file afterwards.
  - **Never skip silently.** On a parse failure, a checksum mismatch, or a chain break, the server SHALL refuse to start and SHALL report the file and which check failed. It SHALL NOT load the surviving records and continue. A mailbox that quietly drops records is the Week-3 desync rebuilt inside the tool meant to prevent it.
  - **A missing record is as loud as a corrupt one.** Because the chain runs through sequence, a record that was deleted outright SHALL be detected as a gap, not read as an absence of events.
- **Rationale.** The record is evidence. Evidence that can be wrong without anyone knowing is worse than evidence that is missing, because it is still trusted. Chaining costs one hash per record and turns "is this log intact?" into a check anyone can run — including the offline verifier of REQ-MAIL-122, which already walks the record with the root certificate and can validate the chain in the same pass.
- **Acceptance criteria.** Flipping one byte inside a string value of one record is detected on load, names that record, and prevents startup. Deleting an interior record is detected as a gap. Swapping two records is detected. The derived index is rebuilt from the tree and verifies clean. Each failure case has a documented, tested repair.

### REQ-MAIL-136 — Log entries are immutable, enforced at four levels
- **Required behavior.** Once a record is visible, its bytes SHALL never change. This is enforced in depth, because any single mechanism can be bypassed:
  1. **Mode.** The record is made read-only before the rename that publishes it (REQ-MAIL-134), so it is never both visible and writable.
  2. **Absence of a code path.** The server SHALL contain no function that opens a published record for writing, truncates one, or renames one over another. There is nothing to call by accident, and its absence is verifiable by inspection and by test.
  3. **Correction by accretion.** A mistake is corrected by writing a new record that cites the one it corrects — never by editing it. This extends REQ-MAIL-071 from message bodies to every record: state events, acks, escalations, supersessions.
  4. **Detection.** Anything that alters a record despite the above is caught by the hash chain (REQ-MAIL-135), which names the record and refuses startup.
- **The one thing that may be rewritten** is a derived cache, and only by discarding and rebuilding it from the record tree. A cache is not a record. The boundary SHALL be explicit in the code, so that "may I write here?" is never a judgement call.
- **Rationale.** The record is the engagement's evidence and the lead's interface. Mutable evidence is not evidence — and the failure mode is not dramatic corruption but a quiet, plausible edit that nobody can later distinguish from the original. Immutability is also what makes the signatures of D13-signatures-mandatory meaningful: a signature over a mutable record proves only what the record said at signing time.
- **Acceptance criteria.** An attempt to open any published record for writing fails. A repository-wide inspection finds no write, truncate, or rename-over path targeting a published record. A correction produces a new record citing the original, with the original byte-identical. An externally modified record is detected on load and named. Rebuilding the derived cache from the tree produces an identical cache and touches no record.

### REQ-MAIL-137 — Two block forms, distinct subjects, asymmetric release
*Supersedes REQ-MAIL-023, whose single `blocks` field conflated two opposite situations.*
- **Required behavior.**
  - **`i_am_blocked_by: <condition>`** — a self-declaration. The **sender** SHALL be marked BLOCKED on that condition from the moment the message is sent, and SHALL remain so until the condition is satisfied. This is the "I asked and must not proceed until answered" case that contract §13.7 exists for.
  - **`you_are_blocked_until: <condition>`** — an imposition. The **recipient** SHALL be marked BLOCKED on that condition. This is the "you must not deploy until you confirm routing" case.
  - **Both forms constrain work, never correspondence.** A BLOCKED seat SHALL retain full use of the mail system — it may send, read, reply, and ack. Any other rule deadlocks by construction, because the thing that lifts a block arrives as mail.
  - **A block condition is either a checkable predicate or free text.** Predicates come from a small closed vocabulary the server evaluates itself — for example `ack_of:<message-id>`, `reply_to:<message-id>`, `message_from:<seat>[:<kind>]`, `deadline:<timestamp>`. The server SHALL clear a predicate block the instant it evaluates true, with no message to anyone. Free text SHALL NOT be interpreted by the server.
  - **Release paths, and there are only two.** A block clears when (a) the server evaluates its predicate true, or (b) for an imposed block, the seat that imposed it releases it; for a self-declared block with a free-text condition, the declaring seat releases it. Nothing else clears a block. A reply SHALL NOT clear one implicitly, nor an ack, nor a read.
  - **The blocked seat is never a party to releasing an imposed block — there SHALL be no surface by which it could be.** No tool parameter, no ack disposition, no message content, no reply shall have that effect, and no code path shall exist that a caller could reach to that end. This is enforced by absence, exactly as REQ-MAIL-136 enforces immutability, and for the same reason: an agent whose context has drifted or compacted will use any available surface and will produce a plausible justification for doing so. A rule it must obey is worth nothing; an ability it does not have is worth everything.
  - **Precision is rewarded.** A sender that states a checkable predicate gets automatic release with no round trip and no tokens spent. A sender that states prose owns the release and pays the round trip. That is the correct price for a condition nobody can verify.
  - **Drift cannot erase a block, only obscure it to the drifted seat.** Block state lives in the server, never in the agent's context. A compacted seat may forget it is blocked, but `mail_audit` still reports it and the architect still sees it — so drift produces a visible inconsistency rather than a silent release.
  - **Multiple blocks.** A seat MAY hold several blocks at once. Each is released independently and identified by its condition. `mail_audit` SHALL report, per blocked seat, every open condition and which message declared or imposed it.
- **Current state — this is a live defect.** Testing on 2026-08-15 showed a `blocks` condition cleared by a bare reply while the blocking message sat unread at DELIVERED — never read, never acked. Any reply of any content clears it. That converts "silence is never approval" into "noise is approval," and the current model marks the wrong seat for the sender-waiting case, which is the failure the engagement record actually suffered.
- **Acceptance criteria.** A seat sending `i_am_blocked_by` reports BLOCKED immediately, on that condition, and can still use every mail tool. It clears only when that seat releases it. A recipient of `you_are_blocked_until` reports BLOCKED and cannot clear it by any action of its own — a reply, an ack, and a read all leave it blocked — while the imposer's release clears it. A seat holding two blocks reports both, and releasing one leaves the other. `mail_audit` names the condition text and the message behind every open block.

### REQ-MAIL-138 — Permission is provisioned, never requested
*Resolves F5-permission-prompts-deadlock-seats.*
- **Required behavior.** A seat's harness permission configuration SHALL be written as part of provisioning it, alongside its key, certificate, contract, and registry row — never obtained at run time. The mail grant SHALL be one **server-scoped** rule covering the whole tool surface, so it stays complete as tools are added. Grants SHALL be **role templates**, versioned and stored with the launcher, never improvised per seat. No seat SHALL be launched with a blanket bypass.
- **Why the mail rule is the keystone.** It is the one part of a grant that can be *proved* complete. Every other part may be wrong, because a seat that can always reach its mailbox can always report what it could not do — a refused tool becomes a `status` message rather than a stall. The provisioner then repairs the grant autonomously, within its own authority (REQ-MAIL-131).
- **The circularity, and how it is closed.** A seat whose mail grant is missing cannot report that it is mute. That case is caught two ways: the launcher completes a mail handshake **as the new seat**, using the config it just wrote, before declaring it ready — the only check that runs while the escape hatch itself is broken; and thereafter the counterparty notices, because a mute seat cannot ack and its opener sees an open thread that never moves.
- **Acceptance criteria.** A freshly provisioned seat completes the full tool surface with no approval prompt. Adding a tool to the server requires no seat config change. No seat config contains a bypass flag. Provisioning fails loudly if the new seat cannot complete a mail handshake with its own configuration.

### REQ-MAIL-139 — The per-seat shim holds the key and signs
- **Required behavior.** Each seat SHALL reach the daemon through a small local proxy that holds that seat's private key: the agent speaks plain MCP over stdio to the shim, and the shim speaks mutual TLS to the daemon and computes the per-message signatures of REQ-MAIL-120.
- **Why this is primary rather than a fallback.** An LLM calling an MCP tool cannot compute a signature over a canonical encoding — it has no key access and no crypto primitives. So *something* in the client path must sign on the seat's behalf regardless of how the transport works, and that something is the shim. It is required by D13-signatures-mandatory independently of whether any client can present a certificate natively.
- **What it also buys.** It narrows F4-client-mtls-support-unverified from "can these clients do mTLS?" — which we do not control — to "can these clients speak stdio to a local process?", which both demonstrably can, since that is how the server runs today.
- **Acceptance criteria.** A seat's private key never leaves its home directory and is never held by the agent process. Every message carries a valid signature the agent never computed. A client with no native certificate support connects successfully through the shim.

### REQ-MAIL-140 — Condition scripts run unrestricted, and the consequences are written down
- **Required behavior.** A condition script SHALL run with no sandbox, no network restriction, and no capability allowlist. It may read any file, call any command, and reach any service the machine can reach. REQ-MAIL-102 and REQ-MAIL-103 — local only, never touches AWS — SHALL be amended to say they constrain **the server's own behavior**, not the scripts it evaluates on a seat's behalf.
- **Rationale (D21-scripts-run-unrestricted-for-now).** All seats share one operating-system user. A restriction between them would be advisory, and an advisory restriction is worse than a stated absence because it invites reliance.
- **Consequences, stated so they are not discovered later.**
  1. **A block condition is a code-execution path between seats.** The imposer writes the script; it runs against the recipient's context at a time the server chooses. On one uid this grants no capability a seat lacked, but it creates a *pathway* that did not exist — code running somewhere, and when, it otherwise could not.
  2. **Unlimited capability means unlimited cost.** A script that calls a billable API, or runs for minutes, multiplies by its evaluation count. This makes REQ-MAIL-141 (side effects) and the evaluation cadence load-bearing rather than housekeeping.
  3. **A script inherits whatever credentials the environment holds.** Nothing scopes it to the work its block concerns.
- **What "limit it later" would mean**, recorded now so the promise is not vague: a capability declaration on the block (filesystem-only, network, credentialed), enforced by the evaluator; and separate operating-system users per seat, without which no enforcement between seats is real.
- **Acceptance criteria.** The documented behavior matches the implementation — no partial sandbox that suggests protection it does not provide. The README states plainly that a condition script runs with full machine privileges.

### REQ-MAIL-141 — The server holds the condition, evaluates it, and is the only authority on block state
- **Required behavior.**
  - **Custody.** The condition — predicate or script — SHALL be stored in the immutable block record (REQ-MAIL-136). The recipient MAY read it, and SHALL be able to, since a seat blocked "until the verify report exists" must know to produce one. The recipient SHALL NOT execute it, and no result reported by a seat SHALL be accepted.
  - **Evaluation is the server's, always.** Only the server evaluates. There is no tool by which a seat submits a verdict. This removes the last place a drifted seat could rewrite a condition and claim it passed.
  - **When it runs, and why that split.** Conditions the server can answer from its own state — a message acked, a reply arrived, a message of a kind from a seat, a time reached — SHALL be evaluated when the relevant event occurs. They cost nothing and the blocked seat is passive, so the server clears them and wakes the seat. Script conditions SHALL be evaluated **on request**, because the seat that satisfies them is the one doing the work and therefore knows when to ask. **Nothing SHALL run on a timer.** The split follows who causes the condition to become true, not a tuning choice.
  - **Authority.** Because the server evaluates, it always knows the true state of every block without asking any seat. `mail_audit` SHALL report block state as fact, never as a seat's self-report.
  - **Every evaluation is recorded** — when, by what trigger, and the result — because the server performed it. This yields the condition corpus of `O20-what-to-log-about-conditions` as a byproduct: evaluation counts, whether a condition ever passed, and which scripts errored.
- **Acceptance criteria.** A recipient can read its block's condition and has no tool that evaluates one or submits a result. A rewritten local copy of a script changes nothing. An internal predicate clears on its triggering event and the blocked seat is woken. A script condition is evaluated only when a seat asks. No background timer evaluates conditions. Every evaluation appears in the record with its trigger and result.

### REQ-MAIL-142 — Condition results live with the relationship, and reads are always free
- **Required behavior.**
  - **A condition starts false** and stays false until a recorded evaluation returns true. False is the safe default; nothing is cleared by absence of information.
  - **Monotonic.** Once an evaluation records true, the condition SHALL NOT be evaluated again. A block is about *reaching* a state, not maintaining one — so no flapping, no re-arming, and evaluation cost per block is bounded and ends at satisfaction.
  - **Reads are free; only an explicit request evaluates.** Any seat MAY read a block's current result, and reading SHALL NEVER trigger evaluation. Otherwise an architect auditing twenty blocked seats would fire twenty scripts merely by looking. Only an explicit "evaluate now" from the seat that believes it has satisfied the condition runs a script, alongside the internal event triggers of REQ-MAIL-141.
  - **Durable across instances, scoped to the relationship.** The recorded result survives daemon restarts, disconnections, and postponed work — a block satisfied at 16:00 SHALL NOT return because the server bounced at 16:05. Its lifetime is the thread's: from the opener's first message until the opener closes it (D23-the-thread-is-the-session).
  - **Closing deactivates, never deletes.** When the opener closes a thread, its blocks become inert and any pending condition stops being live. The record SHALL retain the condition, every evaluation, and the fact that it became moot on close. Nothing is removed — immutability (REQ-MAIL-136) is not conditional on relevance.
- **A condition result has three values, not two.** `NOT_SATISFIED`, `SATISFIED`, and `SESSION_CLOSED` — the last meaning the relationship ended and no answer is possible because the work is over. A closed thread SHALL NEVER return a boolean: `NOT_SATISFIED` would tell the seat to keep working toward something nobody wants, and `SATISFIED` would tell it to proceed with cancelled work. `SESSION_CLOSED` SHALL name the thread and when it closed, so the seat can say what it stopped. **The script SHALL NOT be run.** The thread is closed, so the answer cannot matter — executing it would spend money and time to compute a value nobody can act on, and with unrestricted scripts (REQ-MAIL-140) it could also cause side effects on behalf of a relationship that no longer exists. The closed check happens **before** any evaluation, not after.
- **Closing a thread is therefore the cancellation mechanism**, and a better one than preemption: it needs no agent to stop mid-turn, because the work simply becomes moot at the next check the seat performs anyway. On close the server SHALL wake every seat holding a live block or an open obligation on that thread — otherwise a worker grinds for twenty minutes before discovering the task was cancelled before it began.
- **A condition SHALL NOT be evaluated at declaration.** The first execution is when the recipient asks, believing it has satisfied the condition. Ruled 2026-08-15: at declaration a correct condition is *expected* to be false — the report does not exist yet, the work has not happened — so a declaration-time run cannot distinguish a broken script from one that is simply not yet satisfied, which is the only distinction that would make it worth doing. Even an error fails to separate them, since a well-formed script may legitimately error on a file that does not exist yet. Worse, such a check would push authors to write conditions that survive premature execution, bending the script to satisfy a diagnostic instead of expressing the requirement.
- **The stored result is the single source of truth.** Every reader — the server answering a query, `mail_audit`, the recipient checking on itself — reads the stored result. It is written once at block creation as `NOT_SATISFIED` and updated only at the end of an evaluation. Nothing infers block state from anywhere else.
- **Evaluation is synchronous for the requester.** A seat that asks for evaluation waits and receives the result in that call. A repeat request after `SATISFIED` returns the stored result without re-running (REQ-MAIL-142, monotonic). The timeout therefore bounds two things at once: how long a script may consume resources, and how long a seat's tool call may hang. It SHALL be sized accordingly — tens of seconds, not minutes, since the caller is waiting.
- **A semaphore guards evaluation.** At most one evaluation of a given condition SHALL be in flight. The lock SHALL be held by the **server**, not the evaluator, since the server is what survives. Requests arriving while an evaluation runs — from any seat or process — SHALL NOT start a second execution of unrestricted code; they receive the stored result, or wait for the one in flight.
- **The in-flight marker is durable, and recovery kills before it retries.** The fact that an evaluation started SHALL be recorded durably, with enough handle to find the process again — not held in memory, or a restart would not know what had been running. On startup the server SHALL sweep every condition marked in flight, **kill any script process still running**, record the evaluation as aborted by restart, release the lock, and allow a retry. It SHALL NOT simply expire the lock: a crashed server does not imply a dead script, and handing the lock to a second run while the first is still executing is precisely the double execution the semaphore exists to prevent. During normal operation the timeout still applies and kills an overrunning script; the sweep exists for the crash case alone.
- **Evaluation is asynchronous, and the requester holds a kill token.** Terms as the lead uses them: the **obligor** is the seat that imposed the condition; the **obligee** is the blocked seat that asks for it to be evaluated when it believes it is ready. A request SHALL return immediately with a **token**, not block until the script finishes. The obligee may use that token to kill the evaluation in flight at any time. When the evaluation completes, the server SHALL send the obligee a message carrying the result — so the obligee never busy-polls to learn the outcome, and is never stuck inside a call it cannot escape.
- **Why not synchronous.** If the obligee blocked while its script ran, it could neither kill the evaluation it started nor ask the obligor about a condition taking far too long — the two remedies it has would both be unavailable precisely when it needs them. Asynchrony with a token and a completion message keeps both open, and reuses the wake mechanism already used to tell a seat its block has cleared.
- **A stuck condition is resolved by asking, not by expiry.** A blocked seat may always send mail (blocks constrain work, never correspondence), so a seat blocked far longer than expected asks the imposer whether that is expected. The imposer then has every tool it needs: kill a hung evaluation, release the block, supersede it with a corrected condition, or close the thread. An unresponsive imposer is an ordinary escalation to the seat's escalation target and ultimately the architect, who can close the thread. **No automatic expiry is specified** (ruled 2026-08-15): the remedy is the mail system itself, and adding a timed auto-release would weaken the guarantee for a case the existing mechanisms already cover.
- **Abort is one mechanism with three triggers** — the obligee killing it with its token, the timeout expiring, or the startup sweep after a crash. All three kill the process, release the semaphore, and record the outcome with its cause.
- **Scripts SHALL be spawned as child processes, never run in-process.** The server is single-threaded JavaScript serving every seat from one daemon, so a synchronous execution would block the event loop and stall all traffic for the duration of the script. Spawning asynchronously is therefore mandatory, and it already places the script outside the server: separate process, separate memory, its own crash domain. **No separate evaluator daemon is specified** (ruled 2026-08-15): it would add a component without adding a boundary, since under D21-scripts-run-unrestricted-for-now every seat shares one operating-system user and there are no privileges to drop.
- **One field on the block, four values, and a session that supersedes them all.**
  - The block carries `outcome`: **`NOT_ATTEMPTED`** (the default at creation — never run, which is distinct from run-and-false), **`NOT_SATISFIED`** (run, not met yet), **`BROKEN`** (the script failed in a way that says the condition itself is wrong, so a new one is needed), and **`SATISFIED`**. `BROKEN` and `SATISFIED` are **terminal**; the other two are not.
  - **`SESSION_CLOSED` is a fifth value of the same field, reached by transition.** When the session closes, every block whose outcome is **non-terminal** — `NOT_ATTEMPTED` or `NOT_SATISFIED` — moves to `SESSION_CLOSED`, which is itself **terminal and can never change**. Blocks already in a terminal state stay exactly as they are: a condition that was `SATISFIED` remains satisfied, one that was `BROKEN` remains broken. Those are facts that happened, and closing the session does not unmake them; a condition that never resolved, by contrast, now never can, and the field says so.
  - **The whole state machine.** `NOT_ATTEMPTED` may move to `NOT_SATISFIED`, `SATISFIED`, `BROKEN`, or `SESSION_CLOSED`. `NOT_SATISFIED` may move to `SATISFIED`, `BROKEN`, or `SESSION_CLOSED`. `SATISFIED`, `BROKEN`, and `SESSION_CLOSED` move nowhere. Once a block is in any of the three terminal states, no evaluation is ever run for it again.
  - **Classifying a failure.** A non-zero exit other than `1` is `BROKEN` — the script ran and failed rather than answering, and `127` (command not found) will never behave differently. A **timeout or an abort is NOT `BROKEN`**: neither is evidence about the script's correctness, and a machine that was briefly loaded must not permanently kill a block the obligee cannot repair. Those leave the outcome where it was and remain retryable.
  - **`BROKEN` means a new block, not an edited one.** Conditions are immutable (REQ-MAIL-136), so the obligor supplies a fresh block with a corrected condition; the broken one stays in the record showing exactly what failed.
  - **Individual attempts are still recorded** — trigger, timing, exit code, captured output — as the history behind the block's current `outcome`.
- **The result is the process exit code, and that is deliberate.** `0` means `SATISFIED`, `1` means `NOT_SATISFIED`, and **any other code — or a timeout, or an abort — means `EVALUATION_FAILED`**, which keeps a broken script distinguishable from an unmet condition (`127` is command-not-found, not a verdict). Delivering the verdict as an exit code means **the process must die to produce a result**: a script that hangs never satisfies its condition, so terminating is in the author's own interest rather than being a rule they are asked to remember. `stdout` and `stderr` SHALL be captured and recorded as context — never parsed, never authoritative — so a reader can see *why* a condition is not yet satisfied.
- **No concurrency cap is specified yet** (ruled 2026-08-15). Well-formed conditions exit as soon as they answer, so concurrent processes are bounded in practice by simultaneous requests times the timeout — and evaluation is on-request and monotonic, which keeps that small. Only a script deliberately written not to die could accumulate, and the timeout kills it. Observe first; add a cap if process exhaustion is ever actually seen.
- **Retry after an abort asks for idempotency it cannot guarantee.** A script killed part-way may have done half of whatever it does, and the retry repeats it. The contract SHALL ask that conditions be safe to re-run, and nothing enforces that, for the same reason as REQ-MAIL-143. The abort and the retry SHALL both appear in the record, so a script that behaves differently on its second run is visible after the fact.
- **Progress is inspectable.** Alongside the stored result, a condition SHALL expose whether an evaluation is running, and since when. A reader then distinguishes "not satisfied, and nothing is happening" from "not satisfied, but the answer is about to change" — which tells an obligor whether to wait or to act. It also makes a wedged evaluation visible: "running" for ten minutes under a thirty-second timeout is a fault anyone can see.
- **A failed evaluation is its own outcome.** `EVALUATION_FAILED` SHALL be recorded when a script errors or times out, carrying the error, and SHALL NOT be collapsed into `NOT_SATISFIED`. The seat stays blocked either way — that is the safe behavior — but a broken script and an unmet condition are different facts. Since a condition is never evaluated at declaration, the first request is the only moment anyone can learn a script is broken, and collapsing the two would discard that signal permanently.
- **Consequence, accepted.** A broken script is therefore not discovered until the recipient first asks. The mitigations are the error semantics of a failed evaluation and the imposer's fallback expiry, not an up-front check.
- **Deferred to v1.1.** A lead-driven sweep to close dangling threads whose opener is gone or inattentive. Out of scope for 1.0; recorded so it is not rediscovered as a defect.
- **Acceptance criteria.** Evaluating a condition on a closed thread returns `SESSION_CLOSED`, never a boolean, names the thread and its closing time, and demonstrably does not execute the script — verified by a condition script whose execution is observable. Closing a thread wakes every seat with a live block or open obligation on it. A block reads `NOT_SATISFIED` before any evaluation. Reading a block's state never executes a script, however many readers ask. A satisfied block stays satisfied across a daemon restart. Closing a thread renders its blocks inert while the record still shows the condition, its evaluations, and its closure. No evaluation occurs after a condition has recorded true.

### REQ-MAIL-143 — Condition scripts are asked to be side-effect free; nothing guarantees it
- **The expectation.** A condition script SHOULD observe state and change nothing. It SHOULD be safe to run at any moment, any number of times, in any order, with the same result. The contract SHALL say so, and a script that writes files, mutates remote state, or spends money is a defect in the script — reviewable as such.
- **The guarantee, stated plainly: there is none.** With arbitrary scripts (D21-scripts-run-unrestricted-for-now) and no sandbox, side-effect freedom cannot be enforced. Static analysis cannot decide it for a shell — `eval` and variable expansion defeat any sound check. The only mechanisms that would work are a sandbox with a read-only view, or a closed predicate vocabulary with no arbitrary code; the first is deferred, the second was rejected in favour of expressiveness. This requirement SHALL NOT be written as `SHALL`, and no test SHALL assert purity, because a test that appeared to verify it would be worse than none — it would manufacture confidence in a property the system does not have.
- **What actually bounds the hazard.** Not enforcement, but frequency. Evaluation stops permanently once a condition records `SATISFIED` (REQ-MAIL-142); reading a result never executes anything; a closed session never executes; nothing runs on a timer; and only the seat that believes it did the work can trigger a run. A misbehaving script gets a handful of chances, not thousands.
- **What makes it visible.** Every evaluation is recorded with its trigger and result (REQ-MAIL-141). A script whose observed effects change between evaluations, or whose result flaps before satisfaction, is detectable in that history after the fact. Legibility is the mitigation, because enforcement is unavailable.
- **When it becomes enforceable.** If the capability limits named in D21-scripts-run-unrestricted-for-now are built — a declared capability class per block, enforced by the evaluator — a read-only class becomes a real constraint rather than a request. Until then it is a request.
- **Acceptance criteria.** The contract and the README state the expectation and the absence of any guarantee, in those terms. No test claims to verify purity. The evaluation history is sufficient to identify a script whose effects changed between runs.

### REQ-MAIL-144 — Harness-agnostic by construction; assume the weakest model
- **Required behavior.** No harness name, flag, or config format SHALL appear in the server. Waking a seat SHALL be performed by executing a `wake_command` recorded against that seat at provisioning — opaque data the server runs without interpreting. Permission grants SHALL be defined once per role (REQ-MAIL-138) and **rendered** per harness by the launcher, which already branches by harness today.
- **The wake is a courtesy, which makes an unknown harness safe.** Because delivery does not depend on the wake (REQ-MAIL-011), a harness with no poke mechanism degrades to *polite* rather than *broken*: the seat finds its mail at its next `mail_inbox`. Mid-turn delivery has been demonstrated only for prime-agent, and nothing SHALL be built that assumes it elsewhere.
- **The shim is the one common component.** All candidate harnesses speak MCP over stdio, so the per-seat proxy of REQ-MAIL-139 is written once rather than three or four times. That is now a stronger argument for it than the signing requirement that motivated it.
- **Assume the weakest model in the fleet.** Seats will run different models of different strength — cheap models are expected, and are part of the point. Two consequences follow and SHALL be treated as design constraints, not warnings. Condition scripts are written by agents, so a weaker model writes buggier ones; since conditions are never evaluated at declaration, the remedies of REQ-MAIL-142 — the obligee asking, the obligor killing and correcting — carry proportionally more weight. And contract compliance degrades sooner at the low end, which is why authority sits in the server: no self-release, no self-reported results, no seat evaluating its own condition. A design that assumed a strong, well-behaved agent would be fragile across a mixed fleet.
- **Acceptance criteria.** Adding a harness requires no change to the server. A seat with no `wake_command` still receives its mail. No test depends on a harness-specific flag or config path. The permission grant for a role is defined once and rendered per harness.

### REQ-MAIL-145 — Critical sections withhold; the tool description carries the trigger
*Amends REQ-MAIL-050 and REQ-MAIL-051, whose stated rationale assumed an interrupt could halt work.*
- **Restated purpose.** A critical section does not stop an interrupt from disrupting a deploy — nothing can, since the server cannot compel a model to stop (REQ-MAIL-010). It **withholds the message**, so a seat mid-stack-mutation is never handed a reason to abandon what it is doing. Withholding is fully enforceable; compelling is not. The mechanism therefore works in the one direction available to us, and the original wording — implying an interrupt could tear a deploy in half — SHALL NOT be restored.
- **REQ-MAIL-051's expiry earns its place independently.** A section that never closes is a deploy that hung, and with no clocks anywhere else in the system (D20-no-clocks) it is the only signal of that kind we have.
- **The tool description carries the trigger, not just the mechanics.** Contract text decays; a tool description is re-presented with every tool listing and does not. So `mail_critical_begin` SHALL describe *when* to reach for it — before any operation where being handed a reason to stop mid-way is worse than finishing — and not merely what it does. This applies across the whole surface (D25): acking, draining the inbox at turn start, declaring a block. Wherever the protocol depends on an agent acting unprompted, the trigger belongs in the description, because that is the only instruction channel immune to compaction.
- **Prefer mechanism over memory.** REQ-MAIL-051 requires the deploy lane to wrap every mutation, which today is a contract rule and therefore decays. Where the per-seat shim (REQ-MAIL-139) can expose a command-line path to these tools, wrapping SHOULD become part of the deploy procedure itself rather than something the agent must recall.
- **A seat SHALL be able to see that it is inside a section**, and for how long — reported alongside its inbox. An agent that opened one and forgot will otherwise hit the expiry and page the architect; visibility makes forgetting self-correcting.
- **Acceptance criteria.** An interrupt sent to a seat in a critical section is not delivered until the section ends, then delivered once. `when_ready` is unaffected. A seat can see its own section state and elapsed time. The `mail_critical_begin` description states the trigger condition, and a reader who has never seen the contract can tell from the tool list alone when to use it.

## 4. Design notes for the implementer

**Keep the service layer identity-parameterized.** `MailService` methods should continue to take a resolved caller seat id as an argument; the change is that the *transport* supplies it from the verified peer certificate instead of the client supplying it in the payload. This keeps the existing 90 tests drivable at the service layer with minimal churn, and confines the security boundary to one place: the HTTP/TLS layer that turns a connection into an identity. Do not scatter certificate parsing through the service.

**One mapping function.** Peer certificate → seat id should be a single, separately tested pure function. It is the highest-value unit test in this batch.

**Use the lead's existing openssl CA implementation as the reference: `gh repo clone cvkgroup/atlas-ca`.** It is a working two-tier CA (self-signed root → intermediate → leaf) built on `openssl` shell scripts plus `.cnf` policy files. Follow its patterns for REQ-MAIL-113, REQ-MAIL-114, and REQ-MAIL-126 rather than attempting issuance from scratch. Shelling out to `openssl` is preferred over hand-rolling generation in Node, which verifies certificates well but issues them poorly.

What to take from it:

- **Root creation** (`create-4tl4s-ca`): `openssl ecparam -genkey -name prime256v1` for the key, then a CSR from a `.cnf`, then `openssl req -x509 -copy_extensions copy` to self-sign. EC P-256 keys, `sha256` throughout. Adopt both choices.
- **The CA state directory** it builds beside the key — `index.txt`, `serial`, `crlnum`, `new_certs_dir/`, `private/` — is what `openssl ca` requires to issue and track certificates. REQ-MAIL-113 must create this layout, not just a key and a certificate.
- **Leaf issuance** (`create-device`): client generates the key, then a CSR from a `.cnf`, then `openssl ca -config <ca>.cnf -infiles <csr>`. This is exactly the REQ-MAIL-114 shape — the CA signs a CSR and never sees a private key.
- **Extension policy** (`ca/device-config.cnf`, `ca/acme-ca-config.cnf`): `basicConstraints = critical,CA:false`, `subjectKeyIdentifier = hash`, `keyUsage = critical,digitalSignature`, and SAN supplied via a named `[ alternate_names ]` section. That SAN section is where the seat identity goes (REQ-MAIL-112). Seat certificates additionally need `extendedKeyUsage = clientAuth`, and the serving certificate needs `serverAuth` — neither appears in atlas-ca because its leaves are IoT device identities, so this is an addition, not a copy.
- **`copy_extensions = copy` is a loaded gun.** atlas-ca sets it in `acme-ca-config.cnf`, which means extensions in the CSR are copied into the issued certificate. Under REQ-MAIL-114 the server must not honor a client-asserted identity, so agent-mail SHALL NOT copy extensions from a submitted CSR: the server sets the SAN itself. This is a deliberate divergence from the reference and must be stated in the implementation.

What NOT to take from it:

- **The intermediate tier.** atlas-ca runs root → intermediate → leaf, appropriate for a manufacturing hierarchy. agent-mail is one process on one machine; root → leaf is enough, and one less key to protect.
- **CRLs** (`update-crls`, `crlDistributionPoints`, `authorityInfoAccess`). D12-dereg-is-revocation replaced revocation lists with registry membership. Do not build CRL infrastructure.
- **Everything AWS.** S3 CRL publication, IoT registration, `template.yaml`, `deploy`. REQ-MAIL-103 says this server never touches AWS.
- **The distinguished-name furniture** — postal addresses, given/surname, challenge passwords. A seat certificate needs an identity in its SAN and little else.

**Expect the tool schemas to shrink.** Removing `caller_seat_id` from 13 schemas is mechanical but touches every test. Sequence it as: transport and identity binding first, with the service still accepting an explicit id; then the schema removal; then the test migration.

## 5. Out of scope

Cross-machine seats. Separate operating-system users per seat. Hardware-backed key storage. Certificate transparency or audit of the CA itself. Web viewer. Timestamping by an external authority (the server clock remains the sole time source, per REQ-MAIL-091).

## 6. Method — red/green, mandatory

This batch SHALL follow the same discipline as the first implementation round, which is now house practice:

1. Enumerate the failure modes first, as acceptance tests derived from §3.
2. Run the tests and **show them failing for the right reason** — a missing feature, not a setup accident. A red test that fails on a typo or an unbuilt fixture proves nothing.
3. Implement one item at a time. After each item: its own tests green, then the full suite green, then the next item.
4. Never edit an acceptance test to make it pass. If a test is wrong, stop and say so.
5. An original test may change only where it pins behavior this spec declares defective, and every such change is reported with its justification.
6. Prove the greens detect regressions: mutate each implemented fix in a scratch copy and confirm the matching test fails.

Note for this batch specifically: several requirements need real key material in the tests (a throwaway CA, minted seat certificates, two concurrent TLS clients). Generating that inside the test fixture is part of the work, and the fixture must not reach the network or touch a real mailbox.

## 7. Open — findings from hands-on testing

The lead is testing the current build by hand. Findings are added here and folded into this batch before any implementation begins.

Finding references carry both halves, exactly as decisions do: `F<n>-<what-was-found>`. The number
preserves the order findings were raised; the name means a reader never has to look one up. Both
halves are stable — a finding is never renumbered or renamed once cited.

**F1-smoke-proves-ordering-not-preemption — the guide overclaimed what the smoke test shows.**
Raised by the lead, 2026-08-15. `npm run smoke` shows only a conclusion — that `mail_inbox`
returns an interrupt ahead of an earlier `when_ready`. It shows no long-running task, no
arriving interrupt, and no work being stopped. A reader could reasonably take it as evidence
that interrupts interrupt, which it is not. `TESTING.md` §1a now states the limit and points at
REQ-MAIL-013. **Action:** none in this batch beyond the documentation fix; the real evidence is
the steering gate below.

**F2-interrupt-cancels-work — an interrupt must cancel the work it interrupts.** Raised by the lead, 2026-08-15.
Nothing today cancels in-flight work: a preempted message stays READ and un-acked, then either
lingers in the queue or escalates for non-response, punishing the recipient for being
interrupted. Ruled: a delivered interrupt closes every READ-but-un-ACKED message for that seat
with disposition `PREEMPTED`, the message leaves the queue and is never re-delivered, and the
sender must re-send if the work is still wanted. Written up as **REQ-MAIL-015** in the PRD, with
`PREEMPTED` added to the REQ-MAIL-021 disposition vocabulary. **Action:** in scope for this
batch; needs red tests like everything else.

**F6-orchestrator-provisions-workers — orchestrators create workers on demand, but may not register them.**
Raised by the lead, 2026-08-15. Orchestrators spawn workers as work arrives; nobody knows the
roster in advance. But REQ-MAIL-042, REQ-MAIL-113, and REQ-MAIL-114 restrict registration — and
therefore certificate issuance — to lead and architect. As written, an orchestrator cannot bring a
worker into existence, so either the roster must be guessed up front, or every new worker waits on
the architect, reintroducing exactly the human-shaped delay this design exists to remove.

The provisioning act itself is not the problem: an orchestrator writing a worker's key, CSR,
permission config, and contract into the worker's home directory is the same flow REQ-MAIL-114
already describes for a launcher, one level down. The gap is purely the ACL. **Written up as
REQ-MAIL-130 and REQ-MAIL-131.** **Action:** in scope for this batch.

**F5-permission-prompts-deadlock-seats — harness permission prompts can hang a seat indefinitely.**
Raised by the lead, 2026-08-15, from the isolated seat session. Every mail tool call prompted for
approval, because the allowlist the lead had approved lived in the repo's Claude settings and did
not follow the seat into its own directory. The immediate annoyance is trivial to fix; the failure
it exposes is not.

A permission prompt is an **unbounded wait on a human**. In this engagement that is a deadlock
generator: a rarely-used tool can prompt for the first time hours into a run, when the lead is
away; and orchestrator-to-worker traffic has no human watching it at all, nor any visibility into
it. This is the R-2 doorbell deadlock reproduced one layer down — two parties waiting on each
other, needing the lead to intervene — inside the system built to abolish it.

One mitigation already exists and is worth stating: a seat stalled on a prompt cannot acknowledge
its mail, so the deadline breach, the three re-pushes, and finally the escalation of REQ-MAIL-030
make the stall visible without anyone watching for it. That converts a silent hang into a routed
alarm, but it does not prevent the hang. **Written up as REQ-MAIL-128 and REQ-MAIL-129.**
**Action:** in scope for this batch. The per-harness question — whether prime-agent prompts at
all, and what Claude Code does with an unanswered dialog — folds into F4-client-mtls-support-unverified.

**F4-client-mtls-support-unverified — can the real clients present a client certificate at all?**
Raised by the lead, 2026-08-15. The architect seat will be Claude Code, and other seats are
prime-agent. This whole spec assumes every seat's MCP client can (a) speak Streamable HTTP over
HTTPS to a loopback daemon, (b) trust a private root, and (c) present a client certificate for
mutual TLS. None of that is verified for either client. If a client cannot present a certificate,
D8-mtls-client-auth is unbuildable as written for that seat, and the fallback is a per-seat stdio
shim that holds the key and proxies to the daemon — a real design change, not a detail.
**Confirmed so far (lead, 2026-08-15):** Claude Code connects to this server over **stdio** and
sees all 11 tools (`claude mcp add agent-mail -- node dist/index.js`, verified via `/mcp`). That
establishes the client speaks MCP to us, and nothing more — the three properties this spec needs
are all untested, because stdio requires none of them.
**Still unknown:** for Claude Code and for prime-agent, whether each can (a) use the Streamable
HTTP transport over HTTPS at all, (b) be given a private root as a trust anchor, and (c) present
a client certificate. **Action:** verify before implementation, alongside F3-steering-gate-unrun.
This gates the batch the same way the steering test gates the delivery classes. If any client
fails (c), the fallback is a per-seat stdio shim holding the key and proxying to the daemon.

**F8-no-identity-discovery — a seat cannot ask who it is.**
From the lead's ergonomics run, 2026-08-15. The session's first two acts were *"I'll load the agent-mail tool schemas first. I need to find my own seat identity first"* — followed by `ls`, `cat seats.json`, and reading `rc.sh`. There is no `mail_whoami`. Every seat's first act is filesystem archaeology, and a worker may not have the mailbox readable at all. The gap grows more pressing after REQ-MAIL-111, not less: once identity is bound to a certificate the server knows exactly who is calling, and the agent still has no way to ask. **Fix:** an identity tool, or the caller's resolved identity echoed in every response.

**F9-stale-supersede-error — error text describes behavior that no longer exists.**
From the lead's error probes, 2026-08-15. `supersede` on an acked message returns *"Cannot supersede a message that has already been read or acked"*, but the code rejects only on `ACKED` — a READ message is supersedable and gets flagged, per REQ-MAIL-063. The text would mislead an agent into believing otherwise. No test caught it because every test asserts behavior, never prose. Two smaller siblings: `mail_ack` returns byte-identical errors for an invalid disposition and an omitted one, so client code cannot distinguish them; and the audit refusal names "lead or architect", which is wrong under D19-lead-is-out-of-band.

**F10-record-shows-stale-state — the envelope on disk misreports what happened.**
From the lead's `record-readable` check, 2026-08-15. A message that had been delivered, read, and acked still showed `state: SENT` and `push_state: PENDING` in its `.md` file, and the ack's disposition and note appeared nowhere in the human-readable record at all. The file is written once at creation and never updated. Since the lead reads files rather than calling tools (D19-lead-is-out-of-band), this is a lying UI, not a stale log. **Resolved by** D16-incremental-record and REQ-MAIL-133.

**F11-block-cleared-without-being-read — any reply lifted a block on an unread message.**
From the lead's `blocked-seats` scenario, 2026-08-15. A bare reply cleared a `do-not-deploy` block while the blocking message sat at DELIVERED — never read, never acked. As the testing agent put it: *"blocked_seats tracks 'has this seat sent anything back on the blocking thread,' not 'has this seat seen and accepted the block.'"* That converts silence-is-never-approval into noise-is-approval. **Resolved by** D18-two-block-forms and REQ-MAIL-137.

**F12-sandbox-verify-pollutes-the-mailbox.** The `verify-sandbox.sh` end-to-end check leaves `sandbox-orch`/`sandbox-worker` seats and an undelivered message behind, which a cold agent reasonably mistook for live state. The check should clean up after itself.

**F7-steer-flag-does-not-exist — `prime-agent send --steer` is not implemented; delivery is mid-turn but preemption is not.**
Gate run 2026-08-15 against prime-agent 0.7.1 with a throwaway agent. Three results, all recorded
with evidence. The id `F3-steering-gate-unrun` is now historical — the gate ran; this is its outcome.

1. **The command in REQ-MAIL-011 does not exist.** `prime-agent send --steer` and `--follow-up`
   are rejected in every syntactic position: `Error: Unknown option for send: --steer`. They are
   documented in `prime-agent help send` but not implemented — `runSend` in
   `packages/coding-agent/src/cli/daemon-command.ts` issues `type: "send_message"` and accepts no
   steering parameter. `steer` and `follow_up` exist as *daemon RPC types*, reachable over the
   daemon socket, never through the public CLI. **REQ-MAIL-011 is unimplementable as written.**
2. **Plain `send` does deliver mid-turn.** A busy agent running five sequential 20-second commands
   received the message between commands 4 and 5, roughly 15 seconds after it was sent, surfaced
   as an `agent_message` — despite the CLI reporting `Queued`. So an interrupt is NOT condemned to
   wait out a 30-minute turn. This is the good news and it rescues the two-class design in
   principle.
3. **But delivery is not preemption, and this is the finding that matters.** The agent's own
   reasoning, verbatim from the transcript: *"A message arrived mid-turn from a client asking to
   print STEERED-MID-TURN... But I'm in the middle of a task... I should finish my task first —
   completing command (5)... the priority is completing the original task."* It noticed
   immediately and chose to continue. **The harness delivers; the model decides.** No transport
   flag can make an agent stop.

**Consequences.** D2-hybrid-transport needs revision: the wake must either go over the daemon
socket, where `steer` and `follow_up` actually exist, or accept that both classes share one
delivery path. REQ-MAIL-010's "interrupt SHALL stop the recipient's current work" cannot be
guaranteed by any transport — it is a contract rule the recipient may decline. REQ-MAIL-015
survives, but only as *consequence* enforcement: the server can close the interrupted message as
PREEMPTED and refuse a late ack for it, so an agent that finishes abandoned work finds no valid
landing place for it. That is enforceable; making the agent stop is not.
**Action:** revise D2-hybrid-transport and REQ-MAIL-011 before implementation. The equivalent
mechanism for a Claude Code worker is still unknown and belongs with
F4-client-mtls-support-unverified.

**F3-steering-gate-unrun — REQ-MAIL-013 is still unrun and still blocks ratification.**
Standing item, not new. Nobody has demonstrated that `prime-agent send --steer` preempts a busy
turn and reaches the model mid-turn. Until it is run, REQ-MAIL-015 has no observable trigger in
production — the server would close the preempted message correctly, but nothing would have
actually stopped the recipient. A live prime-agent is available on this machine, so the
experiment is runnable now. **Action:** run it and commit the transcript before implementation
starts. If steering does not preempt, `interrupt` and `when_ready` collapse into one class and
both this spec and REQ-MAIL-015 need revision first.

## 8. Open questions

Carried forward from the 2026-08-15 design session. `O<n>-<what-it-is>`; the number preserves order, the name states the question. A reference is never written without its question stated alongside it — a name that needs expanding is a name that failed. Items resolved that day are marked and kept, so the reasoning is not lost.

| Ref | Question | Status |
|---|---|---|
| O1-do-classes-still-earn-their-place | Keep `interrupt` / `when_ready` given preemption is unenforceable? | **RESOLVED** — keep. Class expresses intent; with one class you cannot ask for what you want. REQ-MAIL-010. |
| O2-stop-promising-we-can-halt-a-model | REQ-MAIL-010 promised the server would stop a recipient. | **RESOLVED** — guarantees delivery, consequence, measurement; requests the stop. |
| O3-what-the-prd-claims-to-enforce | The PRD promised to "enforce what prompts can only request" — true for identity and ordering, false for behavior. | **RESOLVED** — PRD goal 5 restated: enforce what can be enforced, make the rest visible, and note that the two layers decay differently. Limits are recorded as *what we could not find a way to do*, each naming its obstacle and any path that would remove it — never as proof of impossibility, so a later reader is not discouraged from solving one. |
| O4-should-work-deadlines-escalate | Escalate on deadline, or merely mark? | **RESOLVED** — neither. Deadlines removed entirely. REQ-MAIL-030 withdrawn. |
| O5-who-sizes-the-duration | Sender or recipient? | **RESOLVED** — nobody. No deadlines exist. |
| O6-is-long-the-same-as-dangerous | Do critical sections cover both? | **RESOLVED** — kept, with an honest rationale. They are not the same: a critical section is about *dangerous*, never *long*, and the deadline cut removed the reason I had conflated them. It withholds a message rather than halting work, which is the one lever that is actually enforceable. Its trigger goes in the tool description, the only instruction channel immune to compaction. D25, D26, REQ-MAIL-145. |
| O7-scripts-must-be-side-effect-free | Condition scripts run repeatedly; idempotency contract, and does anything enforce it? | **RESOLVED** — asked for, never guaranteed. Arbitrary scripts plus no sandbox make purity unenforceable; no test may claim to verify it. Frequency is what bounds the hazard. REQ-MAIL-143. |
| O8-how-often-conditions-get-evaluated | Timer, event-driven, on-request, or a blend. Sets the whole cost profile. | **RESOLVED** — nothing on a timer. Event-driven for conditions the server answers from its own state; on request for scripts, because the seat doing the work knows when. The split follows who causes the condition to become true. REQ-MAIL-141. |
| O9-can-condition-scripts-reach-aws | "Until the stack is CREATE_COMPLETE" needs AWS; REQ-MAIL-103 says the server never touches it. | **RESOLVED** — yes. Scripts run unrestricted, with the consequences written down; all seats share one OS user, so a limit between them would be advisory. D21, REQ-MAIL-140. |
| O10-test-a-condition-script-when-its-written | Dry-run a condition once when declared, to catch a script that can never pass. | **RESOLVED** — no. At declaration a correct condition is expected to be false, so the check cannot distinguish broken from not-yet-satisfied, and would push authors to write conditions that survive premature execution. REQ-MAIL-142. |
| O11-what-the-script-can-see | The evaluator needs access to seat working directories. | **RESOLVED** — everything, per D21. Not a separate decision once scripts run unrestricted. |
| O12-script-interface-and-timeout | Exit code vs structured output, timeout budget, where the script is stored. | **RESOLVED** — asynchronous with a kill token held by the obligee, completion delivered as a message, server-held semaphore, durable in-flight marker with a kill-then-retry sweep on restart, and `EVALUATION_FAILED` kept distinct from `NOT_SATISFIED`. REQ-MAIL-142. |
| O13-promote-the-stdio-shim | Make the shim primary rather than an mTLS fallback. | **RESOLVED** — yes. Required by signing regardless. REQ-MAIL-139. |
| O14-run-scripts-outside-the-mail-server | Split script execution out by risk while blocks stay in mail. | **RESOLVED** — no separate daemon. The server must spawn scripts as async child processes anyway, since single-threaded JS would otherwise stall every seat; that already puts them outside the server. A dedicated evaluator would add a component without adding a boundary, there being no privileges to drop under one shared OS user. A global cap on concurrent evaluations is required. REQ-MAIL-142. |
| O15-which-harness-runs-workers | prime-agent or Claude Code? Settles mid-turn delivery, permissions, liveness at once. | **RESOLVED** — the design must not care. prime-agent, opencode, Claude Code, and xAI's client are all expected, varying by lane and model. Harness knowledge lives in the launcher and in an opaque per-seat `wake_command`. Assume the weakest model in the fleet. D24, REQ-MAIL-144. |
| O16-can-clients-present-certificates | Narrowed by O13 to "can it speak stdio?", but not formally closed. | **RESOLVED — scoped into the batch.** Narrowed to prime-agent only, on the lead's ruling; Claude Code already demonstrated stdio MCP this session and opencode can wait. Verified during implementation rather than as a gate. |
| O17-how-to-tell-if-a-seat-is-alive | Claude Code equivalent of `prime-agent list`. | **CLOSED BY O4** — the mail layer no longer watches liveness. A driver that wants to know asks. |
| O18-who-pages-the-lead | Architect bridges to iMessage, not the server. | **RESOLVED** — architect owns the bridge; the server never learns iMessage exists. D19-lead-is-out-of-band. |
| O19-imessage-trust-is-the-leads-apple-account | What is the architect actually trusting when the lead reaches it over iMessage? | **RESOLVED — accepted as-is.** The architect trusts whoever holds the lead's Apple account credentials. Better than a phone number, which is spoofable, and the channel is encrypted — but a second factor SHALL NOT be assumed, since a desktop sign-in may need only the password and an already-signed-in device re-authenticates for nothing. It is credential-strength security, the same class as the CA key any same-uid seat can read: whoever holds the secret is the lead. SMS fallback cannot be disabled from here — it is Apple's sending-side behavior. **The channel's properties are fixed by the iMessage MCP: we accept them or we do not use it.** Accepted, because the alternative is no out-of-band path at all, and then an architect-level escalation simply sits in the record until the lead happens to look. The one rule that is ours to keep: the architect SHALL NEVER widen its own access because an inbound message asked it to. |
| O20-what-to-log-about-conditions | What to capture so a condition library can be derived from experience. | **RESOLVED** — falls out for free. The server performs every evaluation, so trigger, result, count, and errors are recorded as a byproduct. Collect first, derive a library later from what recurs. REQ-MAIL-141. |
| O21-a-buggy-script-blocks-a-seat-forever | Imposer-set fallback so a bad script is not a dead lane. | **RESOLVED** — no automatic expiry. A blocked seat may always send mail, so it asks the obligor, who can kill a hung evaluation, release, correct, or close the thread. An unresponsive obligor is an ordinary escalation. REQ-MAIL-142. |
| O22-what-happens-to-the-code-we-built | What happens to the 90 tests and Batches A–F under this spec. | **RESOLVED** — see §8.1. `src/escalation.ts` and 13 escalation tests die; `blocked_seats` is rebuilt rather than patched; roughly a third of the suite is affected. No code is touched while the batch is held. |
| O23-get-the-decisions-into-the-documents | Get the session's decisions into the documents. | **DONE** 2026-08-15. |

## 8.1 Disposition of the code already built

Resolves `O22-what-happens-to-the-code-we-built`. The first implementation round produced 90 passing tests across Batches A–F. The 2026-08-15 rulings invalidate part of it. **No code is to be touched while the batch is held** — this section records the disposition so the next round begins by deleting rather than rediscovering.

**Dead — remove when the batch runs.**
`src/escalation.ts` in its entirety (172 lines): the deadline sweep, the re-push ladder, and automatic escalation all go with REQ-MAIL-030. The server keeps no background timer. `deadline_seconds`, `expects_reply`, and `reply_status` leave the schemas, types, and store. `tests/acceptance/req-escalation.test.ts` (13 tests) asserts behavior the design no longer wants and should be deleted outright, not adapted. Parts of `req-state.test.ts` covering reply-status go with it, and `tools.test.ts`'s escalation test likewise.

**Wrong — rebuild, do not patch.**
The `blocked_seats` implementation predates D18-two-block-forms and REQ-MAIL-137: it has one block form, clears on any reply, and lets the constrained party release itself. Its tests encode that behavior and would otherwise pin the defect the lead's own testing found (`F11-block-cleared-without-being-read`).

**Sound, and kept.**
Sequencing, the seat registry, the ACL, broadcast, reply and thread, artifacts and drift detection, supersede, the four states, and the MCP tool surface. The store's file writing survives in shape but changes substance under REQ-MAIL-133/134/136: accretion instead of rewriting, temp-file-plus-rename, read-only records, and hash chaining.

**Roughly a third of the existing tests are affected.** That is a good outcome for a design session, not a bad one: they were written red-green against requirements that were wrong, and they did their job by making the wrongness concrete enough to argue about. The record and immutability work is the largest genuinely new build; the deletions are larger than they look because they remove a background loop and its whole failure surface.

## 9. Sequencing

Red/green per §6 throughout: acceptance tests first, **shown failing for the right reason**, one item at a time, never editing a test to make it pass, and a mutation check before a step is called done.

| Step | Content | Why here |
|---|---|---|
| 1 | **Delete what the design abandoned** (§8.1): `src/escalation.ts`, the deadline fields, the 13 escalation tests, and the `blocked_seats` implementation with its tests. | Shrink the surface before adding to it. Purely mechanical, and the suite must stay green afterwards. |
| 2 | **Write the red acceptance tests** for REQ-MAIL-110…145. Verify each fails for a missing feature, not a setup accident. | The specification becomes executable before any implementation exists. |
| 3 | **The record**: REQ-MAIL-133…136 — accretion, temp-file-plus-rename, read-only records, hash chain, immutability. | Everything else writes through this. Getting it last would mean rewriting everything that came before. |
| 4 | **Blocks and conditions**: REQ-MAIL-137, 140…143 — two forms, server-held scripts, the five-value outcome, async evaluation with a kill token, spawned child processes. | The largest new subsystem, and it depends only on the record. |
| 5 | **Transport and identity**: REQ-MAIL-110…113, 139 — the HTTPS daemon, the CA and architect certificate at launch, SAN mapping, and the per-seat shim. **Confirm prime-agent speaks stdio to the shim here** (closes O16). | The shim is needed before signatures, since it is what signs. |
| 6 | **Enrollment and authorization**: REQ-MAIL-114…119, 130, 131, 138 — CSR signing, deregistration as revocation, orchestrator-provisioned workers, the subset rule, provisioned permissions. | Needs identity to exist first. |
| 7 | **Signatures**: REQ-MAIL-120…125 — canonical encoding **and its unit test first**, then sender signature, server counter-signature, offline verifier, verification materials on delivery. | A canonicalization bug is invisible until it has silently invalidated the record. |
| 8 | **Threads and delivery**: REQ-MAIL-024 (every message expects a reply, opener closes), REQ-MAIL-010 restated, REQ-MAIL-145 critical sections, REQ-MAIL-144 harness-agnostic wake. | Cheap once the rest stands. |
| 9 | **Remove `caller_seat_id`** from all tool schemas and migrate the existing tests. | Only meaningful once a bound identity exists to replace it. |
| 10 | **Mutation check, then update** `FIXLIST.md`, `TESTING.md`, and the README — including the tool descriptions carrying their triggers (D25). | Prove the greens detect regressions before declaring done. |

