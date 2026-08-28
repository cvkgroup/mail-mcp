#!/usr/bin/env bash
# seat-session.sh — open a Claude session that acts as an isolated agent-mail test seat.
#
# Why this exists: hand-wiring a seat burned the lead twice at once — an unset
# $AGENT_MAIL_SANDBOX stored AGENT_MAIL_BASE_DIR literally as "/mail" (server died,
# MCP handshake failed, Claude showed -32000), and the stored PATH lacked the sandbox
# stub, so wakes would have escaped to live prime-agent sessions. This script makes
# both impossible: it refuses to run outside a verified sandbox, verifies every path,
# proves the server completes an MCP handshake BEFORE launching claude, and re-checks
# the stored config after registration.
#
# Usage: run inside a sandbox shell (scripts/safe-shell.sh first):
#     npm run seat-session            # seat dir defaults to $AGENT_MAIL_SANDBOX/seat
#     npm run seat-session /path/to/dir
#
# Env overrides: CLAUDE_BIN (default: the real claude resolved outside the sandbox).

set -uo pipefail

SEAT_ARG="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HELPER="${SCRIPT_DIR}/seat-check.mjs"
BOOTSTRAP='[{"id":"lead","role":"lead","lane":"hq"}]'
NODE_BIN="$(command -v node || true)"

refuse() { printf 'REFUSING (seat-session): %s\n' "$1"; exit 1; }

# The real claude lives OUTSIDE the sandbox PATH. Honor an explicit override, else
# search PATH entries excluding the sandbox bin; homebrew is the documented location.
CLAUDE_BIN="${CLAUDE_BIN:-}"
if [ -z "${CLAUDE_BIN}" ]; then
  SANDBOX_FOR_SEARCH="${AGENT_MAIL_SANDBOX:-}"
  if [ -x /opt/homebrew/bin/claude ]; then
    CLAUDE_BIN=/opt/homebrew/bin/claude
  else
    OLD_IFS="$IFS"; IFS=:
    for dir in ${PATH}; do
      IFS="$OLD_IFS"
      [ -n "${dir}" ] || continue
      if [ "${dir}" != "${SANDBOX_FOR_SEARCH}/bin" ] && [ -x "${dir}/claude" ]; then
        CLAUDE_BIN="${dir}/claude"
        break
      fi
    done
    IFS="$OLD_IFS"
  fi
fi

# ------------------------------------------------------------------ 1. sandbox gate
SANDBOX="${AGENT_MAIL_SANDBOX:-}"
if [ -z "${SANDBOX}" ] || [ ! -d "${SANDBOX}" ]; then
  refuse "AGENT_MAIL_SANDBOX is unset or gone. Run ./scripts/safe-shell.sh first so every wake is captured by the stub."
fi
if [ ! -x "${SANDBOX}/bin/prime-agent" ]; then
  refuse "the sandbox stub ${SANDBOX}/bin/prime-agent is missing. Run ./scripts/safe-shell.sh first."
fi
RESOLVED="$(command -v prime-agent 2>/dev/null || true)"
if [ "${RESOLVED}" != "${SANDBOX}/bin/prime-agent" ]; then
  refuse "prime-agent resolves to '${RESOLVED}', not the sandbox stub ${SANDBOX}/bin/prime-agent. Run ./scripts/safe-shell.sh first — never continue with a partial environment."
fi
if [ -z "${CLAUDE_BIN}" ] || [ ! -x "${CLAUDE_BIN}" ]; then
  refuse "could not find the real claude binary (set CLAUDE_BIN to its absolute path)."
fi

# ------------------------------------------------- 2. resolve + verify every path
MAILBOX="${SANDBOX}/mail"
case "${MAILBOX}" in
  "${SANDBOX}"|"${SANDBOX}/"*) ;;
  *) refuse "mailbox ${MAILBOX} is not under the sandbox ${SANDBOX}." ;;
esac
if [ ! -d "${MAILBOX}" ]; then
  mkdir -p "${MAILBOX}" || refuse "cannot create mailbox ${MAILBOX}."
fi

SERVER="${REPO_DIR}/dist/index.js"
if [ ! -f "${SERVER}" ]; then
  printf 'building the server first (no dist/index.js)...\n'
  (cd "${REPO_DIR}" && npm run build > /dev/null 2>&1) || refuse "npm run build failed; cannot verify a server that does not exist."
fi
[ -f "${SERVER}" ] || refuse "built server ${SERVER} is missing."

