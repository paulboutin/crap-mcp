import { spawnSync } from "node:child_process";
import { writeFileSync, lstatSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { inScope, workFiles, type Repo } from "./files.ts";
import { oxBatch, lintSources } from "./pattern-oxlint.ts";
import type { PatternSink } from "./pattern-evidence.ts";

function inProject(file: string, roots: Set<string>) {
  let dir = dirname(file);

  while (!roots.has(dir)) {
    if (dir === ".") return false;
    dir = dirname(dir);
  }

  return true;
}

export function typedPatterns(repo: Repo, temp: string, sink: PatternSink) {
  const roots = new Set(
    workFiles(repo).flatMap((f) =>
      basename(f) === "tsconfig.json" ? [dirname(f)] : [],
    ),
  );

  const ts = lintSources(repo).filter(
    (file) => /\.[cm]?tsx?$/.test(file) && inScope(repo, file),
  );

  const files = ts.filter((file) => inProject(file, roots));
  const config = join(temp, "typed.json");
  writeFileSync(
    config,
    JSON.stringify({
      plugins: ["typescript"],
      categories: { correctness: "off" },
      rules: {
        "typescript/no-floating-promises": "warn",
        "typescript/no-misused-promises": "warn",
      },
    }),
  );

  for (let i = 0; i < files.length; i += 250) {
    const report = oxBatch(repo, config, files.slice(i, i + 250), true);

    for (const item of report.diagnostics) sink.ox(item);
  }

  sink.data.notes.push(
    "TypeScript promise rules: " +
      files.length +
      " files submitted under a tsconfig.json; " +
      (ts.length - files.length) +
      " outside a project. Type resolution depends on the project configuration and installed dependencies.",
  );
}

const swiftOutput = z.array(
  z.object({
    file: z.string(),
    line: z.number(),
    character: z.number().nullish(),
    rule_id: z.string(),
    reason: z.string(),
  }),
);

function swiftBatch(
  repo: Repo,
  config: string,
  files: string[],
  sink: PatternSink,
) {
  const child = spawnSync(
    "swiftlint",
    [
      "lint",
      "--quiet",
      "--no-cache",
      "--config",
      config,
      "--reporter",
      "json",
      "--",
      ...files,
    ],
    { cwd: repo.root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (child.error) throw child.error;

  readSwiftOutput(sink, child.stdout, child.stderr, child.status);
}

export function readSwiftOutput(
  sink: PatternSink,
  stdout: string,
  stderr: string,
  status: number | null,
) {
  if (![0, 2].includes(status ?? -1))
    throw Error(stderr.slice(0, 1000) || "SwiftLint failed");
  const findings = swiftOutput.parse(JSON.parse(stdout));

  if (status === 2 && !findings.length)
    throw Error(stderr.slice(0, 1000) || "SwiftLint failed");

  for (const item of findings)
    sink.add({
      tool: "SwiftLint",
      rule: item.rule_id,
      file: item.file,
      line: item.line,
      column: item.character ?? null,
      message: item.reason,
      action: "",
    });
}

export function swiftPatterns(repo: Repo, temp: string, sink: PatternSink) {
  const files = workFiles(repo).filter(
    (file) =>
      file.endsWith(".swift") &&
      inScope(repo, file) &&
      lstatSync(join(repo.root, file), { throwIfNoEntry: false })?.isFile(),
  );

  const config = join(temp, "swift.yml");
  writeFileSync(
    config,
    "only_rules:\n  - force_try\n  - force_cast\n  - weak_delegate\n",
  );

  for (let i = 0; i < files.length; i += 100)
    swiftBatch(repo, config, files.slice(i, i + 100), sink);
  sink.data.notes.push(
    "SwiftLint: " +
      files.length +
      " Swift files submitted for force_try, force_cast and weak_delegate.",
  );
}
