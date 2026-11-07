---
name: crap-backlog-triage
description: Use a connected CRAP Score MCP server to choose a repository maintenance task from coverage, complexity and nesting evidence.
---
Before connecting, run `bash ~/.local/share/crap-mcp/current/scripts/ensure-service.sh`. It checks the local service and starts the installed launch agent if necessary. For a foreground installation, probe its configured /health endpoint and start the documented machine command if offline. Retry the MCP connection after it becomes healthy.

On the machine service call `register_project` with the absolute output of `git rev-parse --show-toplevel` from the active checkout. Use the returned ID as `project` on every analysis call, including pagination and the final review. The project picker at http://127.0.0.1:47731/ lists registered checkouts. If only the legacy stdio tools are available, verify their configured checkout before use.

Read `get_project_settings` for this checkout. Match the task's extensions to its language catalog. Before the baseline, use `set_project_language({project, language, enabled:true, revision})` for any needed optional language. This updates the same settings shown in the dashboard. Enable an installed native linter with `linter:true` when requested. Re-read and merge on a revision conflict.

Run `node ~/.local/share/crap-mcp/current/dist/project-check.js "triage baseline"` from the target checkout. Include additional repository-required checks as needed. When coverage is unconfigured, run the normal tests and report missing scores. Consult recent outcomes in `get_project_settings` to identify recurring failures and successful fixes from comparable runs. Cite the suite, policy and observed evidence behind the selected task.

Call scan_repository_hotspots; inspect completeness, skipped files, suite and commit. Use view=integration for the shared baseline, or the worktree view for local changes. Page by nextOffset. Start with score order. If requested, prioritize churn (file-level changes over 90 days) or critical paths. Query coverage=unscored separately so missing evidence remains visible.

Inspect a candidate with analyze_function_health. Cite its location, observed trigger and completion check; line coverage alone doesn't identify a missing behavior. Carry its finding ID and the worktree snapshot into development review. Only publish a selected issue when asked, using the explicit CLI in the README. Use a plain issue reference in a PR so the integration scan controls closure.
