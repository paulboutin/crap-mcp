---
name: crap-development-review
description: Use a connected CRAP Score MCP server to review a patch in a supported language, especially when changes begin in a dirty worktree or target an existing finding.
---
Before connecting, run `bash ~/.local/share/crap-mcp/current/scripts/ensure-service.sh`. It checks the local service and starts the installed launch agent if necessary. For a foreground installation, probe its configured /health endpoint and start the documented machine command if offline. Retry the MCP connection after it becomes healthy.

On the machine service call `register_project` with the absolute output of `git rev-parse --show-toplevel` from the active checkout. Use the returned ID as `project` on every analysis call, including pagination and the final review. The project picker at http://127.0.0.1:47731/ lists registered checkouts. If only the legacy stdio tools are available, verify their configured checkout before use.

Read `get_project_settings`. Match the task's file extensions to the language catalog. Enable a needed optional parser with `set_project_language({project, language, enabled:true, revision})` before taking the baseline. The browser uses the same settings. Enable its native linter with `linter:true` when requested and installed. On a revision conflict, read settings again and merge the intended change. Report missing packs or tools explicitly.

Read recent check outcomes to see which changes helped or failed under this project's suite and policy. Call `scan_repository_hotspots` before editing and retain `snapshot.id`. Inspect affected functions with `analyze_function_health` and keep the finding ID if fixing a backlog item.

Run `node ~/.local/share/crap-mcp/current/dist/project-check.js "what was tried"` from the target checkout to record starting evidence when needed and after each meaningful attempt. This runs the selected lint rules, configured checks and designated suite through the recorder. Capture failures as well as successes, and run any repository-required checks not included in the checker. If coverage is unconfigured, run the project's normal tests and report the missing evidence. Compare the latest history against a run with the same suite and policy. Use the actual function diff and test assertions to explain results.

Review with `review_changes` using the starting snapshot and optional finding ID. Page findings and affected symbols separately. Address regressions caused by the patch. Report skipped files, unavailable scores and behavior checks separately. Worktree results remain provisional until the integrated revision is rescanned.

At completion call review_changes again with the same starting snapshot and format="chat".
Include its session rating, measured/affected counts, and a representative raw CRAP before → after in the visible chat reply, alongside actual test results. If the result is partial, unchanged or unrated, report it that way. When using the machine service, link the matching session dashboard at http://127.0.0.1:47731/?project=<id>&snapshot=<start-id>. A standalone server cannot post into an idle chat.
