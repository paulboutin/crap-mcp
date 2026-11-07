import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, repository } from "../src/files.ts";
import { projectCheck } from "../src/project-check.ts";
import { qualityPolicy, updatePolicy } from "../src/quality-policy.ts";
import { recentRuns } from "../src/check-history.ts";
import { loadLanguages, adapter, verifyGrammar } from "../src/languages.ts";

test("project checks retain real lint, suite and threshold failures for later comparisons", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-outcomes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const file = join(root, "unit.ts");
  writeFileSync(
    file,
    "export function work(x: number) {\n  console.log(x);\n  return x;\n}\n",
  );
  writeFileSync(join(root, ".gitignore"), "out.info\n");

  const command = [
    process.execPath,
    "-e",
    "require('fs').writeFileSync('out.info','SF:unit.ts\\nDA:2,1\\nDA:3,0\\nend_of_record\\n')",
  ];

  const config = {
    command,
    report: "out.info",
    checks: [[process.execPath, "-e", "process.exit(0)"]],
  };

  writeFileSync(join(root, ".crap.json"), JSON.stringify(config));
  const repo = repository(root);
  const first = qualityPolicy(repo);

  const settings = {
    ...first.settings,
    minCoverage: 75,
    maxCrap: 1,
    rules: [...first.settings.rules, "eslint/no-console"],
  };

  const next = updatePolicy(repo, { revision: first.revision, settings });
  assert.throws(
    () => updatePolicy(repo, { revision: first.revision, settings }),
    /Reload/,
  );
  assert.equal(next.changes[0].added[0], "eslint/no-console");
  const vendor = join(root, "tools/oxlint/anti-slop");
  mkdirSync(vendor, { recursive: true });
  writeFileSync(join(vendor, "vendor.js"), 'console.log("vendored");');
  const attempt = await projectCheck(repo, "added a log");
  assert.equal(attempt.tests, "passed");
  assert.equal(attempt.lint.rules["eslint(no-console)"], 1);
  assert.equal(attempt.lint.files, 1);
  assert.equal(attempt.metrics?.belowCoverage, 1);
  assert.equal(attempt.metrics?.overCrap, 1);
  assert.equal(attempt.outcome, "failed");
  writeFileSync(file, "export function work(x: number) {\n  return x;\n}\n");
  command[2] = command[2].replace("DA:3,0", "DA:3,1");
  writeFileSync(join(root, ".crap.json"), JSON.stringify(config));

  const success = await projectCheck(
    repository(root),
    "removed log and exercised both lines",
  );

  assert.equal(success.outcome, "passed");
  assert.equal(success.metrics?.worst, 1);
  config.command = [process.execPath, "-e", "process.exit(3)"];
  writeFileSync(join(root, ".crap.json"), JSON.stringify(config));
  const failed = await projectCheck(repository(root), "test failure");
  assert.equal(failed.tests, "failed");
  assert.equal(failed.metrics, null);
  assert.equal(recentRuns(repo).length, 3);
  assert.equal(recentRuns(repo)[0].note, "test failure");
});

test("local catalog entries use a verified grammar and reject mismatched bytes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "crap-language-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const py = adapter("python");
  assert.equal(py.core, false);

  const input = JSON.parse(
    readFileSync(
      new URL("../languages/typescript.json", import.meta.url),
      "utf8",
    ),
  );

  writeFileSync(
    join(dir, "extra.json"),
    JSON.stringify({
      ...input,
      id: "example",
      extensions: [".example"],
      wasm: adapter("typescript").path,
      core: false,
    }),
  );
  const [pack] = loadLanguages(dir);
  assert.equal(pack.id, "example");
  verifyGrammar(pack, readFileSync(pack.path));
  assert.throws(
    () => verifyGrammar(pack, Buffer.from("corrupt")),
    /checksum mismatch/,
  );
});

test("the installed current symlink executes the checker and records an unconfigured run", (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-installed-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  symlinkSync(
    fileURLToPath(new URL("../dist", import.meta.url)),
    join(root, "current"),
  );

  const res = spawnSync(
    process.execPath,
    [join(root, "current/project-check.js"), "CLI smoke"],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(res.status, 1, res.stderr);
  assert.equal(JSON.parse(res.stdout).outcome, "incomplete");
  assert.equal(recentRuns(repository(root))[0].note, "CLI smoke");
});
