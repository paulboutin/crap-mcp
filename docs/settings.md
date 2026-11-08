# Configure a checkout

Open the [local dashboard](http://127.0.0.1:47731/), select the registered project, and open **Project settings**. The skills use these same settings. Each linked worktree has its own project identity.

| Setting | What it controls |
| --- | --- |
| Maximum CRAP and minimum coverage | Per-function project check thresholds. The standard dashboard bands and session rubric keep their documented thresholds. |
| Application security | Enabled source rules and an optional minimum security score. |
| Accessibility | Enabled rules, independent minimum accessibility and colorblind scores, and named status or chart pairs. |
| Directory omissions and language packs | Which source the checkout analyzes. Python, Go and Rust are optional structural packs. Security and accessibility have their own supported source formats. |
| Team manifest | Shares settings, rule history and recorded lessons via a checked-in `.crap-team.json`. |

Blank security or accessibility minimums record results for reporting. A measured score below a configured minimum fails the check. An unrated result leaves that gate incomplete. Pending accessibility or color evidence can also leave an otherwise passing gate incomplete.

## Supply coverage for code-quality scores

Set the designated suite, command and line-level coverage report in the target checkout’s `.crap.json`. The project checker wraps the command and records a matching receipt. Missing or stale coverage stays visible. [Coverage configuration and supported report formats](https://github.com/paulboutin/crap-mcp#produce-comparable-coverage).

For a patch, ask the skill to capture its snapshot before editing, particularly in a dirty worktree. Capture a new baseline after changing the rule set or analysis scope. Compare runs that use the same suite and policy.
