---
name: crap-backlog-triage
description: Use a connected CRAP Score MCP server to choose a repository maintenance task from coverage, complexity and nesting evidence.
---
Call scan_repository_hotspots; inspect completeness, skipped files, suite and commit. Use view=integration for the shared baseline, or the worktree view for local changes. Page by nextOffset. Start with score order. If requested, prioritize churn (file-level changes over 90 days) or critical paths. Query coverage=unscored separately so missing evidence remains visible.

Inspect a candidate with analyze_function_health. Cite its location, observed trigger and completion check; line coverage alone doesn't identify a missing behavior. Carry its finding ID and the worktree snapshot into development review. Only publish a selected issue when asked, using the explicit CLI in the README. Use a plain issue reference in a PR so the integration scan controls closure.
