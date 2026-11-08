import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { matchesGlob, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { omitted, workFiles, type Repo } from "./files.ts";
import { catalog, lintTemplate, type Targets } from "./quality-policy.ts";
import type { PatternSink } from "./pattern-evidence.ts";
import type { CheckRun } from "./check-history.ts";

const diagnostic = z.object({
  filename: z.string(),
  message: z.string(),
  code: z.string().optional(),
  help: z.string().nullish(),
  labels: z
    .array(
      z.object({ span: z.object({ line: z.number(), column: z.number() }) }),
    )
    .default([]),
});

export type OxDiagnostic = z.infer<typeof diagnostic>;

const reportSchema = z.object({
  number_of_files: z.number(),
  diagnostics: z.array(diagnostic),
});

export function oxBatch(
  repo: Repo,
  config: string,
  files: string[],
  typed: boolean,
) {
  const bin = fileURLToPath(
    new URL("../node_modules/oxlint/bin/oxlint", import.meta.url),
  );

  const binDir = fileURLToPath(
    new URL("../node_modules/.bin", import.meta.url),
  );

  const child = spawnSync(
    process.execPath,
    [
      bin,
      ...(typed ? ["--type-aware"] : []),
      "-c",
      config,
      "--disable-nested-config",
      "--no-error-on-unmatched-pattern",
      "-f",
      "json",
      "--",
      ...files,
    ],
    {
      cwd: repo.root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PATH: binDir + delimiter + process.env.PATH },
    },
  );

  if (child.error) throw child.error;

  return parseOx(child.stdout, child.stderr, child.status);
}

function parseOx(stdout: string, stderr: string, status: number | null) {
  if (!stdout.trimStart().startsWith("{"))
    throw Error((stderr || stdout || "Oxlint failed").slice(0, 1000));
  const report = reportSchema.parse(JSON.parse(stdout));

  if (status !== 0 && !(status === 1 && report.diagnostics.length))
    throw Error(stderr || "Oxlint failed");

  return report;
}

export function lintMetrics(
  repo: Repo,
  settings: Targets,
  sink: PatternSink,
): CheckRun["lint"] {
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

    return lintFiles(repo, config, sink);
  } catch (error) {
    return { files: 0, violations: 0, rules: {}, error: String(error) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function lintSources(repo: Repo) {
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

function lintFiles(repo: Repo, config: string, sink: PatternSink) {
  const files = lintSources(repo);

  const result: CheckRun["lint"] = {
    files: 0,
    violations: 0,
    rules: {},
    error: null,
  };

  for (let start = 0; start < files.length; start += 100) {
    const report = oxBatch(
      repo,
      config,
      files.slice(start, start + 100),
      false,
    );

    result.files += report.number_of_files;
    result.violations += report.diagnostics.length;

    for (const item of report.diagnostics) {
      const key = item.code ?? "diagnostic";
      result.rules[key] = (result.rules[key] ?? 0) + 1;
      sink.ox(item);
    }
  }

  return result;
}
