# MCP tool reference

Use the [agent skills](index.md) for a normal review. For a custom client or script, register the checkout once with `register_project` using its absolute Git root. Include the returned project ID as `project` with each machine-service example below. A stdio server is bound to its checkout and omits that argument.

## Analysis tools

| Tool | Example arguments | Result |
| --- | --- | --- |
| `analyze_function_health` | `{"file":"src/coverage.ts","symbol":"score"}` | Qualified symbol and line range, complexity, nesting, measured/uncovered lines, score, findings and checks. Use a one-based `line` instead of a name to select the innermost function. |
| `scan_repository_hotspots` | `{"rule":"crap","priority":"churn","limit":10}` | Ranked items, scan progress, skips, snapshot and pagination. Filter by path prefix, rule or coverage (including `unscored`). Order by score, critical paths or file commits over 90 days. |
| `get_repository_report` | `{"limit":100}` | All assessed functions, including acceptable and unscored ones. Pass the first snapshot ID on subsequent pages. The reporting dashboard uses this tool. |
| `scan_application_security` | `{"limit":20}` | Independent security score, enabled rule catalog, findings and skipped files. Save the security snapshot for a comparison. |
| `review_application_security` | `{"snapshot":"<security snapshot>","format":"chat","scorecard":true}` | Before/after security score, evidence counts, an HTML finding report and a separate PNG card. Use data format for finding changes. |
| `scan_application_accessibility` | `{"limit":20}` | Accessibility and colorblind scores, findings, passed checks, pending checks, color pairs and skipped files. Save the accessibility snapshot to page through the evidence. |
| `review_application_accessibility` | `{"snapshot":"<accessibility snapshot>","format":"chat","scorecard":true}` | Score changes, evidence counts, an HTML finding report and a PNG card. Data format includes introduced and resolved findings and baseline color pairs. |
| `analyze_accessibility_color_pair` | `{"foreground":"#f00","background":"#000","usage":"text"}` | Ordinary contrast, the target, three simulated ratios and the pair’s colorblind score. Use `large-text` for large text or `ui-boundary` for a meaningful boundary. |
| `review_changes` | `{"snapshot":"<starting snapshot id>","findingId":"<optional selected id>"}` | New, worsened, resolved, unknown, improved and pre-existing findings for affected symbols, with before/after evidence. Use `base` for a Git revision instead of a saved snapshot. |

Capture a worktree snapshot before editing if uncommitted changes exist. A review compares the final working source (including nonignored, untracked files) against that starting state. An unchanged selected finding can also be followed through a test-only edit. Pages use zero-based `offset` and `limit` (1–100); follow each collection's `nextOffset`. A scan starts at launch, rechecks inputs on query, and accepts `{"refresh":true}` for a background refresh. Findings include the rule, evidence, suggested action and completion check.

## Machine-service project tools

| Tool | Purpose |
| --- | --- |
| `register_project` | Register the local checkout and return its project ID. |
| `list_projects` | Find registered checkouts and their IDs. |
| `get_project_settings` | Read the current policy, language settings, rules and recent checks. |
| `set_project_language` | Enable or disable a language pack and its optional native linter. |
| `update_project_settings` | Save revised settings using the current settings revision and a reason. |
| `record_project_learning` | Record a finding and lesson using before/after check evidence. |

Security, accessibility and CRAP use distinct snapshot IDs. Pass each starting snapshot back to its own review tool. Security and accessibility reviews also accept a pinned `current` snapshot for stable pagination.
