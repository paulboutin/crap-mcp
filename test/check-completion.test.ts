import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { withSyntax } from "../src/syntax.ts";
import { boundedSourceCheck } from "../src/source-check.ts";
import { git, repository } from "../src/files.ts";
import { recentRuns } from "../src/check-history.ts";

test("cancelled synthetic Swift input cannot contaminate the next parse", () => {
  const source = Array.from(
    { length: 10000 },
    (_, i) => `func item${i}() -> Int { return ${i} }`,
  ).join("\n");

  assert.throws(
    () => withSyntax("swift", source, () => true, 0),
    /budget; source unassessed/,
  );
  assert.equal(
    withSyntax(
      "swift",
      "func next() -> Int { return 1 }",
      (root) => root.hasError,
    ),
    false,
  );
});

test("a non-cooperative scanner is terminated and never represented as passed", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-worker-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = join(root, "stuck.mjs");
  writeFileSync(entry, "while (true) {}\n");
  await assert.rejects(
    boundedSourceCheck({ root, kind: "security" }, 100, pathToFileURL(entry)),
    /source check unassessed/,
  );
  writeFileSync(entry, "process.exit(0);\n");
  await assert.rejects(
    boundedSourceCheck({ root, kind: "security" }, 1000, pathToFileURL(entry)),
    /before a result/,
  );
});

test("a killed checker leaves an unverified attempt before the suite finishes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-interrupted-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(
    join(root, ".crap.json"),
    JSON.stringify({
      command: [
        process.execPath,
        "-e",
        "process.kill(process.ppid, 'SIGKILL')",
      ],
    }),
  );

  const cli = fileURLToPath(
    new URL("../dist/project-check.js", import.meta.url),
  );

  const result = spawnSync(process.execPath, [cli, "interrupted test"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });

  assert.equal(result.signal, "SIGKILL", result.stderr);
  const runs = recentRuns(repository(root));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].phase, "tests");
  assert.equal(runs[0].tests, "unverified");
  assert.equal(runs[0].outcome, "incomplete");
  assert.equal(runs[0].completedAt, undefined);
});

test("CLI pins nested Node to its runtime and keeps one logical attempt with immutable checkpoints", (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-runtime-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(
    join(root, "unit.ts"),
    "export function work() {\n return 1;\n}\n",
  );
  writeFileSync(join(root, ".gitignore"), "out.info\nfake/\n");
  const fake = join(root, "fake");
  mkdirSync(fake);
  writeFileSync(join(fake, "node"), "#!/bin/sh\nexit 99\n");
  chmodSync(join(fake, "node"), 0o755);
  writeFileSync(
    join(root, ".crap.json"),
    JSON.stringify({
      report: "out.info",
      command: [
        "node",
        "-e",
        "require('fs').writeFileSync('out.info','SF:unit.ts\\nDA:2,1\\nend_of_record\\n')",
      ],
    }),
  );

  const cli = fileURLToPath(
    new URL("../dist/project-check.js", import.meta.url),
  );

  const result = spawnSync(process.execPath, [cli, "runtime test"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, PATH: [fake, process.env.PATH].join(delimiter) },
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const repo = repository(root);
  const runs = recentRuns(repo);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tests, "passed");
  assert.equal(runs[0].phase, "complete");
  assert.equal(runs[0].runtime?.executable, process.execPath);
  assert.ok(runs[0].completedAt);
  assert.ok(readdirSync(join(repo.local, "checks")).length >= 6);
});
