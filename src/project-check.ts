import { boundedSourceCheck } from "./source-check.ts";
import { randomUUID } from "node:crypto";
import { delimiter, dirname } from "node:path";
import { runTrial } from "./experiments.ts";
import { adapter } from "./languages.ts";
import { spawnSync } from "node:child_process";
import { capturePatterns } from "./pattern-scan.ts";
import { digest, maybeRevision, repository, type Repo } from "./files.ts";
import { fingerprint } from "./coverage.ts";
import { record, SuiteFailed } from "./record.ts";
import { scan } from "./scan.ts";
import { qualityPolicy, type Targets } from "./quality-policy.ts";
import { measurements, saveRun, type CheckRun } from "./check-history.ts";

function nativeChecks(repo: Repo, settings: Targets) {
  const commands = settings.linters
    .map((id) => adapter(id).linter!.command)
    .concat(repo.config.checks ?? []);

  return commands.map(([name, ...args]) => {
    const result = spawnSync(name, args, { cwd: repo.root, stdio: "inherit" });

    return {
      name: [name, ...args].join(" "),
      status: result.status,
      error: result.error?.message ?? null,
    };
  });
}

function outcome(run: CheckRun): CheckRun["outcome"] {
  if (run.trials?.some((trial) => trial.status === "failed")) return "failed";

  if (run.tools.some((tool) => tool.status !== 0)) return "failed";

  if (run.lint.error || run.lint.violations || run.tests === "failed")
    return "failed";

  const sourceChecks = [
    run.security?.status,
    run.accessibility?.status,
    run.accessibility?.colorblindStatus,
  ];

  if (sourceChecks.includes("failed")) return "failed";

  if (run.error) return "incomplete";
  const metrics = metricOutcome(run.metrics);

  return metrics === "passed" && sourceChecks.includes("incomplete")
    ? "incomplete"
    : metrics;
}

function metricOutcome(m: CheckRun["metrics"]): CheckRun["outcome"] {
  if (!m) return "incomplete";

  if (m.overCrap || m.belowCoverage) return "failed";

  return m.skipped || !m.total || m.total !== m.measured
    ? "incomplete"
    : "passed";
}

export async function projectCheck(repo: Repo, note: string) {
  const { settings } = qualityPolicy(repo);

  const {
    operational: _operational,
    accessibilityRules: _accessibilityRules,
    accessibilityPalette: _palette,
    minColorblindScore: _colorTarget,
    minAccessibilityScore: _accessibilityTarget,
    securityRules: _securityRules,
    minSecurityScore: _target,
    ...checkSettings
  } = settings;

  const start = fingerprint(repo);

  const run: CheckRun = {
    attempt: randomUUID(),
    phase: "patterns",
    runtime: {
      executable: process.execPath,
      version: process.version,
      architecture: process.arch,
    },
    at: new Date().toISOString(),
    note,
    thresholds: {
      maxCrap: settings.maxCrap,
      minCoverage: settings.minCoverage,
    },
    commit: maybeRevision(repo.root, "HEAD"),
    suite: repo.config.suite,
    policy: digest(
      JSON.stringify([
        checkSettings,
        repo.config,
        ...repo.packs.map((id) => adapter(id).version),
      ]),
    ),
    run: null,
    lint: { files: 0, violations: 0, rules: {}, error: "Not measured yet" },
    tools: [],
    tests: repo.config.command ? "unverified" : "unconfigured",
    metrics: null,
    error: null,
    outcome: "incomplete",
  };

  saveRun(repo, run);
  const patterns = capturePatterns(repo, start);
  run.lint = patterns.lint;
  run.patternSnapshot = patterns.id;
  run.phase = "tools";
  saveRun(repo, run);
  run.tools = nativeChecks(repo, settings);
  run.trials = repo.config.experiments?.map((spec) =>
    runTrial(repo.root, spec),
  );
  run.phase = "tests";
  saveRun(repo, run);

  const command = repo.config.command;

  if (command) {
    try {
      const receipt = record(
        repo,
        repo.config.report ?? "coverage/lcov.info",
        command[0],
        command.slice(1),
      );

      run.run = receipt.run;
      run.tests = "passed";
      run.phase = "metrics";
      saveRun(repo, run);
      const s = await scan(repo, { done: 0, total: 0 }, new Map());

      if (
        s.input !== start ||
        s.run !== receipt.run ||
        s.input !== receipt.snapshot ||
        JSON.stringify(qualityPolicy(repo).settings) !==
          JSON.stringify(settings)
      )
        throw Error("Inputs or settings changed during checks");
      run.metrics = measurements(s, settings);
    } catch (error) {
      run.tests = error instanceof SuiteFailed ? "failed" : "unverified";
      run.error = String(error);
    }
  }

  for (const kind of ["accessibility", "security"] as const) {
    run.phase = kind;
    saveRun(repo, run);

    try {
      Object.assign(
        run,
        await boundedSourceCheck({
          root: repo.root,
          kind,
          minimum:
            kind === "security"
              ? settings.minSecurityScore
              : settings.minAccessibilityScore,
          colorMinimum: settings.minColorblindScore,
        }),
      );
    } catch (error) {
      run.error = [run.error, String(error)].filter(Boolean).join("; ");
    }
  }

  run.phase = "complete";
  run.completedAt = new Date().toISOString();
  run.outcome = outcome(run);
  saveRun(repo, run);

  return run;
}

if (import.meta.main) {
  // Shell PATH changes must not silently switch npm and its workers to another Node.
  process.env.PATH = [dirname(process.execPath), process.env.PATH ?? ""].join(
    delimiter,
  );

  const result = await projectCheck(
    repository(process.cwd()),
    process.argv.slice(2).join(" ").slice(0, 2000),
  );

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.outcome === "passed" ? 0 : 1;
}
