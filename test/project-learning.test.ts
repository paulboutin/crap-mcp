import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, repository } from "../src/files.ts";
import { fingerprint } from "../src/coverage.ts";
import { runTrial } from "../src/experiments.ts";
import { compareChecks } from "../src/check-comparison.ts";
import {
  projectEvidence,
  recordLearning,
  shareProject,
} from "../src/project-learning.ts";
import { qualityPolicy, updatePolicy } from "../src/quality-policy.ts";
import { projectCheck } from "../src/project-check.ts";
import { Desk, createServer } from "../src/service.ts";
import { renderReport } from "../src/report-view.ts";
import { projectReport } from "../src/projects.ts";
import { JSDOM } from "jsdom";

test("replay failures and benchmark regressions survive sharing and a fresh clone", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-team-"));
  const clone = root + "-clone";
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  });
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "main.ts"), "export function value(){ return 1; }");
  writeFileSync(join(root, ".gitignore"), "result\nout.info\n");

  const qa = {
    name: "Replay",
    kind: "qa" as const,
    version: "1",
    command: [
      process.execPath,
      "-e",
      "process.exit(Number(require('fs').readFileSync('result')) === 5 ? 0 : 1)",
    ],
  };

  const bench = {
    name: "Lookup",
    kind: "benchmark" as const,
    version: "1",
    maxMs: 8,
    command: [
      process.execPath,
      "-e",
      "process.stdout.write(require('fs').readFileSync('result'))",
    ],
  };

  writeFileSync(
    join(root, ".crap.json"),
    JSON.stringify({
      experiments: [qa, bench],
      report: "out.info",
      command: [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('out.info','SF:main.ts\\nDA:1,1\\nend_of_record\\n')",
      ],
    }),
  );
  writeFileSync(join(root, "result"), "5");
  const repo = repository(root);
  const before = await projectCheck(repo, "reference replay");
  assert.equal(before.tests, "passed");
  writeFileSync(join(root, "result"), "10");
  const after = await projectCheck(repo, "regressed replay");
  assert.equal(after.outcome, "failed");
  assert.deepEqual(
    after.trials?.map((t) => t.status),
    ["failed", "failed"],
  );
  assert.deepEqual(after.trials?.[1].samples, [10, 10, 10, 10, 10]);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(repo);
  const client = new Client({ name: "qa-review", version: "1" });
  await server.connect(serverSide);
  await client.connect(clientSide);

  const chat = await client.callTool({
    name: "review_changes",
    arguments: { snapshot: before.metrics!.snapshot, format: "chat" },
  });

  assert.match(JSON.stringify(chat.content), /Replay · qa: passed → failed/);
  await client.close();
  const evidence = compareChecks(after, before).join("\n");
  assert.match(evidence, /Replay · qa: passed → failed/);
  assert.match(evidence, /previous 5.00 ms, change 5.00 ms/);
  const changed = runTrial(root, { ...bench, version: "2" });
  assert.match(
    compareChecks({ ...after, trials: [changed] }, before).join(" "),
    /no matching baseline/,
  );
  assert.equal(
    runTrial(root, {
      ...bench,
      command: [process.execPath, "-e", "console.log('invalid')"],
    }).status,
    "failed",
  );
  const initial = qualityPolicy(repo);
  recordLearning(repo, {
    project: "this",
    revision: initial.revision,
    before: before.at,
    after: after.at,
    finding: "replay divergence",
    conclusion: "Fixed input returned a different state",
    nextRule: "Keep replay as an acceptance check",
  });
  const learned = qualityPolicy(repo);

  const update = updatePolicy(repo, {
    revision: learned.revision,
    settings: {
      ...learned.settings,
      minCoverage: 70,
      omitDirectories: ["generated"],
    },
    reason: "Cover the divergent path",
  });

  const desk = new Desk(repository(root));
  const input = fingerprint(desk.repo);
  await assert.rejects(shareProject(desk, initial.revision), /Reload/);
  await shareProject(desk, update.revision);
  assert.equal(fingerprint(desk.repo), input);
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.email=test@example.org",
    "-c",
    "user.name=Test",
    "commit",
    "-m",
    "share",
  );
  git(root, "clone", "--quiet", root, clone);
  const peer = repository(clone);
  assert.deepEqual(peer.omitDirectories, ["generated"]);
  const shared = projectEvidence(peer);
  assert.ok(shared.capture?.findings.some((f) => f.file === "main.ts"));
  assert.match(
    shared.lessons[0].evidence.join(" "),
    /previous 5.00 ms, change 5.00 ms/,
  );
  assert.match(shared.lessons[0].evidence.join(" "), /Session health/);
  assert.equal(shared.changes[0].reason, "Cover the divergent path");
  assert.equal(shared.checks[0], undefined);

  const dom = new JSDOM(
    readFileSync(
      new URL("../dashboard/template.html", import.meta.url),
      "utf8",
    ),
  );

  renderReport(dom.window.document, await projectReport(new Desk(peer)));
  assert.match(
    dom.window.document.querySelector("#project-history")!.textContent!,
    /passed → failed/,
  );
  const policy = qualityPolicy(peer);
  updatePolicy(peer, {
    revision: policy.revision,
    settings: { ...policy.settings, maxCrap: 20 },
  });
  assert.equal(
    JSON.parse(readFileSync(join(clone, ".crap-team.json"), "utf8")).settings
      .maxCrap,
    20,
  );
  assert.equal(qualityPolicy(repo).settings.maxCrap, 30);
});
