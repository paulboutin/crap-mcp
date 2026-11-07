---
name: crap-development-review
description: Use a connected CRAP Score MCP server to review a TypeScript or Swift patch, especially when changes begin in a dirty worktree or target an existing finding.
---
On the machine service call `register_project` with the absolute output of `git rev-parse --show-toplevel` from the active checkout. Use the returned ID as `project` on every analysis call, including pagination and the final review. The project picker at http://127.0.0.1:47731/ lists registered checkouts. If only the legacy stdio tools are available, verify their configured checkout before use.

Call scan_repository_hotspots before editing and retain snapshot.id. It includes tracked and nonignored untracked source; HEAD alone cannot distinguish another person's pending edits. Inspect functions overlapping the task with analyze_function_health. Retain the finding ID if fixing a backlog item.

After editing, run the relevant behavior tests outside MCP. For comparable scores, use the repository's designated coverage command through the recorder. Call review_changes with the saved snapshot and optional findingId. Page through findings and affected symbols separately using offset and limit. Address regressions attributable to the task. Report unresolved findings, skipped files, unavailable scores and behavior checks separately. Worktree resolution is provisional until the integrated revision is rescanned.

At completion call review_changes again with the same starting snapshot and format="chat".
Include its session rating, measured/affected counts, and a representative raw CRAP before → after in the visible chat reply, alongside actual test results. If the result is partial, unchanged or unrated, report it that way. When using the machine service, link the matching session dashboard at http://127.0.0.1:47731/?project=<id>&snapshot=<start-id>. A standalone server cannot post into an idle chat.
