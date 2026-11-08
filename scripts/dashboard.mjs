import { dashboardAccessibility } from "../dist/accessibility.js";
import { dashboardSecurity } from "../dist/security.js";
import { projectEvidence } from "../dist/project-learning.js";
import { repository } from "../dist/files.js";
import { reportHtml } from "../dist/report-html.js";
import assert from "node:assert/strict";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const target = resolve(process.argv[2] ?? ".");

const root = execFileSync(
  "git",
  ["-C", target, "rev-parse", "--show-toplevel"],
  { encoding: "utf8" },
).trim();

const destination = join(root, ".crap-local", "dashboard.html");
const client = new Client({ name: "report-dashboard", version: "1" });

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, result.content[0].text);

  return JSON.parse(result.content[0].text);
}

async function scanReport() {
  const first = await call("get_repository_report", { limit: 100 });
  const functions = [...first.items];
  let next = first.nextOffset;

  while (next !== null) {
    const page = await call("get_repository_report", {
      snapshot: first.snapshot.id,
      offset: next,
      limit: 100,
    });

    functions.push(...page.items);
    next = page.nextOffset;
  }

  assert.equal(functions.length, first.total);

  return { snapshot: first.snapshot, functions };
}

async function diffReport(snapshot) {
  const saved = process.env.CRAP_SNAPSHOT;

  if (!snapshot.commit && !process.env.CRAP_BASE && !saved) return null;

  const ref = saved
    ? "task snapshot " + saved.slice(0, 12)
    : (process.env.CRAP_BASE ?? "HEAD");

  const baseline = saved ? { snapshot: saved } : { base: ref };
  const first = await call("review_changes", { ...baseline, limit: 100 });
  assert.equal(
    first.current.id,
    snapshot.id,
    "Working tree changed during report; regenerate",
  );
  const deltas = [...first.findings.items];
  const contributions = first.affected.items.map((p) => p.contribution);
  let next = first.findings.nextOffset ?? first.affected.nextOffset;

  while (next !== null) {
    const page = await call("review_changes", {
      ...baseline,
      offset: next,
      limit: 100,
    });

    assert.equal(
      page.current.id,
      snapshot.id,
      "Working tree changed during report; regenerate",
    );
    deltas.push(...page.findings.items);
    contributions.push(...page.affected.items.map((p) => p.contribution));
    next = page.findings.nextOffset ?? page.affected.nextOffset;
  }

  return {
    ref,
    summary: first.summary,
    commit: first.baseline.commit ?? first.baseline.id,
    affected: first.affected.total,
    contributions,
    unassessed: first.unassessed,
    deltas,
  };
}

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../dist/server.js", import.meta.url)),
        root,
      ],
    }),
  );

  const report = await scanReport(),
    review = await diffReport(report.snapshot);

  const repo = repository(root);

  const security = dashboardSecurity(
    repo,
    process.env.SECURITY_SNAPSHOT,
    process.env.CRAP_BASE ?? report.snapshot.commit,
  );

  const html = reportHtml({
    accessibility: dashboardAccessibility(
      repo,
      process.env.ACCESSIBILITY_SNAPSHOT,
      process.env.CRAP_BASE ?? report.snapshot.commit,
    ),
    security,
    repository: basename(root),
    evidence: projectEvidence(repo),
    ...report,
    review,
  });

  mkdirSync(dirname(destination), { recursive: true });
  const temporary = destination + "." + randomUUID();
  writeFileSync(temporary, html, { mode: 0o600 });
  renameSync(temporary, destination);
  console.log("Dashboard: " + destination);
} finally {
  await client.close();
}
