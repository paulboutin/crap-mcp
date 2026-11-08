---
name: crap-security-review
description: Review application source with the CRAP Score MCP server's independent OWASP-mapped security checks. Use for a security baseline, patch comparison, dashboard report, or chat scorecard.
---

If the installed macOS service is offline, run `bash ~/.local/share/crap-mcp/current/scripts/ensure-service.sh` and retry. On the machine service, call `register_project` with the absolute Git checkout root and use the returned `project` on every call. For a stdio connection verify the bound checkout and omit `project`. Read the machine's `get_project_settings` for enabled security rules and omissions. Do not change the policy to improve a score.

Before editing, call `scan_application_security` and retain its `snapshot` (a security snapshot, distinct from a CRAP snapshot). Page findings and skipped files using the returned snapshot. For each significant match, inspect the reported file and line, trace inputs or configuration, and distinguish a review candidate from a confirmed vulnerability. Treat unassessed files and unmapped OWASP categories as gaps.

For a patch, call `review_application_security` with the starting `snapshot`, or with a Git `base` if evaluating an existing change. For subsequent data pages pin `current` to the first result's snapshot; page introduced and resolved findings separately. An incomplete comparison does not establish a fix. If rules or scope changed, start a fresh baseline. Verify actual fixes with focused behavior tests.

Finish with the same review in `format:"chat", scorecard:true`; for a standalone assessment use those options on `scan_application_security`. Relay the security score or unrated reason, assessed and skipped counts, and material findings and fixes. Display the returned PNG (in Codex desktop use the absolute path following `Scorecard:`); text clients can show the text card. On the machine service link `http://127.0.0.1:47731/?project=<project>&securitySnapshot=<starting-security-snapshot>` for the matching comparison. The local score is separate from CRAP, not an OWASP grade or proof of security.

Link the HTML path after `Detailed report:` alongside the scorecard. For a material finding, identify the snapshot and affected lines, explain the observed trigger and possible impact, and describe the repair and verification in the report.
