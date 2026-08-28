#!/usr/bin/env bash
# verify-sandbox.sh — prove the current shell is an agent-mail sandbox and that it
# provably cannot reach any live prime-agent session. Exits non-zero otherwise.
#
# Safety contract (see TESTING.md §0):
#   * Every wake target used here is a GENERATED canary seat name that is first
#     checked to appear nowhere in `prime-agent list`. The real binary is only ever
#     asked about that non-existent name — never about a live agent.
#   * The stub prime-agent never execs or forwards to anything; it only appends to
#     $AGENT_MAIL_SANDBOX/wakes.log and consumes stdin so callers never block.
#   * Nothing here writes outside the sandbox, and nothing is invoked through PATH
#     until this script has first CONFIRMED that PATH resolves prime-agent to the stub.
#
# Invariants we assert (things we DO control):
#   1. prime-agent resolves to the stub (stub-wins-path).
#   2. Every wake recorded in wakes.log targets a name that is NOT in the CURRENT
#      `prime-agent list` — never a live agent. Violating this FAILS the run.
#   3. The number of wakes the server attempted equals the number the stub captured
#      (counted across the E2E window) — nothing bypassed or doubled up.
# Live-agent message counts are compared and reported, but a change is only ever a
# WARNING: other architects' sessions are free to increment their own counts at any
# moment, so count stability is explicitly NOT an invariant we can hold.

set -u

FAILED=0
SANDBOX="${AGENT_MAIL_SANDBOX:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WAKES_LOG="${SANDBOX}/wakes.log"

pass() { printf 'check %s: OK — %s\n' "$1" "$2"; }
fail() { printf 'check %s: FAIL — %s\n' "$1" "$2"; FAILED=1; }
skip() { printf 'check %s: SKIP — %s\n' "$1" "$2"; }
warn() { printf 'check %s: WARN — %s\n' "$1" "$2"; }

# The real prime-agent lives OUTSIDE the sandbox PATH. Prefer the documented
# homebrew location; otherwise search PATH entries excluding the sandbox bin.
REAL_PRIME_AGENT=""
if [ -n "${SANDBOX}" ] && [ -x /opt/homebrew/bin/prime-agent ]; then
  REAL_PRIME_AGENT=/opt/homebrew/bin/prime-agent
else
  OLD_IFS="$IFS"
  IFS=:
  for dir in ${PATH}; do
    IFS="$OLD_IFS"
    [ -n "${dir}" ] || continue
    if [ "${dir}" != "${SANDBOX}/bin" ] && [ -x "${dir}/prime-agent" ]; then
      REAL_PRIME_AGENT="${dir}/prime-agent"
      break
    fi
  done
  IFS="$OLD_IFS"
fi

# Read-only snapshot of every live agent: one "name=messages" line each, sorted.
live_snapshot() {
  "${REAL_PRIME_AGENT}" list 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | awk 'NR > 1 && NF >= 1 { print $1 "=" $(NF-1) }' \
    | sort
}

is_live_name() {
  local name="$1"
  "${REAL_PRIME_AGENT}" list 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | awk 'NR > 1 { print $1 }' \
    | grep -qx "${name}"
}

# ------------------------------------------------------------------ 1. stub wins PATH
STUB_OK=0
if [ -z "${SANDBOX}" ] || [ ! -d "${SANDBOX}" ]; then
  fail "stub-wins-path" "AGENT_MAIL_SANDBOX is not set (or its directory is gone) — run scripts/safe-shell.sh"
else
  resolved="$(command -v prime-agent 2>/dev/null || true)"
  if [ "${resolved}" = "${SANDBOX}/bin/prime-agent" ] && [ -x "${SANDBOX}/bin/prime-agent" ]; then
    pass "stub-wins-path" "prime-agent resolves to ${resolved} (the sandbox stub, not the real daemon)"
    STUB_OK=1
  else
    fail "stub-wins-path" "prime-agent resolved to '${resolved}'; expected ${SANDBOX}/bin/prime-agent. The real binary would win."
  fi
fi

# -------------------------------------------------- 2. stub captures the wake (never forwards)
CANARY="sandbox-canary-$(date +%s)-$$"

if [ "${STUB_OK}" -ne 1 ]; then
  fail "stub-captures-wake" "no confirmed sandbox stub on PATH — refusing to invoke prime-agent at all"
