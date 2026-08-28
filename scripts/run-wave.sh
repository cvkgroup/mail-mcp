#!/bin/bash
# Run one red-phase wave, end to end, identically every time.
#
# Ruled by the lead 2026-08-15: every wave starts with a CLEAN CONTEXT. A worker carrying the
# previous wave's history is both slower and not comparable to the others, which destroys the
# timing this run exists to produce. So each wave gets a new agent, named for its wave.
#
# The brief is generated, never hand-written (scripts/make-red-brief.py). Nothing about the
# instructions changes between waves.
#
# Usage:  bash scripts/run-wave.sh <wave-number>
set -u
ROOT="/Volumes/repo 1/mail-mcp"
W="$1"
WW=$(printf "%02d" "$W")
AGENT="fable-w${WW}"
BRIEF="${ROOT}/briefs/wave-${WW}-red.md"

[ -f "$BRIEF" ] || { echo "ERROR: no brief at $BRIEF"; exit 1; }

# Never touch another architect's agents.
case "$AGENT" in nova*|vera*) echo "ERROR: refusing to use name $AGENT"; exit 1;; esac

# Move aside any output from an earlier attempt. A killed worker leaves its files on disk and the
# next run inherits them: on 2026-08-15 a dead run's four files were nearly counted as a live
# wave's output. The directory must be empty before the clock starts.
#
# MOVE, never delete. The lead wants the output of uncontrolled runs kept, to work out what it
# takes to control these generators. Discarded evidence cannot be re-examined.
OLD="${ROOT}/tests/acceptance/wave-${WW}"
if [ -d "$OLD" ]; then
  ATTIC="${ROOT}/discarded-runs/wave-${WW}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$ATTIC")"
  mv "$OLD" "$ATTIC"
  echo "moved previous attempt to ${ATTIC}"
fi

START=$(date +%s)
echo "WAVE ${W} START $(date '+%H:%M:%S')  agent=${AGENT}"

nohup script -q /dev/null prime-agent \
  --provider openrouter --model deepseek/deepseek-v4-flash-0731 \
  --cwd "$ROOT" \
  "Wave ${W} red phase. Read ${BRIEF} and follow it exactly. It is the complete and only instruction. Spawn one child agent per requirement listed in its table and run them all in parallel. Report when every child is finished." \
  >"/tmp/${AGENT}-launch.log" 2>&1 &

# Give the daemon time to register the new session, then claim the name.
for i in $(seq 1 24); do
  sleep 5
  ID=$(prime-agent list 2>/dev/null | awk 'NR>1 && $1 ~ /^[a-f0-9]{12}$/ {print $1; exit}')
  [ -n "${ID:-}" ] && break
done
[ -n "${ID:-}" ] || { echo "ERROR: new agent never appeared"; exit 2; }
prime-agent rename "$ID" "$AGENT" >/dev/null 2>&1 || echo "WARN: could not rename $ID"

# Wait for the CHILDREN. Two traps here, both hit on 2026-08-15:
#   - the parent goes idle as soon as it has dispatched, so parent-idle is a false completion;
#   - the parent INVENTS its children's names ("wave1-091" one run, "wave01-req-091" the next),
#     so any detector that matches a name is brittle. Match on STATE instead: nothing outside
#     the other architect's agents may be 'working'.
OTHERS='^prereview|^nova|^vera|^name '
busy() { prime-agent list 2>/dev/null | grep -vE "$OTHERS" | grep -qE " working "; }

started=0
for i in $(seq 1 180); do
  n=$(prime-agent list 2>/dev/null | grep -vE "$OTHERS" | grep -cE " (working|idle) " || true)
  [ "${n:-0}" -ge 2 ] && { started=1; break; }   # parent plus at least one child
  sleep 5
done
[ "$started" = 1 ] || { echo "ERROR: no child appeared within 15 minutes"; exit 3; }

while busy; do sleep 20; done

END=$(date +%s)
DIR="${ROOT}/tests/acceptance/wave-${WW}"
FILES=$(ls "$DIR" 2>/dev/null | wc -l | tr -d ' ')

# A wave time is only recorded once files exist. Two false completions on 2026-08-15 both read
# as success with nothing on disk, so the log requires evidence rather than a settled agent.
if [ "$FILES" = "0" ]; then
  echo "ERROR: wave ${W} children settled but ${DIR} is empty — NOT logging a time"
  exit 4
fi
printf "%s\t%s\t%s\t%s\n" "$W" "$START" "$END" "$FILES" >> "${ROOT}/briefs/run-log.tsv"
echo "WAVE ${W} DONE in $((END-START))s — ${FILES} files"
ls "$DIR"
