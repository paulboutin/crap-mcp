#!/usr/bin/env bash
set -euo pipefail
data="$HOME/.local/share/crap-mcp"
url="http://127.0.0.1:47731/mcp"
script_dir=$(cd "$(dirname "$0")" && pwd -P)
mode=${1:-connect}
cd "$HOME"
for folder in "$HOME/.agents/skills" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"; do
  if [[ $mode != --check ]]; then mkdir -p "$folder"; fi
  for skill in "$script_dir"/../.agents/skills/crap-*; do
    source="$data/current/.agents/skills/${skill##*/}"
    dest="$folder/${source##*/}"
    if [[ -L "$dest" && $(readlink "$dest") == "$source" ]]; then continue; fi
    if [[ -e "$dest" || -L "$dest" ]]; then echo "Existing skill at $dest" >&2; exit 1; fi
    if [[ $mode != --check ]]; then ln -s "$source" "$dest"; fi
  done
done

if command -v codex >/dev/null; then
  if config=$(codex mcp get crap_score --json 2>/dev/null); then
    node -e 'if(JSON.parse(process.argv[1]).transport.url!==process.argv[2]) throw Error("Existing Codex crap_score URL differs")' "$config" "$url"
  elif [[ $mode != --check ]]; then
    codex mcp add crap_score --url "$url"
  fi
fi
if command -v claude >/dev/null; then
  if config=$(claude mcp get crap_score 2>/dev/null); then
    if ! grep -Fxq "  URL: $url" <<< "$config"; then echo "Check existing Claude Code crap_score connection" >&2; exit 1; fi
  elif [[ $mode != --check ]]; then
    claude mcp add --transport http --scope user crap_score "$url"
  fi
fi
if command -v opencode >/dev/null; then
  # Newer clients have a noninteractive global add; 1.x uses a JSONC entry.
  help=$(opencode mcp add --help 2>&1)
  if [[ $help == *--global* ]]; then
    if [[ $mode != --check ]]; then opencode mcp add crap_score --global --url "$url"; fi
  else
    node "$script_dir/opencode-config.mjs" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode" "$url" "$mode"
  fi
fi
