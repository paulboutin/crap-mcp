import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = mkdtempSync(join(tmpdir(), "crap-proof-"));
const report = "lcov.info";

const command = [
  "node",
  "--experimental-test-coverage",
  "--test-coverage-include=status.ts",
  "--test-reporter=lcov",
  "--test-reporter-destination=" + report,
  "--test",
  "suite.mjs",
];

const here = (file) => fileURLToPath(new URL(file, import.meta.url));
const client = new Client({ name: "external-proof", version: "1" });
const measurements = [];

function fixture(name, destination) {
  copyFileSync(
    here("../test/fixtures/http-status/" + name),
    join(root, destination),
  );
}

function record() {
  return execFileSync(
    process.execPath,
    [here("../dist/record.js"), report, "--", ...command],
    { cwd: root, stdio: "pipe", encoding: "utf8" },
  );
}

async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, response.content[0].text);

  return JSON.parse(response.content[0].text);
}

async function inspect() {
  return (
    await call("analyze_function_health", {
      file: "status.ts",
      symbol: "describeStatus",
    })
  ).function;
}

function checkMeasurement(stage, h, complexity) {
  // Node instruments exactly one file. Read its DA lines directly, without the server's importer.
  const raw = readFileSync(join(root, report), "utf8");
  assert.equal([...raw.matchAll(/^SF:/gm)].length, 1);
  assert.match(raw, /^SF:.*status\.ts$/m);

  const measured = [...raw.matchAll(/^DA:(\d+),(\d+)/gm)].filter(
    ([, line]) => Number(line) >= h.start && Number(line) <= h.end,
  );

  const covered = measured.filter(([, , hits]) => Number(hits) > 0).length;
  assert.ok(measured.length > 0);
  assert.equal(h.coverage.status, "fresh");
  assert.equal(h.complexity, complexity);
  assert.equal(h.coverage.covered, covered);
  assert.equal(h.coverage.executable, measured.length);

  const expected =
    complexity +
    complexity ** 2 * ((measured.length - covered) / measured.length) ** 3;

  assert.ok(Math.abs(h.score - expected) < 1e-9);
  measurements.push({
    stage,
    complexity,
    coverage: covered + "/" + measured.length,
    score: h.score.toFixed(2),
  });
}

async function stale(stage) {
  const h = await inspect();
  assert.equal(h.coverage.status, "stale");
  assert.equal(h.score, null);
  measurements.push({
    stage,
    complexity: h.complexity,
    coverage: h.coverage.status,
    score: null,
  });
}

try {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  writeFileSync(
    join(root, ".crap.json"),
    JSON.stringify({ suite: "http-status", command }),
  );
  writeFileSync(join(root, ".gitignore"), report + "\n");
  fixture("status.ts", "status.ts");
  fixture("smoke.mjs", "suite.mjs");
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [here("../dist/server.js"), root],
    }),
  );
  const missing = await inspect();
  assert.equal(missing.coverage.status, "missing");
  assert.equal(missing.score, null);
  record();
  const before = await inspect();
  checkMeasurement("one tested status", before, 11);
  assert.ok(before.score > 30);
  const initial = await call("scan_repository_hotspots", { rule: "crap" });
  assert.equal(initial.total, 1);
  assert.equal(initial.items[0].symbol, before.symbol);

  const findingId = initial.items[0].id,
    snapshot = initial.snapshot.id;

  fixture("cases.mjs", "suite.mjs");
  await stale("tests edited");
  record();
  const full = await inspect();
  checkMeasurement("all status cases tested", full, 11);
  assert.equal(before.hash, full.hash);
  assert.equal(full.score, 11);
  const reviewed = await call("review_changes", { snapshot, findingId });
  assert.equal(reviewed.selected.status, "resolved");
  assert.equal(
    (await call("scan_repository_hotspots", { rule: "crap" })).total,
    0,
  );
  assert.equal(
    (await call("scan_repository_hotspots", { rule: "complexity" })).total,
    1,
  );
  const original = readFileSync(join(root, "status.ts"), "utf8");
  writeFileSync(
    join(root, "status.ts"),
    original.replace('"unauthorized"', '"forbidden"'),
  );
  await stale("wrong 401 result");
  assert.throws(record, /Suite did not pass/);
  await stale("after failing suite");
  fixture("status-after.ts", "status.ts");
  record();
  const simple = await inspect();
  checkMeasurement("table lookup; same suite", simple, 2);
  assert.equal(simple.score, 2);
  assert.equal((await call("scan_repository_hotspots", {})).total, 0);
  const final = await call("review_changes", { snapshot });
  assert.deepEqual(
    final.findings.items.map((x) => [x.findingId, x.status]).sort(),
    [
      [before.id + ":complexity", "resolved"],
      [findingId, "resolved"],
    ].sort(),
  );

  const chat = await client.callTool({
    name: "review_changes",
    arguments: { snapshot, format: "chat" },
  });

  assert.ok(!chat.isError);
  assert.match(chat.content[0].text, /Session health: 10.0\/10/);
  assert.match(chat.content[0].text, /describeStatus: [0-9.]+ → 2.00/);
  console.table(measurements);
  console.log(chat.content[0].text);
  console.log(
    "Verified both original findings resolved; a failing suite could not certify a score.",
  );
} finally {
  try {
    await client.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
