# Working on crap-mcp

Use this server on its own source. In a fresh checkout run `npm ci && npm run build` first.
Before editing, save the current scan's snapshot ID (especially in a dirty worktree).
The development-review and backlog-triage skills are in .agents/skills/.

Run `npm run check` before finishing. It lints with every generic vendored anti-slop rule,
builds TypeScript, records designated-suite coverage, and launches the built server over
stdio to inspect, scan and review itself. Set CRAP_BASE to your starting commit for the
CLI gate; use review_changes with the saved snapshot for existing uncommitted changes.
Keep missing evidence explicit. Do not weaken the risk thresholds to make CI pass.
