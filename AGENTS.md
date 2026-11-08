# Working on crap-mcp

Use this server on its own source. In a fresh checkout run `npm ci && npm run build` first.
Before editing, save the current scan's snapshot ID (especially in a dirty worktree).
The development review, backlog triage, application security and accessibility review skills are in .agents/skills/.

Run `npm run check` before finishing. It lints with every generic vendored anti-slop rule,
builds TypeScript, records designated-suite coverage, and launches the built server over
stdio to inspect, scan and review itself. Set CRAP_BASE to your starting commit for the
CLI gate; use review_changes with the saved snapshot for existing uncommitted changes.
Keep missing evidence explicit. Do not weaken the risk thresholds to make CI pass.

End each coding session by calling review_changes with the starting snapshot and
format="markdown". Include its session score or unrated reason, evidence counts and
a representative before/after CRAP score in the user-visible reply. If MCP is
unavailable in the host, run npm run summary -- --markdown --snapshot <id> instead.