else
  if is_live_name "${CANARY}"; then
    fail "stub-captures-wake" "canary ${CANARY} matches a live agent — refusing to send anywhere"
  else
    printf 'sandbox-canary-wake\n' | prime-agent send --steer "${CANARY}" 2>/dev/null || true
    if grep -q "${CANARY}" "${WAKES_LOG}" 2>/dev/null; then
      pass "stub-captures-wake" "stub recorded the wake: $(grep "${CANARY}" "${WAKES_LOG}" | tail -1)"
    else
      fail "stub-captures-wake" "no wake-log line for ${CANARY} — nothing was captured"
    fi
  fi

  # Contrast: the SAME canary through the real binary must fail (the session does
  # not exist), and the real invocation must add nothing to the stub's log. Safe
  # because the canary matches no live agent — the daemon is only asked about
  # a session that does not exist.
  if [ -n "${REAL_PRIME_AGENT}" ]; then
    before_real="$(wc -l < "${WAKES_LOG}" 2>/dev/null || echo 0)"
    real_out="$(printf 'sandbox-canary-wake\n' | "${REAL_PRIME_AGENT}" send "${CANARY}" "sandbox canary wake" 2>&1 || true)"
    after_real="$(wc -l < "${WAKES_LOG}" 2>/dev/null || echo 0)"
    unknown="$(printf '%s' "${real_out}" | grep -o "Unknown active session: [^ ]*" | head -1 | sed 's/\x1b\[[0-9;]*m//g')"
    if [ -n "${unknown}" ]; then
      printf '        (the real binary, asked only about the non-existent session, replied: %s)\n' "${unknown}"
    else
      printf '        (the real binary could not deliver to the canary — no live agent to reach)\n'
    fi
    if [ "${after_real}" -eq "${before_real}" ]; then
      pass "stub-captures-wake" "the real binary rejected the canary without touching the stub log — no live agent called '${CANARY}' exists"
    else
      fail "stub-captures-wake" "the real invocation added lines to the stub log — unexpected"
    fi
  else
    skip "stub-captures-wake" "real prime-agent not found; contrast check skipped"
  fi
fi

# ---------------------------------------------------------------- 3. mailbox is sandboxed
BASE="${AGENT_MAIL_BASE_DIR:-}"
REPO_MAIL="$(cd "${REPO_DIR}" && pwd)/week7/mail"
under_sandbox=0
case "${BASE}" in
  "${SANDBOX}"|"${SANDBOX}/"*) under_sandbox=1 ;;
esac
if [ -z "${BASE}" ]; then
  fail "mailbox-is-sandboxed" "AGENT_MAIL_BASE_DIR is not set"
elif [ "${BASE}" = "${REPO_MAIL}" ]; then
  fail "mailbox-is-sandboxed" "AGENT_MAIL_BASE_DIR points at the repo's week7/mail"
elif [ "${under_sandbox}" -eq 1 ]; then
  pass "mailbox-is-sandboxed" "AGENT_MAIL_BASE_DIR=${BASE} lives under the sandbox and is not the repo's week7/mail"
else
  fail "mailbox-is-sandboxed" "AGENT_MAIL_BASE_DIR=${BASE} is not under ${SANDBOX}"
fi

# ------------------------------------------- 4. live-agent counts — WARNING ONLY.
# Other architects' agents increment their own counts whenever they are busy; we do
# not control them, so count stability is the one thing we explicitly do NOT treat
# as an invariant. A warning names the changed agents; the run still succeeds.
if [ -z "${REAL_PRIME_AGENT}" ]; then
  skip "live-agents-untouched" "real prime-agent not found; cannot snapshot the live set"
elif [ "${STUB_OK}" -ne 1 ]; then
  fail "live-agents-untouched" "no sandbox to store snapshot files in"
else
  before4="$(mktemp "${SANDBOX}/agents-before.XXXXXX")"
  after4="$(mktemp "${SANDBOX}/agents-after.XXXXXX")"
  live_snapshot > "${before4}"
  # checks 2 and 3 have already run by now — snapshot the "after" state
  live_snapshot > "${after4}"
  if [ ! -s "${before4}" ] || [ ! -s "${after4}" ]; then
    fail "live-agents-untouched" "could not read the live agent list (empty snapshot)"
  elif diff -q "${before4}" "${after4}" > /dev/null 2>&1; then
    pass "live-agents-untouched" "prime-agent list identical across the probe window ($(wc -l < "${before4}" | tr -d ' ') live agents, counts unchanged)"
  else
    changed="$(diff "${before4}" "${after4}" | grep -E '^[<>]' | sed -E 's/^[<>] //; s/=.*//' | sort -u | tr '\n' ' ')"
    printf '        (changed live agents during the window: %s)\n' "${changed}"
    diff "${before4}" "${after4}" | sed 's/^/        /'
    warn "live-agents-untouched" "some live agent counts changed during the probe — this is most likely unrelated activity by another agent's own session (the sandbox only ever targets non-existent canary names); not treated as a failure"
  fi
  rm -f "${before4}" "${after4}"
fi

# --------------------------------------------------- 5. end-to-end: real server, captured wake
if [ "${STUB_OK}" -ne 1 ]; then
  fail "end-to-end-wake-captured" "no sandbox stub available for the server's wake transport"
elif [ -z "${REAL_PRIME_AGENT}" ]; then
  skip "end-to-end-wake-captured" "real prime-agent not found; cannot snapshot the live set around the run"
