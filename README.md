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

## Connect an agent

This checkout includes a project-scoped Codex configuration and development-review and backlog-triage skills under [.agents/skills](.agents/skills). Build first, then start your MCP host in the trusted project root. In another repository, configure a stdio server with the absolute path to the **built server** and the **target Git checkout**:

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

The denominator uses the producer's measured lines within the function, excluding nested function ranges. Multiple hits for a line count once. One-line callback arguments with no separable lines remain unscored. Different instrumentation can disagree; only compare designated-suite results under the same policy.

## Local backlog and optional GitHub issues

Working receipts and last scans are stored in the worktree Git directory. Immutable task snapshots and clean commit scans live under the common Git directory so linked worktrees can share them. Use `view:"integration"` to see the configured baseline. It identifies the target commit and whether the scan is confirmed, last-confirmed, or reconstructed from Git without coverage. Working fixes stay provisional. Skipped files cannot prove a resolution. Historical scans are local and are not uploaded or automatically pruned.

Scanning alone never creates tickets. To opt in, install and authenticate the GitHub CLI, scan a clean integration checkout, then explicitly publish one selected finding:

```sh
node /absolute/path/to/crap-mcp/dist/issue-cli.js publish OWNER/REPO FINDING_ID
```

The local SQLite link records the GitHub project, issue number and stable finding ID. Re-publishing updates the same managed issue. The finding marker makes interrupted creation recoverable. Future clean integration scans reconcile already-linked issues in the background. Only a complete descendant baseline can close them; an unavailable score keeps a scored issue open. Use plain PR references like `#17` to avoid GitHub auto-close. To retry after going offline, run the same CLI with `sync`. GitHub.com is the supported provider. The test suite exercises issue creation, deduplication and closure against an in-process provider; it never contacts a real tracker.

## Repository lint policy

All 18 generic [anti-slop](tools/oxlint/anti-slop/UPSTREAM.md) rules and Oxlint's native accumulating-spread check run as errors on owned code. The plugin, its upstream notices and its embedded Stylistic license are vendored. `npm run lint` is a separate gate from the metric backlog: a style violation does not alter cyclomatic complexity or the CRAP formula. The self-scan covers production TypeScript; tests and vendored third-party rules are excluded from the production backlog.
