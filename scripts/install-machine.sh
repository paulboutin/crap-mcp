#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd -P)
if [[ $(uname -s) != Darwin ]]; then
  echo 'The automatic login service installer requires macOS.' >&2
  exit 1
fi
node_bin=$(command -v node)
codex_bin=$(command -v codex)
data="$HOME/.local/share/crap-mcp"
skills="$HOME/.agents/skills"
label=com.crap-score.machine
domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/$label.plist"
url=http://127.0.0.1:47731
umask 077
mkdir -p "$data/releases" "$skills" "$(dirname "$plist")"

# Check user-owned skill names and MCP configuration before replacing anything.
for source in "$repo"/.agents/skills/crap-*; do
  dest="$skills/${source##*/}"
  if [[ -e "$dest" || -L "$dest" ]]; then
    [[ $(readlink "$dest" || true) == "$data/current/.agents/skills/${source##*/}" ]] || { echo "Existing skill at $dest" >&2; exit 1; }
  fi
done
cd "$HOME"
if config=$("$codex_bin" mcp get crap_score --json 2>/dev/null); then
  node -e 'const c=JSON.parse(process.argv[1]);if(c.transport.url!==process.argv[2]) throw Error("Existing crap_score connection uses another server")' "$config" "$url/mcp"
fi
if ! launchctl print "$domain/$label" >/dev/null 2>&1 && nc -z 127.0.0.1 47731; then
  echo 'Port 47731 is already in use.' >&2
  exit 1
fi

cd "$repo"
npm ci --no-audit --no-fund
npm run build
release=$(mktemp -d "$data/releases/build.XXXXXXXX")
mkdir -p "$release/.agents"
cp -R dist dashboard languages .oxlintrc.json package.json package-lock.json "$release/"
mkdir -p "$release/tools/oxlint" "$release/scripts"
cp -R tools/oxlint/anti-slop "$release/tools/oxlint/"
cp scripts/ensure-service.sh "$release/scripts/"
cp -R .agents/skills "$release/.agents/"
(cd "$release" && npm ci --omit=dev --no-audit --no-fund)
previous=$(readlink "$data/current" || true)
switch_release() {
  "$node_bin" -e 'const fs=require("node:fs");const [target,link]=process.argv.slice(1);const tmp=link+"."+process.pid;fs.symlinkSync(target,tmp);fs.renameSync(tmp,link)' "$1" "$data/current"
}
switch_release "$release"
python3 - "$plist" "$label" "$node_bin" "$data" <<'PY'
import os, plistlib, sys
path, label, node, data = sys.argv[1:]
job = dict(Label=label, ProgramArguments=[node, data + "/current/dist/machine.js"], RunAtLoad=True, KeepAlive=True,
           EnvironmentVariables={"PATH":os.environ["PATH"]}, StandardErrorPath=data+"/service.log", StandardOutPath=data+"/service.log")
with open(path + ".new", "wb") as stream:
    plistlib.dump(job, stream)
os.replace(path + ".new", path)
PY
launchctl bootout "$domain/$label" 2>/dev/null || true
if ! bash "$release/scripts/ensure-service.sh" --restart; then
  if [[ -n "$previous" ]]; then
    switch_release "$previous"
    bash "$release/scripts/ensure-service.sh" --restart
  fi
  echo "Service did not start. See $data/service.log" >&2
  exit 1
fi
for source in "$release"/.agents/skills/crap-*; do
  dest="$skills/${source##*/}"
  if [[ ! -L "$dest" ]]; then ln -s "$data/current/.agents/skills/${source##*/}" "$dest"; fi
done
cd "$HOME"
"$codex_bin" mcp add crap_score --url "$url/mcp"
echo "Local dashboard: $url/"