# PATH to store: the sandbox stub absolutely first, then the current PATH without a
# duplicate leading stub entry.
REST_PATH="${PATH}"
case "${REST_PATH}" in
  "${SANDBOX}/bin:"*) REST_PATH="${REST_PATH#"${SANDBOX}/bin:"}" ;;
esac
STUBBED_PATH="${SANDBOX}/bin:${REST_PATH}"

# ------------------------------------------------------------- 3. isolated seat dir
SEAT_DIR="${SEAT_ARG:-${SANDBOX}/seat}"
case "${SEAT_DIR}" in
  /*) ;;
  *) SEAT_DIR="$(pwd)/${SEAT_DIR}" ;;
esac
case "${SEAT_DIR}" in
  "${REPO_DIR}"|"${REPO_DIR}/"*)
    refuse "seat directory ${SEAT_DIR} is inside the repo. A session with the repo as cwd can read the source, the specs, and TESTING.md — that invalidates the ergonomics test it exists to perform, and it would share the repo's Claude config and project memory. Pick a directory under the sandbox (default: ${SANDBOX}/seat)."
    ;;
esac
mkdir -p "${SEAT_DIR}/.claude" || refuse "cannot create seat directory ${SEAT_DIR}."
# The seat is a fresh directory with no Claude settings, so without this file the user would
# be prompted for permission on every single tool call. Pre-approve only what the ergonomics
# run needs: the agent-mail MCP server (mcp__agent-mail covers all 11 mail tools), plus
# Read/Write (artifact-drift scenario) and Bash (inspecting the mailbox). Deliberately NO
# --dangerously-skip-permissions anywhere.
cat > "${SEAT_DIR}/.claude/settings.local.json" <<'JSON'
{"permissions":{"allow":["mcp__agent-mail","Read","Write","Bash"]}}
JSON
echo "check seat-dir-is-isolated: OK — ${SEAT_DIR} is outside the repo, with mail tools pre-approved"

# ------------------------------------------------------- 4. register the MCP server
( cd "${SEAT_DIR}" && "${CLAUDE_BIN}" mcp remove agent-mail > /dev/null 2>&1 || true )
if ! ( cd "${SEAT_DIR}" && "${CLAUDE_BIN}" mcp add agent-mail \
        -e "AGENT_MAIL_BASE_DIR=${MAILBOX}" \
        -e "AGENT_MAIL_BOOTSTRAP=${BOOTSTRAP}" \
        -e "PATH=${STUBBED_PATH}" \
        -- "${NODE_BIN}" "${SERVER}" > /dev/null 2>&1 ); then
  refuse "claude mcp add failed in ${SEAT_DIR}."
fi

# -------------------------------------------------- 5. prove the server actually starts
if ! "${NODE_BIN}" "${HELPER}" "${SERVER}" "${MAILBOX}" "${BOOTSTRAP}" "${STUBBED_PATH}"; then
  refuse "the server did not pass its startup proof — not launching claude with a dead server."
fi

# -------------------------------------------- 6. confirm the stored config is stubbed
STORED_PATH="$(cd "${SEAT_DIR}" && "${CLAUDE_BIN}" mcp get agent-mail 2>/dev/null | sed -n 's/^[[:space:]]*PATH=//p' | head -1)"
case "${STORED_PATH}" in
  "${SANDBOX}/bin:"*|"${SANDBOX}/bin")
    echo "check seat-path-is-stubbed: OK — stored PATH begins with ${SANDBOX}/bin"
    ;;
  *)
    refuse "stored PATH for the registered server is '${STORED_PATH}' — it does not begin with the sandbox stub ${SANDBOX}/bin."
    ;;
esac

# --------------------------------------------------------------------- 7. banner
echo
echo "seat session ready:"
echo "  seat dir:    ${SEAT_DIR}"
echo "  mailbox:     ${MAILBOX}"
echo "  server:      ${SERVER}"
echo "  bootstrap:   ${BOOTSTRAP}"
echo "  claude:      ${CLAUDE_BIN}"
echo "  permissions: ${SEAT_DIR}/.claude/settings.local.json pre-approves the mail tools (mcp__agent-mail, Read, Write, Bash) — no per-call prompts"

echo
echo "Opening the seat session (exit when done)..."
cd "${SEAT_DIR}"
set +e
"${CLAUDE_BIN}"
INNER_RC=$?
set -e

# ------------------------------------------------------------------- 8. on exit
echo
echo "Exited the seat session (rc=${INNER_RC})."
echo "  remove the registration: cd \"${SEAT_DIR}\" && claude mcp remove agent-mail"
echo "  mailbox:  ${MAILBOX}"
echo "  wakes:    ${SANDBOX}/wakes.log"
exit "${INNER_RC}"
