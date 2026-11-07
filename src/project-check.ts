import { adapter } from "./languages.ts";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { matchesGlob, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  digest,
  omitted,
  maybeRevision,
  repository,
  workFiles,
  type Repo,
} from "./files.ts";
import { fingerprint } from "./coverage.ts";
import { record, SuiteFailed } from "./record.ts";
import { scan } from "./scan.ts";
import {
  lintTemplate,
  qualityPolicy,
  catalog,
  type Targets,
} from "./quality-policy.ts";
import { measurements, saveRun, type CheckRun } from "./check-history.ts";

function lintMetrics(repo: Repo, settings: Targets): CheckRun["lint"] {
  const temp = mkdtempSync(join(tmpdir(), "crap-lint-"));

  try {
    const config = join(temp, "config.json");

    const plugin = fileURLToPath(
      new URL("../tools/oxlint/anti-slop/index.ts", import.meta.url),
    );

    const rules = Object.fromEntries(
      catalog.map((name) => [
        name,
        settings.rules.includes(name) ? "error" : "off",
      ]),
    );

    writeFileSync(
      config,
      JSON.stringify({
        rules,
        ignorePatterns: lintTemplate.ignorePatterns,
        jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      }),
    );

    return lintFiles(repo, config);
  } catch (error) {
    return { files: 0, violations: 0, rules: {}, error: String(error) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function lintSources(repo: Repo) {
  return workFiles(repo).filter(
    (file) =>
      /\.[cm]?[jt]sx?$/.test(file) &&
      !omitted(repo, file) &&
      !lintTemplate.ignorePatterns.some((pattern) =>
        matchesGlob(file, pattern),
      ) &&
      lstatSync(join(repo.root, file), { throwIfNoEntry: false })?.isFile(),
  );
}

function lintFiles(repo: Repo, config: string) {
  const files = lintSources(repo);

  const result: CheckRun["lint"] = {
    files: 0,
    violations: 0,
    rules: {},
    error: null,
  };

  const bin = fileURLToPath(
    new URL("../node_modules/oxlint/bin/oxlint", import.meta.url),
  );

  for (let start = 0; start < files.length; start += 100) {
    const batch = files.slice(start, start + 100);

    const child = spawnSync(
      process.execPath,
      [
        bin,
        "-c",
        config,
        "--disable-nested-config",
        "--no-error-on-unmatched-pattern",
        "-f",
        "json",
        "--",
        ...batch,
      ],
      { cwd: repo.root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );

    if (child.error) throw child.error;

    const report = z
      .object({
        number_of_files: z.number(),
        diagnostics: z.array(
          z.object({
            message: z.string(),
            filename: z.string(),
            code: z.string().optional(),
          }),
        ),
      })
      .parse(JSON.parse(child.stdout));

    if (child.status !== 0 && !report.diagnostics.length)
      throw Error(child.stderr || "Oxlint failed");
    result.files += report.number_of_files;
    result.violations += report.diagnostics.length;

    for (const item of report.diagnostics) {
      const key = item.code ?? "diagnostic";
      result.rules[key] = (result.rules[key] ?? 0) + 1;
      console.error(item.filename, item.code, item.message);
    }
  }

  return result;
}

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
  if (run.tools.some((tool) => tool.status !== 0)) return "failed";

  if (run.lint.error || run.lint.violations || run.tests === "failed")
    return "failed";

  return metricOutcome(run.metrics);
}

function metricOutcome(m: CheckRun["metrics"]): CheckRun["outcome"] {
  if (!m) return "incomplete";

  if (m.overCrap || m.belowCoverage) return "failed";

  return m.skipped || !m.total || m.total !== m.measured
    ? "incomplete"
    : "passed";
}

export async function projectCheck(repo: Repo, note: string) {
  const { settings, revision } = qualityPolicy(repo);

  const start = fingerprint(repo);

  const run: CheckRun = {
    at: new Date().toISOString(),
    note,
    commit: maybeRevision(repo.root, "HEAD"),
    suite: repo.config.suite,
    policy: digest(
      JSON.stringify([
        settings,
        repo.config,
        ...repo.packs.map((id) => adapter(id).version),
      ]),
    ),
    run: null,
    lint: lintMetrics(repo, settings),
    tools: nativeChecks(repo, settings),
    tests: "unconfigured",
    metrics: null,
    error: null,
    outcome: "incomplete",
  };

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
      const s = await scan(repo, { done: 0, total: 0 }, new Map());

      if (
        s.input !== start ||
        s.run !== receipt.run ||
        s.input !== receipt.snapshot ||
        qualityPolicy(repo).revision !== revision
      )
        throw Error("Inputs or settings changed during checks");
      run.metrics = measurements(s, settings);
    } catch (error) {
      run.tests = error instanceof SuiteFailed ? "failed" : "unverified";
      run.error = String(error);
    }
  }

  run.outcome = outcome(run);
  saveRun(repo, run);

  return run;
}

if (import.meta.main) {
  const result = await projectCheck(
    repository(process.cwd()),
    process.argv.slice(2).join(" ").slice(0, 2000),
  );

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.outcome === "passed" ? 0 : 1;
}
