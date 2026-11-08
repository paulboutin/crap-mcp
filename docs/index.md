# Start with an agent skill

Choose the job you want your coding agent to do. A skill selects the MCP tools, captures the evidence from your checkout, and helps you interpret the result. [Install the server and skills](getting-started.md) once, then open your project in Codex, Claude Code, or OpenCode.

<div class="grid cards" markdown>

-   **[Review a code change](skills/development-review.md)**

    Ask for a baseline before editing and a review when the patch is ready. See per-function **CRAP** and the patch’s **session health** grade.

    `Use $crap-development-review to review my patch.`

-   **[Review application security](skills/security-review.md)**

    Find OWASP-mapped source patterns such as interpolated SQL or disabled TLS verification. Get an **application security** score and a finding report.

    `Use $crap-security-review to assess this checkout.`

-   **[Review accessibility and color](skills/accessibility-review.md)**

    Check WCAG and Section 508 mappings, text contrast, and simulated color vision. Get separate **accessibility** and **colorblind** scores.

    `Use $crap-accessibility-review to check this UI.`

-   **[Choose a maintenance task](skills/backlog-triage.md)**

    Rank hotspots, inspect coverage gaps and pick a function with a concrete completion check. Triage uses the existing function measurements.

    `Use $crap-backlog-triage to pick one cleanup.`

</div>

These prompts use Codex syntax. In Claude Code, invoke the same skill with a slash, such as `/crap-security-review`. In OpenCode, ask “Use the crap-security-review skill on this checkout.”

## Understand a result

| Score | What it answers |
| --- | --- |
| [Function CRAP](scores/function-crap.md) | How risky is this function to change given its complexity and measured coverage? |
| [Session health](scores/session-health.md) | How did the functions affected by this patch score on the four code-quality measures? |
| [Application security](scores/security.md) | Which enabled security patterns did the source scan find, and how much did each affect the score? |
| [Accessibility](scores/accessibility.md) | How many evaluated source checks passed, and what still requires a person to check the running interface? |
| [Colorblind score](scores/colorblind.md) | Which color pairs retained enough contrast under all three color vision simulations? |

The three review skills can return a chat card and a local HTML report. Open a finding to see its lines, scoring effect, possible impact, repair, and verification step. [Walk through a finding](findings.md).
