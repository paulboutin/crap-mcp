# CRAP Score MCP

Find functions that combine complex control flow with thin test coverage. One local HTTP service handles multiple checkouts. It scans TypeScript, TSX and Swift out of the box, supports optional language packs, keeps a backlog across Git worktrees, and reviews what changed during a task. No account, API key or hosted service is needed for analysis.

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

From one copy of this repository, run `npm run install:machine`. You need Node.js 24.12+, npm, Git, and Python 3. The installer detects Codex, Claude Code and OpenCode on PATH. The installer builds a private runtime under `~/.local/share/crap-mcp`, starts one per-user launchd service at login, connects detected clients to the same HTTP endpoint, and links both CRAP skills in the user skill directories. Rerun the installer from an updated checkout to upgrade. Target projects need no copy of this server, dependencies or Codex config. If a project has an old project-local `crap_score` stdio override, remove that override to use the machine connection.

Use the same two skills in each harness. In Claude Code run `/crap-development-review` or `/crap-backlog-triage`. In OpenCode ask “Use the crap-development-review skill on this checkout.” In Codex use `$crap-development-review`. The installer links one canonical copy into `~/.agents/skills` and Claude Code’s `~/.claude/skills` (or `CLAUDE_CONFIG_DIR/skills`). OpenCode also discovers the shared agents directory. If you install another client later, run `bash ~/.local/share/crap-mcp/current/scripts/connect-clients.sh`. For a foreground service, point each client's HTTP MCP entry at its `/mcp` endpoint and install the two skill folders in that client’s supported skill directory.

At the end of a review the skill requests `review_changes` with `format:"chat", scorecard:true`. This returns the session score, an inline PNG and its local path. Codex desktop can embed the file in the agent reply. Other MCP clients can render the image or relay the text and report link. The QA and benchmark badges refer to the check matching the reviewed inputs.

