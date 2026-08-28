#!/bin/bash
# Wait for a wave's children to appear and then finish.
# The PARENT going idle is a false completion signal - it dispatches and then sits idle
# while children run. Archived rows are stale children from an earlier run and are ignored
# because they never carry status 'working'.
W="$1"; MAXSPAWN=${2:-900}
started=0
for ((i=0; i<MAXSPAWN/5; i++)); do
  if prime-agent list 2>/dev/null | grep -qE "^wave${W}-[^ ]+ +[a-f0-9]+ +working"; then started=1; break; fi
  sleep 5
done
if [ "$started" = 0 ]; then echo "ERROR: no wave${W} child ever reached 'working' within ${MAXSPAWN}s"; exit 2; fi
while prime-agent list 2>/dev/null | grep -qE "^wave${W}-[^ ]+ +[a-f0-9]+ +working"; do sleep 20; done
echo "WAVE ${W} CHILDREN SETTLED"
