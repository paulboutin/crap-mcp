---
name: crap-security-review
description: Review application source with the CRAP Score MCP server's independent OWASP-mapped security checks. Use for a security baseline, patch comparison, dashboard report, or chat scorecard.
---

If the installed macOS service is offline, run `bash ~/.local/share/crap-mcp/current/scripts/ensure-service.sh` and retry. On the machine service, call `register_project` with the absolute Git checkout root and use the returned `project` on every call. For a stdio connection verify the bound checkout and omit `project`. Read the machine's `get_project_settings` for enabled security rules and omissions. Do not change the policy to improve a score.

Before editing, call `scan_application_security` and retain its `snapshot` (a security snapshot, distinct from a CRAP snapshot). Page findings and skipped files using the returned snapshot. For each significant match, inspect the reported file and line, trace inputs or configuration, and distinguish a review candidate from a confirmed vulnerability. Treat unassessed files and unmapped OWASP categories as gaps.

For a patch, call `review_application_security` with the starting `snapshot`, or with a Git `base` if evaluating an existing change. For subsequent data pages pin `current` to the first result's snapshot; page introduced and resolved findings separately. An incomplete comparison does not establish a fix. If rules or scope changed, start a fresh baseline. Verify actual fixes with focused behavior tests.

Finish with `review_application_security` in `format:"markdown"`, or use that format on `scan_application_security` for a standalone assessment. Use the returned Markdown card directly in the final reply, outside a code fence. Keep its score or unrated reason, evidence, and Detailed report link. It also reads as plain text if the client has limited formatting. Set `scorecard:true` only when the user asks for a PNG or image export. Link the matching machine dashboard at `http://127.0.0.1:47731/?project=<id>&securitySnapshot=<starting-snapshot>`.

For a material finding, identify the snapshot and affected lines, explain the observed trigger and possible impact, and describe the repair and verification in the report.