Open a new Codex chat in a trusted Git checkout and ask **“Use $crap-development-review on this change”** or **“Use $crap-backlog-triage in this project.”** The skill calls `register_project` with the checkout path. Registration returns a stable ID for that path. Every subsequent analysis call supplies that ID, so concurrent chats and linked worktrees keep separate targets. The picker at [the local dashboard](http://127.0.0.1:47731/) lists the registered checkout paths and loads the selected project's current report. Reload to discover newly registered projects. For a task comparison, open `/?project=<id>&snapshot=<starting-snapshot>`.

Structural findings work immediately for TypeScript, TSX and Swift. For numeric CRAP scores, configure each project's coverage command and record its passing suite (below). The installed recorder is at `~/.local/share/crap-mcp/current/dist/record.js`. Registering a project writes its path to the local catalog and saves analysis under its Git directory. The machine service listens only on loopback and is intended for a trusted single-user workstation. Local processes can access registered reports and register checkouts. The browser cannot register a project through the picker.

For other platforms or development, run `npm ci && npm run machine` in one server checkout, then run `codex mcp add crap_score --url http://127.0.0.1:47731/mcp` and install the two skill folders in your user skills directory. The foreground service uses the same catalog and API. `CRAP_PORT` and `CRAP_DATA_DIR` override the foreground defaults.

## Project settings, checks and agent feedback

Select the checkout in the dashboard, then open **Project settings**. Settings and check history start local to each checkout. A checked-in team manifest supplies shared settings and lessons. Adjust the maximum raw CRAP per function, minimum measured line coverage per function, and the enabled Oxlint and native lint rules/tools. Save to apply them to the next check. The settings page records newly enabled and removed rules, language packs and target changes. A stale browser tab must reload before saving. The standard dashboard risk bands and session grading rubric still use the documented cross-project thresholds.

For checkout-specific directory omissions, enter one literal path per line under **Directory omissions**, such as `src/generated/` or `fixtures/legacy/`. The MCP skips those subtrees in scans, coverage imports and bundled Oxlint checks. The checked-in `.crap.json` field `exclude` supplies additional shared source-analysis prefixes. Native linters and arbitrary test commands use their own ignore settings. Start a new baseline and record fresh coverage after changing scope.

For a rule unique to your project, enable a catalog rule in settings or add a custom rule to the project's linter configuration and run that linter through `.crap.json`'s `checks` array. The project check history records the command's exit status.

Both skills probe the service before use and start the installed launch agent when it is offline. They register the current checkout, read its recent results, enable any required optional parser, then capture a baseline. Development review records each attempted change and reruns the checks. Backlog triage records the starting evidence and uses earlier outcomes when choosing a task. Example: **“Use $crap-development-review, enable Python for this project, and check my change.”**

From the target checkout, run the same workflow manually:

```sh
bash ~/.local/share/crap-mcp/current/scripts/ensure-service.sh
node ~/.local/share/crap-mcp/current/dist/project-check.js "Covered the empty-input branch"
```

The checker runs the bundled Oxlint rules on JS/TS, any opted-in native linters and the project's extra checks, then wraps the designated test command with the coverage recorder. Set `report` in `.crap.json` when the report path differs from `coverage/lcov.info`. The optional `checks` field accepts argument arrays, e.g. `"checks": [["npm", "run", "typecheck"]]`. These commands run from the target checkout when the agent or developer invokes the CLI. For a foreground installation, use `node /path/to/crap-mcp/dist/project-check.js "attempt"`. Standard Oxlint correctness defaults also apply. Native linters use their own project configuration.

Each attempt logs its note, time, commit, suite, policy ID, available lint counts by rule, native command exit status, coverage receipt, measured lines/functions, highest CRAP and target violations. Failed tests log a failed attempt without borrowing an earlier score. Missing coverage or a partial scan yields incomplete evidence. The checker exits nonzero for failed or incomplete runs. The dashboard and `get_project_settings` show the latest 30 attempts. Compare runs with the same suite and policy and use the function diff for attribution. This is local, retrievable feedback for the next agent session. Rules change through explicit settings edits.

## Compare behavior and performance after a cleanup

Ask **“Use $crap-development-review to baseline this cleanup, replay the acceptance checks, compare performance, and log what we learned.”** In `.crap.json`, configure named workloads with a version and an argument array. For example:

```json
"experiments": [
  {"kind":"qa","name":"Replay saved match","version":"1","command":["node","qa/replay.mjs"]},
  {"kind":"benchmark","name":"Replay 600 frames","version":"1","command":["node","qa/frame-time.mjs"],"maxMs":40}
]
```

The QA command should check expected output (for example, each frame’s state hash) and exit nonzero on divergence. A benchmark prints one finite nonnegative JSON number in milliseconds for a fixed workload. The checker runs it five times, retains every sample, and compares medians. An optional `maxMs` budget, a bad measurement, or a failed scenario fails the check. The two-minute timeout applies per invocation. A lower CRAP score measures complexity and test coverage. Correctness and speed require their own evidence.

Run the project checker before and after the change. Increment the workload version when the scenario, fixture, benchmark implementation or measurement conditions change. Matching requires the same definition, machine and Node version. Timing differences need reproduction under comparable load. The report shows the latest two attempts and labels missing or incompatible evidence. The agent can use `record_project_learning` to preserve a specific pair, explain a finding, and propose a follow-up. Applied policy changes and their reasons appear separately in the standard report. A proposal becomes enforceable when a rule is enabled or a regression check is implemented.

## Share settings and findings with a team

In **Project settings → Team manifest**, save your settings, then choose **Generate team manifest**. Review and commit `.crap-team.json` at the project root. Teammates who pull it use its settings automatically, including rules, thresholds, packs and directory omissions. Custom grammar packs and native linter binaries must already be available on each machine. Share the project’s `.crap.json` and workload scripts alongside it to reproduce checks.

The versioned manifest stores logged lessons with before/after evidence, policy change history, and a dated snapshot of findings. **Refresh shared findings** updates that snapshot. Later settings edits and logged lessons update the working copy for normal Git review. Raw local check history stays per checkout; a teammate sees shared evidence in the report even before their first local run. Resolve manifest conflicts in Git as for other project settings.

## Language packs and native linters

TypeScript, TSX and Swift grammars ship with the service. To add Python, Go or Rust, select its **Language pack** and save. Each optional pack downloads one version-pinned WASM file on first use, verifies its size and SHA-256, then reuses the machine cache. Switching it off removes that language from the project's next scan. Open the settings page again to see settings changed by another client. The server reads syntax directly, so an editor can be closed. Xcode test coverage continues to use the installed `xcrun xccov`.

| Language | Optional native tool | Rule catalog |
| --- | --- | --- |
| Python | `ruff check .` | [Ruff](https://docs.astral.sh/ruff/rules/) |
| Go | `staticcheck ./...` | [Staticcheck](https://staticcheck.dev/docs/checks/) |
| Rust | `cargo clippy --all-targets -- -D warnings` | [Clippy](https://rust-lang.github.io/rust-clippy/stable/index.html) |
| Swift | `swiftlint lint --strict` | [SwiftLint](https://github.com/realm/SwiftLint) |

Enable native linters separately. Their executables and any needed project dependencies must already be installed. An unavailable executable is reported as a failed check. Parsers provide structural metrics immediately. To produce numeric scores, the designated suite must emit a supported line-level coverage format for the target source. Convert native formats such as Go coverprofiles to LCOV in the designated command if needed.

The [pack catalog](languages/) lives in this repository. Each manifest declares its extensions, function and scope node types, decision and nesting nodes, grammar location, byte length, SHA-256 and optional linter command. To add a pack outside this repo, copy a manifest such as [Python](languages/python.json) into `~/.local/share/crap-mcp/languages/`, give it a unique ID and extensions, and set `core: false`. Supply a compatible Tree-sitter WASM file by local path relative to the manifest or pinned HTTPS URL. Obtain the digest with `shasum -a 256 FILE` and size with `wc -c < FILE`. Restart the installed service with `launchctl kickstart -k gui/$(id -u)/com.crap-score.machine`; the new option appears in settings. Use trusted manifests, since their optional linter commands execute during CLI checks. Run `npm run prove:packs` for the end-to-end download, activation, scan and deactivation experiment. It uses disposable checkouts and a fresh cache.

The machine tools `get_project_settings({project})` and `set_project_language({project, language, enabled, revision, linter?})` use the same settings as the browser. Use the revision from the read, then take a fresh baseline after changing the language set. Changing a project's languages changes the population being assessed.

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

Supported coverage inputs are LCOV with `DA` records, Istanbul/Jest `coverage-final.json` with statement locations and counters, and Xcode `.xcresult` bundles with detailed archive line counts (macOS with `xcrun xccov`). For Xcode, wrap the project's coverage-enabled `xcodebuild test` command and pass its fresh `-resultBundlePath` as the report. A bundle containing only test-target coverage cannot score a missing library target. Use the original checkout paths, not a report copied from a different machine. Summary percentages alone are insufficient.

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
