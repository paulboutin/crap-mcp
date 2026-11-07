#!/usr/bin/env bash
set -euo pipefail
health="http://127.0.0.1:${CRAP_PORT:-47731}/health"
healthy() { [[ $(curl -fsS --max-time 2 "$health" 2>/dev/null || true) == crap-score-mcp ]]; }
if [[ ${1:-} != --restart ]] && healthy; then exit 0; fi
label=com.crap-score.machine
domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/$label.plist"
if [[ $(uname -s) != Darwin || ! -f "$plist" ]]; then
  echo "No installed login service. Run npm run install:machine on macOS or npm run machine from the server checkout." >&2
  exit 1
fi
# launchd can briefly reject bootstrap while a previous job is unloading.
for ((i=0;i<40;i++)); do
  if launchctl print "$domain/$label" >/dev/null 2>&1; then break; fi
  if launchctl bootstrap "$domain" "$plist" 2>/dev/null; then break; fi
  sleep .25
done
if [[ ${1:-} == --restart ]]; then
  launchctl kickstart -k "$domain/$label"
else
  launchctl kickstart "$domain/$label"
fi
for ((i=0;i<60;i++)); do if healthy; then exit 0; fi; sleep .25; done
echo "Service did not become healthy. See ~/.local/share/crap-mcp/service.log" >&2
exit 1
