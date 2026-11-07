# CRAP Score MCP

Find functions that combine complex control flow with thin test coverage. This local stdio MCP server scans TypeScript, TSX and Swift, keeps a backlog across Git worktrees, and reviews what changed during a task. No account, API key or hosted service is needed for analysis.

## Try it on this repository

Requires Git and Node.js 24.12+ (CI runs Node 24). From the clone root:

```sh
git clone https://github.com/paulboutin/crap-mcp.git
cd crap-mcp
npm ci
npm run check
```

The last step runs Oxlint, builds the server, records coverage from passing tests, then launches the compiled server as a child process. An MCP client lists its tools, inspects the scoring function, pages through the backlog, and reviews the diff. Set `CRAP_BASE` to a starting revision to review a longer change. CI uses the push or PR base. The gate rejects skipped source, stale/missing evidence and all CRAP, complexity and nesting hotspots. Single-line callbacks can remain unscored when line counts cannot isolate their execution.

## Install once for all your projects (macOS)

From one copy of this repository, run `npm run install:machine`. You need Node.js 24.12+, npm, Git, Python 3 and the Codex CLI. The installer builds a private runtime under `~/.local/share/crap-mcp`, starts one per-user launchd service at login, registers its HTTP MCP endpoint in Codex, and links both CRAP skills into `~/.agents/skills`. Rerun the installer from an updated checkout to upgrade. Target projects need no copy of this server, dependencies or Codex config. If a project has an old project-local `crap_score` stdio override, remove that override to use the machine connection.

