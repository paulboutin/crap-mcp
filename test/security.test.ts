import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, repository } from "../src/files.ts";
import { edit, qualityPolicy, updatePolicy } from "../src/quality-policy.ts";
import {
  securityScan,
  securityCheck,
  securityReport,
  securityBaseline,
} from "../src/security.ts";

test("security policy, scope, score floor and unavailable evidence stay explicit", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sec-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init");
  writeFileSync(
    join(dir, ".crap.json"),
    JSON.stringify({ exclude: ["ignored/"] }),
  );
  const repo = repository(dir);
  const report = () => securityReport(securityScan(repo));
  assert.equal(report().score, null);
  writeFileSync(join(dir, "a.d.ts"), "declare const ignored: string;");
  writeFileSync(join(dir, "a.ts"), 'crypto.createHash("md5");\n'.repeat(11));
  const start = securityScan(repo);
  assert.equal(securityReport(start).score, 0);
  assert.equal(new Set(start.findings.map((f) => f.id)).size, 11);
  const p = qualityPolicy(repo);

  const policy = updatePolicy(repo, {
    revision: p.revision,
    settings: { ...p.settings, securityRules: ["dynamic-eval"] },
  });

  assert.equal(report().score, 100);
  assert.throws(
    () => securityReport(securityScan(repo), start),
    /policy differs/,
  );
  assert.equal(
    edit.safeParse({
      revision: policy.revision,
      settings: { ...policy.settings, securityRules: ["x"] },
    }).success,
    false,
  );
  writeFileSync(
    join(dir, "hash.swift"),
    "func f() { SecTrustSetExceptions(trust, x) }",
  );
  writeFileSync(join(dir, "other.py"), "print(1)");
  symlinkSync(join(dir, "a.ts"), join(dir, "linked.ts"));
  const gap = report();
  assert.equal(gap.score, null);
  assert.equal(gap.skipped.length, 3);
  assert.equal(gap.assessed, 1);
  assert.throws(() => securityBaseline(repo, "../secrets"), /Invalid/);
  updatePolicy(repo, {
    revision: policy.revision,
    settings: { ...policy.settings, securityRules: ["trust-exceptions"] },
  });
  assert.equal(report().findings[0].rule, "trust-exceptions");
});

test("SQL review distinguishes interpolation from bound parameters and reports check target failures", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sec-sql-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init");
  const repo = repository(dir);
  const file = join(dir, "users.mjs");
  writeFileSync(
    file,
    [
      "db.query(`SELECT * FROM users WHERE id = ${req.id}`);",
      'db.query("SELECT * FROM users WHERE id = ?", [req.id]);',
      "db.query(`SELECT * FROM users`);",
      "log(`SELECT ${req.id}`);",
    ].join("\n"),
  );
  assert.equal(securityCheck(repo, 76).status, "failed");
  assert.equal(securityCheck(repo, 75).status, "passed");
  const r = securityReport(securityScan(repo));
  assert.equal(r.score, 75);
  assert.equal(r.findings[0].rule, "interpolated-sql");
  rmSync(file);
  assert.equal(securityCheck(repo, 75).status, "incomplete");
});
