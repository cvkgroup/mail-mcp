#!/usr/bin/env bash
# safe-shell.sh — create an isolated agent-mail sandbox and drop the user into an
# interactive shell whose every wake is captured by a stub, never forwarded to a
# live prime-agent session.
#
# The sandbox is verified before the shell opens (verify-sandbox.sh); if any check
# fails the shell is NOT opened. Nothing ever writes outside the sandbox, and the
# repo's week7/mail is never touched.
#
# Usage: ./scripts/safe-shell.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="${SCRIPT_DIR}/verify-sandbox.sh"

# ---------------------------------------------------------------- 1. fresh sandbox
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/agent-mail-sandbox.XXXXXX")"
mkdir -p "${SANDBOX}/bin" "${SANDBOX}/mail"

# ------------------------------------------------- 2. stub prime-agent (captures only)
cat > "${SANDBOX}/bin/prime-agent" <<'EOF'
#!/bin/sh
# agent-mail sandbox stub — NEVER forwards to or execs the real prime-agent.
# Records every invocation (arguments + stdin) and consumes stdin so callers
# never block. The wake log lives inside the sandbox.
: "${AGENT_MAIL_SANDBOX:?sandbox env not set}"
{
  printf 'args: %s\n' "$*"
  printf 'stdin: '
  cat
  printf '\n'
} >> "${AGENT_MAIL_SANDBOX}/wakes.log"
exit 0
EOF
chmod +x "${SANDBOX}/bin/prime-agent"

# -------------------------------------------------------------- 3. sandboxed env
export PATH="${SANDBOX}/bin:${PATH}"
export AGENT_MAIL_SANDBOX="${SANDBOX}"
export AGENT_MAIL_BASE_DIR="${SANDBOX}/mail"
export AGENT_MAIL_BOOTSTRAP='[{"id":"lead","role":"lead","lane":"hq"}]'

# ------------------------------------------------------------------ 4. banner
echo
echo "agent-mail sandbox"
echo "  sandbox:     ${SANDBOX}"
echo "  prime-agent: $(command -v prime-agent)  (stub — wakes are captured, never forwarded)"
echo "  mailbox:     ${AGENT_MAIL_BASE_DIR}"
echo

# ------------------------------------------- 5. prove it before opening the shell
if ! bash "${VERIFY}"; then
  echo
  echo "REFUSING TO OPEN THE SHELL: the sandbox could not prove itself safe."
  echo "Sandbox left at ${SANDBOX} for inspection. Remove it with:"
  echo "  rm -rf \"${SANDBOX}\""
  exit 1
fi
echo "Sandbox verified. Opening a marked shell (type 'exit' to leave)..."
echo

# -------------------------------- 6. interactive shell with a visibly marked prompt
cat > "${SANDBOX}/rc.sh" <<EOF
export PS1='[agent-mail sandbox] \\w\\$ '
export PATH="${SANDBOX}/bin:\${PATH}"
export AGENT_MAIL_SANDBOX="${SANDBOX}"
export AGENT_MAIL_BASE_DIR="${SANDBOX}/mail"
export AGENT_MAIL_BOOTSTRAP='[{"id":"lead","role":"lead","lane":"hq"}]'
echo "  [inside the agent-mail sandbox — every wake is recorded in \${AGENT_MAIL_SANDBOX}/wakes.log]"
EOF

set +e   # the interactive shell decides the exit code; the epilogue must still print
case "${SHELL:-/bin/bash}" in
  *bash)
    # shellcheck disable=SC2086
    "${SHELL}" --noprofile --rcfile "${SANDBOX}/rc.sh"
    INNER_RC=$?
    ;;
  *zsh)
    # `-f` skips ~/.zshrc so nothing can clobber the sandbox PATH or prompt; zsh
    # honors the exported PS1 as its prompt.
    PS1='[agent-mail sandbox] %# ' "${SHELL}" -f
    INNER_RC=$?
    ;;
  *)
    # Unfamiliar shell: fall back to bash with the sandbox rcfile.
    /bin/bash --noprofile --rcfile "${SANDBOX}/rc.sh"
    INNER_RC=$?
    ;;
esac
set -e

# -------------------------------------------------------------- 7. epilogue: report
WAKE_COUNT="$(grep -c '^args: ' "${SANDBOX}/wakes.log" 2>/dev/null || echo 0)"
echo
echo "Left the agent-mail sandbox."
echo "  sandbox: ${SANDBOX}"
echo "  wakes:   ${WAKE_COUNT} recorded in wakes.log"
echo "  remove:  rm -rf \"${SANDBOX}\""
exit "${INNER_RC}"
