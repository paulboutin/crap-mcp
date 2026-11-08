import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { fingerprint } from "./coverage.ts";
import { digest, readJson, writeJson, repository, type Repo } from "./files.ts";
import { qualityPolicy } from "./quality-policy.ts";
import { patternData, PatternSink } from "./pattern-evidence.ts";
import { lintMetrics } from "./pattern-oxlint.ts";
import { typedPatterns, swiftPatterns } from "./pattern-languages.ts";

function policyKey(repo: Repo) {
  const { settings } = qualityPolicy(repo);

  return digest(
    JSON.stringify([settings.rules, repo.omitDirectories, repo.config.exclude]),
  );
}

export function capturePatterns(
  repo: Repo,
  input = fingerprint(repo),
  codeSnapshot?: string,
) {
  const sink = new PatternSink(repo, input, policyKey(repo));
  sink.data.codeSnapshot = codeSnapshot;
  const lint = lintMetrics(repo, qualityPolicy(repo).settings, sink);
  sink.data.notes.push(
    lint.error
      ? "Oxlint incomplete: " + lint.error
      : "Oxlint: " + lint.files + " JavaScript / TypeScript files checked.",
  );
  const temp = mkdtempSync(join(tmpdir(), "crap-patterns-"));

  try {
    for (const [tool, run] of [
      ["TypeScript", typedPatterns],
      ["SwiftLint", swiftPatterns],
    ] as const) {
      try {
        run(repo, temp, sink);
      } catch (error) {
        sink.data.notes.push(tool + " incomplete: " + String(error));
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  if (input !== fingerprint(repo) || sink.data.policy !== policyKey(repo))
    throw Error("Inputs changed during language checks; rerun the scan.");
  sink.data.findings.sort(
    (a, b) => Number(Boolean(b.impact)) - Number(Boolean(a.impact)),
  );
  const id = digest(JSON.stringify(sink.data));
  writeJson(join(repo.local, "patterns", id + ".json"), sink.data);
  writeJson(join(repo.local, "patterns-latest.json"), id);

  return { id, data: sink.data, lint };
}

export function savedPatterns(repo: Repo, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid pattern snapshot");

  return readJson(join(repo.local, "patterns", id + ".json"), patternData);
}

export function latestPatterns(repo: Repo, input: string) {
  const id = readJson(join(repo.local, "patterns-latest.json"), z.string());
  const data = id && savedPatterns(repo, id);

  return data && data.input === input && data.policy === policyKey(repo)
    ? data
    : undefined;
}

export async function backgroundPatterns(
  repo: Repo,
  input: string,
  codeSnapshot: string,
) {
  const result = await promisify(execFile)(process.execPath, [
    fileURLToPath(import.meta.url),
    repo.root,
    input,
    codeSnapshot,
  ]);

  return result.stdout.trim();
}

if (import.meta.main)
  console.log(
    capturePatterns(
      repository(process.argv[2]),
      process.argv[3],
      process.argv[4],
    ).id,
  );