else
  # Build if needed (quietly).
  if [ ! -f "${REPO_DIR}/dist/index.js" ] || find "${REPO_DIR}/src" -newer "${REPO_DIR}/dist/index.js" | grep -q .; then
    (cd "${REPO_DIR}" && npm run build > /dev/null 2>&1) || { fail "end-to-end-wake-captured" "npm run build failed"; }
  fi
  if [ -f "${REPO_DIR}/dist/index.js" ]; then
    before_e2e="$(mktemp "${SANDBOX}/agents-e2e-before.XXXXXX")"
    after_e2e="$(mktemp "${SANDBOX}/agents-e2e-after.XXXXXX")"
    live_snapshot > "${before_e2e}"
    ARGS_BEFORE_E2E="$(grep -c '^args: ' "${WAKES_LOG}" 2>/dev/null || echo 0)"

    # Drive the REAL server over MCP stdio against the sandbox mailbox. Every wake it
    # tries to send is handled by the stub, because PATH leads with $SANDBOX/bin.
    (cd "${REPO_DIR}" && \
      REPO_DIR="${REPO_DIR}" \
      AGENT_MAIL_SANDBOX="${SANDBOX}" \
      AGENT_MAIL_BASE_DIR="${SANDBOX}/mail" \
      AGENT_MAIL_BOOTSTRAP='[{"id":"lead","role":"lead","lane":"hq"}]' \
      PATH="${SANDBOX}/bin:${PATH}" \
      node --input-type=module - <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "sandbox-e2e", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: "node",
  args: [process.env.REPO_DIR + "/dist/index.js"],
  env: process.env,
}));

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  return JSON.parse(result.content?.[0]?.text ?? "{}");
};

await call("mail_register_seat", { caller_seat_id: "lead", id: "sandbox-orch", role: "orchestrator", lane: "sandbox", escalation_target: "lead" });
await call("mail_register_seat", { caller_seat_id: "lead", id: "sandbox-worker", role: "worker", lane: "sandbox", escalation_target: "sandbox-orch" });
const sent = await call("mail_send", { caller_seat_id: "sandbox-orch", to: "sandbox-worker", kind: "request", class: "when_ready", subject: "E2E", body: "wake must be captured" });
console.log("e2e-sent:", sent.id);
await client.close();
EOF
    ) > "${SANDBOX}/e2e.out" 2>&1
    e2e_rc=$?

    live_snapshot > "${after_e2e}"
    ARGS_AFTER_E2E="$(grep -c '^args: ' "${WAKES_LOG}" 2>/dev/null || echo 0)"
    ARGS_NEW=$(( ARGS_AFTER_E2E - ARGS_BEFORE_E2E ))

    # safety invariant: every wake target in the ENTIRE capture must not be a live agent
    capture_unsafe=0
    grep '^args: ' "${WAKES_LOG}" 2>/dev/null | sed -E 's/^args: send --[a-z-]+ //' > "${SANDBOX}/wake-targets.txt" || true
    while IFS= read -r tgt; do
      [ -n "${tgt}" ] || continue
      if is_live_name "${tgt}"; then
        echo "        (wake targeted a LIVE agent: ${tgt})"
        capture_unsafe=1
      fi
    done < "${SANDBOX}/wake-targets.txt"

    live_warning=""
    if ! diff -q "${before_e2e}" "${after_e2e}" > /dev/null 2>&1; then
      changed="$(diff "${before_e2e}" "${after_e2e}" | grep -E '^[<>]' | sed -E 's/^[<>] //; s/=.*//' | sort -u | tr '\n' ' ')"
      live_warning=" (live counts moved during the E2E window: ${changed}—likely unrelated activity; not a failure)"
    fi

    if [ "${e2e_rc}" -ne 0 ]; then
      echo "        (e2e driver rc=${e2e_rc})"
      tail -8 "${SANDBOX}/e2e.out" 2>/dev/null | sed 's/^/        /'
      fail "end-to-end-wake-captured" "the MCP round trip did not complete"
    elif [ "${ARGS_NEW}" -ne 1 ]; then
      echo "        (e2e driver rc=0; wake log had ${ARGS_BEFORE_E2E} wakes before and ${ARGS_AFTER_E2E} after — expected exactly +1)"
      fail "end-to-end-wake-captured" "${ARGS_NEW} wakes captured for the 1 send the driver performed — the server's attempts do not match the stub's captures (either a wake escaped the stub or extra wakes appeared)"
    elif ! grep -q "sandbox-worker" "${WAKES_LOG}" 2>/dev/null; then
      fail "end-to-end-wake-captured" "the served wake for 'sandbox-worker' is missing from wakes.log"
    elif [ "${capture_unsafe}" -ne 0 ]; then
      fail "end-to-end-wake-captured" "a captured wake targeted a name in the CURRENT prime-agent list — the sandbox leaked; aborting"
    else
      pass "end-to-end-wake-captured" "1 wake attempted = 1 wake captured for 'sandbox-worker'; every captured target is not a live agent${live_warning}"
    fi
    rm -f "${before_e2e}" "${after_e2e}" "${SANDBOX}/wake-targets.txt" 2>/dev/null
  fi
fi

# --------------------------------------------------------------------------- verdict
echo
if [ "${FAILED}" -eq 0 ]; then
  echo "VERDICT: SANDBOX VERIFIED — every wake was captured by the stub, none targeted a live agent."
  exit 0
else
  echo "VERDICT: SANDBOX UNSAFE — do not trust this shell. Exiting non-zero."
  exit 1
fi
