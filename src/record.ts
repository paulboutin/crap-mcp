#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fingerprint, receiptSchema } from "./coverage.ts";
import { repository, writeJson, eligible, type Repo } from "./files.ts";
import { importReport } from "./importers.ts";

function stamp(file: string) {
  if (!existsSync(file)) return "";
  const s = statSync(file, { bigint: true });

  return [s.ino, s.mtimeNs, s.ctimeNs].join(":");
}

export function record(
  repo: Repo,
  report: string,
  command: string,
  args: string[],
) {
  if (
    JSON.stringify([command, ...args]) !== JSON.stringify(repo.config.command)
  )
    throw Error(
      "Command must match the designated suite command in .crap.json",
    );

  const file = resolve(repo.root, report),
    before = stamp(file),
    snapshot = fingerprint(repo);

  const child = spawnSync(command, args, { cwd: repo.root, stdio: "inherit" });

  if (child.error) throw child.error;

  if (child.status !== 0)
    throw Error("Suite did not pass; no coverage recorded");

  if (!stamp(file) || before === stamp(file))
    throw Error("Suite did not produce a new report");

  if (snapshot !== fingerprint(repo))
    throw Error("Inputs changed during the suite");
  const { lines: rows, functions } = importReport(repo.root, file);

  const files = Object.fromEntries(
    [...rows].flatMap(([path, lines]) =>
      eligible(repo, path)
        ? [[path, [...lines].sort((a, b) => a[0] - b[0])]]
        : [],
    ),
  );

  if (!Object.keys(files).length)
    throw Error("Report has no executable lines for repository source");

  const result = receiptSchema.parse({
    files,
    functions: Object.fromEntries(
      Object.keys(files).map((file) => [file, functions[file] ?? []]),
    ),
    snapshot,
    suite: repo.config.suite,
    run: randomUUID(),
    at: new Date().toISOString(),
  });

  writeJson(join(repo.local, "coverage.json"), result);

  return { run: result.run, snapshot, files: Object.keys(files).length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [report, separator, command, ...args] = process.argv.slice(2);

  if (!report || separator !== "--" || !command)
    throw Error("Usage: crap-coverage REPORT -- COMMAND [ARGS...]");
  console.log(
    JSON.stringify(record(repository(process.cwd()), report, command, args)),
  );
}
