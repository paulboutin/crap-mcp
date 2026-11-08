---
name: crap-accessibility-review
description: Use the CRAP Score MCP server to assess accessibility source checks against WCAG and Revised Section 508, check text contrast and colorblind accessibility, compare a patch, and show the accessibility dashboard and chat card.
---

On the machine service, register the absolute Git checkout using `register_project` and pass its `project` ID on each call. On a stdio connection verify the configured checkout and omit `project`. Read machine project settings for the enabled rules and directory omissions.

Before edits, call `scan_application_accessibility` and retain its accessibility snapshot ID. Page the findings, pending manual checks and skipped files with this snapshot. Read affected source at the reported line. Distinguish literal failures from dynamic names, hidden state and other behavior that requires a running app. Where available, verify representative flows with the keyboard, zoom and a screen reader. Record what was actually tested.

Inspect the `colors` pages for the foreground, background, unrounded threshold result and simulated ratios. Report the independent colorblind score, its measured pair count and unresolved colors. Use `analyze_accessibility_color_pair` for colors sampled from an actual interface. Review configured status/chart pairs and verify that meaning also has a text, icon or pattern cue.

After edits call `review_application_accessibility` with the starting accessibility `snapshot`, or use `base` to compare an existing patch with a Git ref. Pin `current` to the first result’s snapshot when paging a review. A policy change requires a new baseline. Report the measured denominator and pending checks alongside the score. WCAG 2.2 findings identify whether the criterion is incorporated by Revised Section 508. The score describes only the enabled source checks.

Finish with `review_application_accessibility` in `format:"markdown"`, or use that format on `scan_application_accessibility` for a standalone assessment. Paste the returned score heading and tables directly into the final reply, outside a code fence. Preserve their rows, column labels, and alignment. Put any interpretation after the card. Keep its score or unrated reason, evidence, and Detailed report link. It also reads as plain text if the client has limited formatting. Set `scorecard:true` only when the user asks for a PNG or image export. Link the matching machine dashboard at `http://127.0.0.1:47731/?project=<id>&accessibilitySnapshot=<starting-snapshot>`.

For a material finding, identify the snapshot and affected lines, explain the observed trigger and possible impact, and describe the repair and verification in the report.
