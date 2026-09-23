#!/usr/bin/env bash
# Log Sift's memory while it runs, without pausing it.
#
# Usage: tool/memwatch.sh [interval_seconds]   (default 5)
# Output: logs/sift-mem.log, one line per sample: time, current memory, peak seen.
#
# Uses `top` (MEM = physical footprint, what Activity Monitor shows). Do not use
# `vmmap` in a loop: it suspends the target process for ~0.8 s per sample, which
# shows up as UI hitches in the profile log. `ps -o rss` over-reports on macOS.
set -euo pipefail

interval="${1:-5}"
out="logs/sift-mem.log"
mkdir -p logs

pid=""
echo "[memwatch] waiting for target/release/sift ..."
until pid=$(pgrep -f 'target/release/sift' | head -1) && [ -n "$pid" ]; do
  sleep 1
done
echo "[memwatch] pid $pid → $out"
echo "# $(date '+%F %T') pid=$pid source=top" >> "$out"

to_mb() {
  # top prints e.g. 812M, 1.2G, 640K
  awk -v v="$1" 'BEGIN {
    n = v + 0; u = substr(v, length(v), 1)
    if (u == "G") n *= 1024; else if (u == "K") n /= 1024
    printf "%.0f", n
  }'
}

peak=0
while kill -0 "$pid" 2>/dev/null; do
  mem=$(top -l 1 -pid "$pid" -stats mem 2>/dev/null | tail -1 | tr -d ' +-' || true)
  if [ -n "$mem" ]; then
    mb=$(to_mb "$mem")
    [ "$mb" -gt "$peak" ] && peak=$mb
    line="$(date +%T) mem=${mb}MB peak=${peak}MB"
  else
    line="$(date +%T) top failed"
  fi
  echo "$line" >> "$out"
  echo "$line"
  sleep "$interval"
done
echo "[memwatch] sift exited, peak ${peak}MB"
