# Accessibility review

Use this skill for UI source, text contrast and color-coded states. One review produces two separate scores.

```text
Use $crap-accessibility-review to check this UI. Show the accessibility
and colorblind scores, failed contrast pairs, and what needs manual testing.
```

The agent records an accessibility snapshot and inspects each failure or pending result. For a patch, ask it to compare the final checkout with the starting snapshot. In the report, open an element for its WCAG criterion, Section 508 mapping, affected lines and verification step.

Ask the agent to check a specific rendered color pair, or add named status and chart pairs in project settings. The [accessibility score](../scores/accessibility.md) counts known source outcomes. The [colorblind score](../scores/colorblind.md) counts measured pairs meeting the target in three simulations. A keyboard, screen reader or rendered inspection supplies evidence the source scanner cannot capture.