Open a new Codex chat in a trusted Git checkout and ask **“Use $crap-development-review on this change”** or **“Use $crap-backlog-triage in this project.”** The skill calls `register_project` with the checkout path. Registration returns a stable ID for that path. Every subsequent analysis call supplies that ID, so concurrent chats and linked worktrees keep separate targets. The picker at [the local dashboard](http://127.0.0.1:47731/) lists the registered checkout paths and loads the selected project's current report. Reload to discover newly registered projects. For a task comparison, open `/?project=<id>&snapshot=<starting-snapshot>`.

Structural findings work immediately for TypeScript, TSX and Swift. For numeric CRAP scores, configure each project's coverage command and record its passing suite (below). The installed recorder is at `~/.local/share/crap-mcp/current/dist/record.js`. Registering a project writes its path to the local catalog and saves analysis under its Git directory. The machine service listens only on loopback and is intended for a trusted single-user workstation. Local processes can access registered reports and register checkouts. The browser cannot register a project through the picker.

For other platforms or development, run `npm ci && npm run machine` in one server checkout, then run `codex mcp add crap_score --url http://127.0.0.1:47731/mcp` and install the two skill folders in your user skills directory. The foreground service uses the same catalog and API. `CRAP_PORT` and `CRAP_DATA_DIR` override the foreground defaults.

## Export a single-project offline report

After running the suite, run `npm run dashboard` and open **.crap-local/dashboard.html** in a browser. The file works offline. Search functions by name or path, filter for hotspots or missing evidence, and expand a function for its uncovered lines and findings. The report includes the suite and snapshot, skipped files, and the diff against HEAD. For another checkout, use `npm run dashboard -- /absolute/path/to/repo`; set `CRAP_BASE` to compare with a different revision. Each successful CI run attaches this repo’s HTML report as the **repository-health** artifact. A generated report is a snapshot: rerun the command after code or coverage changes.

## See the session review in chat

Before editing, keep the worktree snapshot ID from `scan_repository_hotspots`. At completion the project instructions and development-review skill ask the agent to call `review_changes` with `{"snapshot":"<start-id>","format":"chat"}` and relay the result in the current conversation. The MCP server returns tool results to its caller; it does not send unsolicited messages into a chat. From the shell, `npm run summary -- --snapshot <start-id>` prints the same result. Use `--base <revision>` for a commit comparison. Pass `CRAP_SNAPSHOT=<start-id> npm run dashboard` to display that same session in the dashboard. Without a starting snapshot or revision override, a clean comparison with HEAD has no work to rate.

**Session health (/10, higher is better)** grades the final state of assessed functions affected by source or comparable score changes. Each function gets 2.5 points for CRAP ≤ 30, 2.5 for complexity < 10, 2.5 for nesting < 4, and up to 2.5 proportional to measured line coverage. Functions have equal weight. The displayed score truncates to one decimal. Missing evidence yields a provisional range when some functions are scored; entirely unscored, incomplete, unchanged or deletion-only reviews get no numeric grade. Removed functions are counted separately. This is a local review rubric, not CodeScene's proprietary Code Health score or a correctness guarantee.

**Raw CRAP (lower is better)** stays available per function. The dashboard shows repository-wide median and maximum measured CRAP, plus example before/after scores for the patch. The chat returns up to three examples ranked by absolute comparable change, then current risk. Run the designated suite to refresh evidence and report test results separately.

## Reproduce the end-to-end proof

Run `npm run prove`. This creates a temporary Git repository, starts the compiled server over stdio, and runs actual Node tests. It compares each measured score with an independent calculation from the raw LCOV line counts. The first test exercises one HTTP status. Expanding the suite covers ten statuses and a fallback without changing the function. A deliberately wrong 401 result must fail the suite, and the server must continue withholding a score. Finally a table lookup must pass the same assertions and resolve both original findings. CI runs this experiment on every change.

## Connect an agent

The machine install above is the usual Codex setup. For a host that only supports stdio, build once and configure the **built server** and **target Git checkout** explicitly:

```json
{
  "mcpServers": {
    "crap_score": {
      "command": "node",
      "args": ["/absolute/path/to/crap-mcp/dist/server.js", "/absolute/path/to/target"]
    }
  }
}
```

For Codex use the equivalent `[mcp_servers.crap_score]` table in the target's `.codex/config.toml` ([OpenAI MCP documentation](https://developers.openai.com/codex/mcp)). Copy the two skill directories into that project's `.agents/skills/` or the chosen agent's skills directory. For a smoke test here, inspect `src/coverage.ts`, symbol `score`, then call `review_changes` with `{"base":"HEAD"}`. A clean checkout should have no affected functions.

| Tool | Example arguments | Result |
| --- | --- | --- |
| `analyze_function_health` | `{"file":"src/coverage.ts","symbol":"score"}` | Qualified symbol and line range, complexity, nesting, measured/uncovered lines, score, findings and checks. Use a one-based `line` instead of a name to select the innermost function. |
| `scan_repository_hotspots` | `{"rule":"crap","priority":"churn","limit":10}` | Ranked items, scan progress, skips, snapshot and pagination. Filter by path prefix, rule or coverage (including `unscored`). Order by score, critical paths or file commits over 90 days. |
| `get_repository_report` | `{"limit":100}` | All assessed functions, including acceptable and unscored ones. Pass the first snapshot ID on subsequent pages. The reporting dashboard uses this tool. |
| `review_changes` | `{"snapshot":"<starting snapshot id>","findingId":"<optional selected id>"}` | New, worsened, resolved, unknown, improved and pre-existing findings for affected symbols, with before/after evidence. Use `base` for a Git revision instead of a saved snapshot. |

Capture a worktree snapshot before editing if uncommitted changes exist. A review compares the final working source (including nonignored, untracked files) against that starting state. An unchanged selected finding can also be followed through a test-only edit. Pages use zero-based `offset` and `limit` (1–100); follow each collection's `nextOffset`. A scan starts at launch, rechecks inputs on query, and accepts `{"refresh":true}` for a background refresh. Findings include the rule, evidence, suggested action and completion check.

## Produce comparable coverage

In the target root create `.crap.json`. For example, for a Jest project:

```json
{
  "suite": "unit",
  "command": ["npm", "run", "test:coverage"],
  "integrationBranch": "main",
  "exclude": ["vendor/", "test/"],
  "criticalPaths": ["src/payments/"]
}
```

Run the recorder **from the target root**, wrapping the suite that creates the report:

```sh
node /absolute/path/to/crap-mcp/dist/record.js coverage/lcov.info -- npm run test:coverage
```

The command and arguments must match configuration exactly. Keep generated reports and build outputs gitignored. Restart the server after changing configuration. MCP requests never run tests. A CI job, file watcher or developer runs the recorder separately.

Supported inputs are LCOV with `DA` records, Istanbul/Jest `coverage-final.json` with statement locations and counters, and Xcode `.xcresult` bundles with detailed archive line counts (macOS with `xcrun xccov`). For Xcode, wrap the project's coverage-enabled `xcodebuild test` command and pass its fresh `-resultBundlePath` as the report. A bundle containing only test-target coverage cannot score a missing library target. Use the original checkout paths, not a report copied from a different machine. Summary percentages alone are insufficient.

A passing run must produce a new report and the same source fingerprint before and after. The receipt records the designated suite, run ID, timestamp, source fingerprint and line counts. Inputs include supported source and test files, JS/JSON configuration, lockfiles and Swift package manifests. This is local evidence, not a hermetic build attestation: ignore generated outputs, include meaningful test inputs in version control, and rerun after environment or external-fixture changes. Targeted assertions can verify behavior without updating the comparable score.

## What the numbers mean

`CRAP = complexity² × (1 − covered / executable)³ + complexity`. Up to 30 is acceptable, above 30 through 60 is high, above 60 is critical. A function with complexity 16 and 12/24 lines covered scores 48. The server keeps the raw fraction for classification. Missing, stale, differently designated or insufficient evidence produces a null score.

Tree-sitter WASM grammars locate implementations, methods and closures. Complexity starts at one; conditional branches, loops, catches, non-default switch cases, ternaries and supported short-circuit expressions add paths. Nested function decisions belong to the nested function. Complexity ≥10 and nesting ≥4 are separate structural findings, available without coverage. Nesting evidence identifies the deepest line. Counts are a documented syntax heuristic, not proof of behavior. The supported grammars can lag new language syntax; parse failures appear under skipped files. Stable IDs follow a file, qualified symbol and rule through line shifts. Renames and reordered anonymous/overloaded siblings can change identity.

The denominator uses the producer's measured lines within the function, excluding nested function ranges. Multiple hits for a line count once. For a one-line callback sharing a line, LCOV can supply an independent function execution counter (`FN` + `FNDA`). The recorder requires a measured line, a unique parsed function and one uniquely matched counter at that start line. Zero calls mean 0/1 lines covered, even when the enclosing line ran. Without a unique match the callback remains unscored; line hits alone cannot establish callback execution. Multi-line percentages are never inferred from entry counts. Different instrumentation can disagree; only compare designated-suite results under the same policy.

## Local backlog and optional GitHub issues

Working receipts and last scans are stored in the worktree Git directory. Immutable task snapshots and clean commit scans live under the common Git directory so linked worktrees can share them. Use `view:"integration"` to see the configured baseline. It identifies the target commit and whether the scan is confirmed, last-confirmed, or reconstructed from Git without coverage. Working fixes stay provisional. Skipped files cannot prove a resolution. Historical scans are local and are not uploaded or automatically pruned.

Scanning alone never creates tickets. To opt in, install and authenticate the GitHub CLI, scan a clean integration checkout, then explicitly publish one selected finding:

```sh
node /absolute/path/to/crap-mcp/dist/issue-cli.js publish OWNER/REPO FINDING_ID
```

The local SQLite link records the GitHub project, issue number and stable finding ID. Re-publishing updates the same managed issue. The finding marker makes interrupted creation recoverable. Future clean integration scans reconcile already-linked issues in the background. Only a complete descendant baseline can close them; an unavailable score keeps a scored issue open. Use plain PR references like `#17` to avoid GitHub auto-close. To retry after going offline, run the same CLI with `sync`. GitHub.com is the supported provider. The test suite exercises issue creation, deduplication and closure against an in-process provider; it never contacts a real tracker.

## Repository lint policy

All 18 generic [anti-slop](tools/oxlint/anti-slop/UPSTREAM.md) rules and Oxlint's native accumulating-spread check run as errors on owned code. The plugin, its upstream notices and its embedded Stylistic license are vendored. `npm run lint` is a separate gate from the metric backlog: a style violation does not alter cyclomatic complexity or the CRAP formula. The self-scan covers production TypeScript; tests and vendored third-party rules are excluded from the production backlog.
