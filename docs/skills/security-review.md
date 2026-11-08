# Security review

Use this skill to inspect an existing checkout or compare a change against an application security baseline.

```text
Use $crap-security-review to scan this checkout. Show which OWASP rules
matched, the affected lines, and what I should trace to verify each risk.
```

For a patch, run the skill before editing and ask it to retain the **security snapshot**. After editing, ask it to compare against that snapshot. It reports the [application security score](../scores/security.md), assessed and skipped files, and any introduced or resolved matches.

For an interpolated SQL query, read the substitutions and trace who controls them. The report gives the location and explains the potential effect. Check how the actual database driver binds parameters, then exercise the repaired query with input containing quotes. [Read a finding](../findings.md).
