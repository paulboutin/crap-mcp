# Development review

Use this skill when you know which code you are changing. It captures a baseline before the edit so an already-dirty worktree can be reviewed accurately.

```text
Use $crap-development-review to baseline my checkout, review my changes,
and show the session scorecard with one function’s before-and-after CRAP.
```

The agent checks the project’s language settings, saves a scan, and runs the designated checks. For a cleanup, it can compare configured QA replays or benchmark workloads on both sides. Tell it which behavior the change should preserve.

The final report shows [session health](../scores/session-health.md), counts of measured and affected functions, and representative [function CRAP](../scores/function-crap.md) changes. Open a changed function to see coverage and the lines behind the result. When there are no surviving changed functions, the report explains why there is no session grade.
