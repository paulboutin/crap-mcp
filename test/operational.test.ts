import {
  operationalBaselines,
  selectOperationalBaseline,
} from "../src/operational-baselines.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  operationalPolicy,
  operationalEvidence,
  type OperationalEvidence,
} from "../src/operational-schema.ts";
import {
  normalized,
  badRateUpper,
  operationalScores,
  compareOperational,
} from "../src/operational-score.ts";
import {
  operationalReport,
  operationalSnapshot,
  importOperational,
  operationalRepository,
  operationalPolicyHash,
  reviewOperational,
} from "../src/operational-store.ts";
import { operationalMarkdown } from "../src/operational-card.ts";
import {
  inspectOperational,
  scanOperationalRisks,
} from "../src/operational-risks.ts";
import { git, repository } from "../src/files.ts";
import {
  qualityPolicy,
  updatePolicy,
  saveCapture,
} from "../src/quality-policy.ts";
import { machineApp } from "../src/machine-app.ts";
import { Projects, projectReport } from "../src/projects.ts";
import { renderReport } from "../src/report-view.ts";
import { workloadPolicy, workloadEvidence } from "./operational-fixtures.ts";

test("operational contracts reject malformed policies, nonfinite values, ambiguous thresholds and distributions", () => {
  const policy = workloadPolicy();
  const evidence = workloadEvidence();
  assert.ok(operationalEvidence.safeParse(evidence).success);

  for (const change of [
    { target: 0.5 },
    { target: 0.1 },
    { weight: 0.4 },
    { minSamples: 0 },
    { target: Infinity },
    { target: NaN },
  ]) {
    const p = structuredClone(policy);
    Object.assign(p.axes.scalability[0], change);
    assert.equal(
      operationalPolicy.safeParse(p).success,
      false,
      JSON.stringify(change),
    );
  }

  const duplicate = structuredClone(policy);
  duplicate.axes.reliability[0].id = "capacity";
  assert.equal(operationalPolicy.safeParse(duplicate).success, false);
  assert.equal(
    operationalPolicy.safeParse({ ...policy, version: 2 }).success,
    false,
  );

  for (const change of [
    { durationSeconds: 61 },
    { imageHash: "not-a-hash" },
    { attempts: { ...evidence.attempts, completed: 1 } },
    { metrics: [evidence.metrics[0], evidence.metrics[0]] },
    { privacy: "transcripts" },
    {
      metrics: [
        {
          ...evidence.metrics[1],
          observation: {
            kind: "histogram",
            samples: 10,
            bins: [
              { upper: 200, count: 5 },
              { upper: 100, count: 5 },
            ],
          },
        },
      ],
    },
    {
      metrics: [
        {
          ...evidence.metrics[1],
          observation: {
            kind: "histogram",
            samples: 10,
            bins: [{ upper: 100, count: 9 }],
          },
        },
      ],
    },
    {
      metrics: [
        {
          ...evidence.metrics[2],
          observation: {
            kind: "bad-rate",
            samples: 10,
            bad: 11,
            independentTrials: true,
          },
        },
      ],
    },
  ])
    assert.equal(
      operationalEvidence.safeParse({ ...evidence, ...change }).success,
      false,
      JSON.stringify(change),
    );
});

test("normalization and histogram percentiles retain boundaries and conservative confidence", () => {
  const p = workloadPolicy(),
    e = workloadEvidence();

  const capacity = p.axes.scalability[0],
    latency = p.axes.performance[0];

  assert.equal(normalized(capacity, 0), 0);
  assert.equal(normalized(capacity, 1), 0.5);
  assert.equal(normalized(capacity, 1.5), 1);
  assert.equal(normalized(capacity, 10), 1);
  const rounded = workloadPolicy();
  rounded.axes.scalability[0].weight = 0.5;
  rounded.axes.scalability.push({
    ...rounded.axes.scalability[0],
    id: "second-capacity",
    weight: 0.5 + 5e-10,
  });
  operationalPolicy.parse(rounded);
  const roundingEvidence = structuredClone(e);
  roundingEvidence.metrics.push({
    ...roundingEvidence.metrics[0],
    id: "second-capacity",
  });
  const bounded = operationalScores(rounded, roundingEvidence)[0];
  assert.equal(bounded.lower, 100);
  assert.equal(bounded.upper, 100);
  assert.equal(normalized(latency, 100), 1);
  assert.equal(normalized(latency, 300), 0.5);
  assert.equal(normalized(latency, 500), 0);
  assert.ok(badRateUpper(0, 10, 0.95) > 0.3);
  assert.ok(badRateUpper(0, 2000000, 0.95) < 0.001);
  assert.equal(badRateUpper(10, 10, 0.95), 1);
  const scores = operationalScores(p, e);
  assert.deepEqual(
    scores.map((a) => a.score),
    [100, 100, 100],
  );
  assert.ok(scores.every((a) => a.qualification.state === "target-qualified"));
  p.axes.performance[0].statistic = "p99";
  const slow = operationalScores(p, e)[1];
  assert.equal(slow.metrics[0].raw, 1000);
  assert.equal(slow.score, 0);
  assert.equal(slow.qualification.state, "measured-below-target");
});

test("missing and unusable evidence stays null; weighted bounds never renormalize missing metrics", () => {
  const p = workloadPolicy(),
    e = workloadEvidence();

  p.axes.performance[0].weight = 0.6;
  p.axes.performance.push({
    ...p.axes.performance[0],
    id: "second",
    weight: 0.4,
  });
  const partial = operationalScores(p, e)[1];
  assert.equal(partial.score, null);
  assert.equal(partial.evidencePercent, 60);
  assert.equal(partial.lower, 60);
  assert.equal(partial.upper, 100);
  assert.equal(partial.qualification.state, "unmeasured");

  for (const input of [
    null,
    { ...e, status: "failed" as const },
    { ...e, status: "incomplete" as const },
    { ...e, telemetryComplete: false },
    { ...e, coordinatedOmissionCorrected: false },
  ]) {
    assert.ok(operationalScores(p, input).every((a) => a.score === null));
  }

  assert.ok(
    operationalScores(p, e, [], Date.parse(e.endedAt) + 90000000).every(
      (a) => a.score === null,
    ),
  );
  assert.ok(
    operationalScores(p, e, [], Date.parse(e.startedAt)).every(
      (a) => a.score === null,
    ),
  );
  p.minDurationSeconds = 100;
  assert.ok(operationalScores(p, e).every((a) => a.score === null));
  p.minDurationSeconds = 60;
  e.metrics[0].observation.samples = 1;
  e.metrics[1].population = "successful-attempts";
  assert.equal(operationalScores(p, e)[0].score, null);
  assert.equal(operationalScores(p, e)[1].score, null);
  assert.ok(
    operationalScores(p, {
      ...e,
      attempts: {
        offered: 0,
        accepted: 0,
        completed: 0,
        errors: 0,
        cancelled: 0,
        incomplete: 0,
      },
    }).every((a) => a.score === null),
  );
});

test("mandatory SLO and integrity failures block qualification despite high weighted scores", () => {
  const p = workloadPolicy(),
    e = workloadEvidence();

  p.axes.scalability[0].weight = 0.99;
  p.axes.scalability.push({
    ...p.axes.scalability[0],
    id: "critical",
    weight: 0.01,
  });
  e.metrics.push({
    ...e.metrics[0],
    id: "critical",
    observation: { kind: "scalar", samples: 60, value: 0.5 },
  });
  const axis = operationalScores(p, e)[0];
  assert.equal(axis.score, 99);
  assert.equal(axis.qualification.state, "measured-below-target");

  for (const change of [
    { lostAccepted: 1 },
    { duplicateEffects: 1 },
    { privacyBypass: true },
    { status: "failed" as const },
  ]) {
    const invalid = structuredClone(e);
    Object.assign(invalid.faults[0], change);
    assert.equal(
      operationalScores(p, invalid)[2].qualification.state,
      "blocked",
    );
  }

  e.gates.slo = "failed";
  assert.ok(
    operationalScores(p, e).every((a) => a.qualification.state === "blocked"),
  );
  e.gates.slo = "unmeasured";
  assert.deepEqual(
    operationalScores(p, e).map((a) => a.qualification.state),
    ["measured-below-target", "unmeasured", "unmeasured"],
  );
  e.gates.slo = "passed";
  e.faults = [];
  assert.equal(operationalScores(p, e)[2].qualification.state, "unmeasured");
});

test("operational comparisons list incompatible contexts and explicitly acknowledge config experiments", () => {
  const before = workloadEvidence();
  const after = structuredClone(before);
  assert.equal(compareOperational(before, after).comparable, true);

  for (const field of [
    "repository",
    "policyHash",
    "workloadHash",
    "datasetHash",
    "harnessVersion",
    "environment",
    "model",
    "corpusHash",
    "costBasis",
  ] as const) {
    const changed = { ...after, [field]: "different" };
    assert.deepEqual(compareOperational(before, changed).mismatches, [field]);
  }

  after.resources[0].value = 4;
  assert.deepEqual(compareOperational(before, after).mismatches, ["resources"]);
  after.resources[0].value = 2;
  after.configHash = "1".repeat(64);
  assert.equal(compareOperational(before, after).comparable, false);
  assert.equal(compareOperational(before, after, true).comparable, true);
  after.sourceCommit = "2".repeat(40);
  after.imageHash = "3".repeat(64);
  after.deployment = "candidate-b";
  assert.equal(compareOperational(before, after, true).changes.length, 4);
});

function makeRepo(root: string) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Fixture");
  writeFileSync(
    join(root, "code.ts"),
    "export function answer() { return 42; }\n",
  );
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");

  return repository(root);
}

function setPolicy(repo: ReturnType<typeof repository>) {
  const state = qualityPolicy(repo);

  return updatePolicy(repo, {
    revision: state.revision,
    settings: { ...state.settings, operational: workloadPolicy() },
    reason: "Fictional test workload",
  });
}

function boundEvidence(repo: ReturnType<typeof repository>) {
  const evidence = workloadEvidence();
  evidence.repository = operationalRepository(repo);
  evidence.sourceCommit = git(repo.root, "rev-parse", "HEAD").trim();

  return evidence;
}

test("imports bind source/project/policy, preserve failed harness evidence, immutable snapshots and shared policies", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-operational-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(join(dir, "a"));
  const other = makeRepo(join(dir, "b"));
  const e = boundEvidence(repo);
  assert.equal(operationalReport(repo).axes.length, 0);
  assert.throws(() => importOperational(repo, e), /Configure/);
  const state = setPolicy(repo);
  setPolicy(other);
  assert.throws(() => importOperational(other, e), /another repository/);
  assert.throws(
    () => importOperational(repo, { ...e, policyHash: "0".repeat(64) }),
    /policy/,
  );
  assert.throws(() =>
    importOperational(repo, { ...e, sourceCommit: "0".repeat(40) }),
  );
  const report = importOperational(repo, e);
  assert.equal(report.sourceMatchesHead, true);
  assert.match(report.integration, /included/);
  assert.ok(report.axes.every((a) => a.score === 100));
  const snapshot = operationalSnapshot(repo, report.snapshot!);
  importOperational(repo, e);
  assert.equal(
    operationalSnapshot(repo, report.snapshot!).importedAt,
    snapshot.importedAt,
  );
  assert.throws(() => operationalSnapshot(other, report.snapshot!), /Unknown/);
  assert.throws(() => operationalSnapshot(repo, "../elsewhere"));
  const failed = importOperational(repo, { ...e, status: "failed" });
  assert.ok(failed.axes.every((a) => a.score === null));
  assert.equal(
    operationalSnapshot(repo, failed.snapshot!).evidence.status,
    "failed",
  );
  assert.ok(
    reviewOperational(
      repo,
      report.snapshot!,
      failed.snapshot!,
    ).comparison.deltas.every((d) => d.change === null),
  );
  saveCapture(repo, state.revision, null);

  const manifest = JSON.parse(
    readFileSync(join(repo.root, ".crap-team.json"), "utf8"),
  );

  writeFileSync(join(other.root, ".crap-team.json"), JSON.stringify(manifest));
  assert.deepEqual(qualityPolicy(other).settings.operational, workloadPolicy());
  assert.equal(operationalReport(other).snapshot, null);
  const updated = qualityPolicy(repo);
  updated.settings.operational!.axes.performance[0].target = 90;
  updatePolicy(repo, {
    revision: updated.revision,
    settings: updated.settings,
  });
  assert.ok(
    operationalReport(repo, report.snapshot!).axes.every(
      (a) => a.score === null,
    ),
  );
  assert.match(
    operationalReport(repo, report.snapshot!).problems.join(" "),
    /policy/,
  );
});

test("import validates units, populations, costs and confidence methods before saving", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-import-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);
  setPolicy(repo);
  const evidence = boundEvidence(repo);

  const changes: ((e: OperationalEvidence) => void)[] = [
    (e) => {
      e.metrics[0].id = "unknown";
    },
    (e) => {
      e.metrics[0].unit = "ms";
    },
    (e) => {
      e.metrics[0].observation = {
        kind: "histogram",
        samples: 1,
        bins: [{ upper: 1, count: 1 }],
      };
    },
    (e) => {
      e.metrics[2].observation.samples = 5;
    },
    (e) => {
      e.attempts.completed--;
      e.attempts.errors++;
    },
    (e) => {
      e.endedAt = new Date(Date.now() + 60000).toISOString();
      e.startedAt = new Date(Date.parse(e.endedAt) - 60000).toISOString();
    },
  ];

  for (const change of changes) {
    const e = structuredClone(evidence);
    change(e);
    assert.throws(() => importOperational(repo, e));
  }

  assert.equal(operationalReport(repo).snapshot, null);
});

test("source risk prompts are scoped, stable, omit ignored directories and never produce runtime scores", (t) => {
  const source =
    'import { Client } from "pg";\nexport async function load(items) { const client = new Client(); return Promise.all(items.map(fetch)); }';

  const enabled = ["per-call-client", "promise-fanout"];
  const findings = inspectOperational("example.ts", source, enabled);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    inspectOperational("example.ts", "\n" + source, enabled).map((f) => f.id),
    findings.map((f) => f.id),
  );
  assert.equal(
    inspectOperational(
      "example.ts",
      'const text = "Promise.all(items.map(fetch))";',
      enabled,
    ).length,
    0,
  );
  assert.equal(inspectOperational("example.ts", source, []).length, 0);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-risks-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);
  setPolicy(repo);
  writeFileSync(join(dir, "code.ts"), source);
  writeFileSync(join(dir, "data.txt"), "unknown language");
  const risk = scanOperationalRisks(repo);
  assert.equal(risk.findings.length, 2);
  assert.ok(risk.skipped.some((s) => s.file === "data.txt"));
  assert.ok(operationalReport(repo).axes.every((a) => a.score === null));
});

test("HTTP MCP imports and renders per-project operational scores in dashboard and chat", async (t) => {
  const dir = realpathSync(
    mkdtempSync(join(tmpdir(), "crap-operational-http-")),
  );

  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(join(dir, "source"));
  const projects = new Projects(join(dir, "machine"));
  const { id } = projects.register(repo.root);
  const server = machineApp(projects).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const port = z.object({ port: z.number() }).parse(server.address()).port;
  const base = "http://127.0.0.1:" + port;
  const client = new Client({ name: "operational-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp")),
  );
  t.after(() => client.close());
  const state = qualityPolicy(repo);
  const endpoint = base + "/projects/" + id + "/settings";

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: state.revision,
      settings: { ...state.settings, operational: workloadPolicy() },
    }),
  });

  assert.equal(response.status, 200);
  const e = boundEvidence(repo);

  const result = await client.callTool({
    name: "import_operational_evidence",
    arguments: { project: id, evidence: e },
  });

  assert.ok(!result.isError, JSON.stringify(result.content));
  const report = operationalReport(repo);

  const card = await client.callTool({
    name: "get_operational_scorecard",
    arguments: { project: id },
  });

  assert.match(JSON.stringify(card.content), /100.0\/100/);

  const review = await client.callTool({
    name: "review_operational_changes",
    arguments: { project: id, before: report.snapshot, after: report.snapshot },
  });

  assert.match(JSON.stringify(review.content), /Comparable/);

  const initialBaselines = await client.callTool({
    name: "get_operational_baselines",
    arguments: { project: id },
  });

  assert.ok(initialBaselines.content[0].type === "text");

  const baselineRevision = JSON.parse(
    initialBaselines.content[0].text,
  ).revision;

  const tagged = await client.callTool({
    name: "import_operational_evidence",
    arguments: { project: id, evidence: taggedEvidence(repo) },
  });

  assert.ok(!tagged.isError);
  assert.ok(tagged.content[0].type === "text");
  const taggedSnapshot = JSON.parse(tagged.content[0].text).snapshot;

  const savedBaseline = await client.callTool({
    name: "set_operational_baseline",
    arguments: {
      project: id,
      snapshot: taggedSnapshot,
      revision: baselineRevision,
      reason: "HTTP baseline acceptance",
    },
  });

  assert.ok(!savedBaseline.isError, JSON.stringify(savedBaseline.content));

  const staleBaseline = await client.callTool({
    name: "set_operational_baseline",
    arguments: {
      project: id,
      snapshot: taggedSnapshot,
      revision: baselineRevision,
      reason: "Stale HTTP writer",
    },
  });

  assert.ok(staleBaseline.isError);

  const risk = await client.callTool({
    name: "scan_operational_risks",
    arguments: { project: id },
  });

  assert.ok(!risk.isError);
  const current = await projectReport(projects.desk(id));

  const dom = new JSDOM(
    readFileSync(
      new URL("../dashboard/template.html", import.meta.url),
      "utf8",
    ),
  );

  renderReport(dom.window.document, current);
  assert.match(
    dom.window.document.getElementById("operational-report")!.textContent!,
    /scalability: 100.0\/100/,
  );
  assert.match(
    await (await fetch(base + "/settings")).text(),
    /Version 1 policy/,
  );
  const markdown = operationalMarkdown(report);
  assert.match(markdown, /Evidence/);
  assert.match(markdown, /Source:/);
  assert.equal(operationalPolicyHash(workloadPolicy()), report.policyHash);
});

test("comparisons suppress deltas for demand, cohort and fault changes and retain measured regressions", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-comparison-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);
  setPolicy(repo);
  const e = boundEvidence(repo);
  const before = importOperational(repo, e);
  const next = structuredClone(e);
  next.metrics[0].observation = { kind: "scalar", value: 1, samples: 60 };
  const after = importOperational(repo, next);
  const review = reviewOperational(repo, before.snapshot!, after.snapshot!);
  assert.equal(review.comparison.deltas[0].change, -50);
  assert.match(operationalMarkdown(review), /-50.0/);
  assert.equal(
    compareOperational(e, {
      ...e,
      attempts: { ...e.attempts, offered: e.attempts.offered + 1 },
    }).comparable,
    false,
  );
  const cohort = structuredClone(e);
  cohort.metrics[0].population = "fault-trials";
  assert.deepEqual(compareOperational(e, cohort).mismatches, [
    "metric populations",
  ]);
  assert.deepEqual(compareOperational(e, { ...e, faults: [] }).mismatches, [
    "fault cases",
  ]);
  next.configHash = "9".repeat(64);
  const changed = importOperational(repo, next);
  assert.ok(
    reviewOperational(
      repo,
      before.snapshot!,
      changed.snapshot!,
    ).comparison.deltas.every((d) => d.change === null),
  );
  assert.equal(
    reviewOperational(repo, before.snapshot!, changed.snapshot!, true)
      .comparison.deltas[0].change,
    -50,
  );
  const policy = qualityPolicy(repo);
  updatePolicy(repo, {
    revision: policy.revision,
    settings: { ...policy.settings, operational: null },
  });
  assert.ok(operationalReport(repo).axes.every((a) => a.score === null));
  const snapshot = operationalSnapshot(repo, before.snapshot!);
  snapshot.evidence.metrics = [];
  writeFileSync(
    join(repo.local, "operational", before.snapshot + ".json"),
    JSON.stringify(snapshot),
  );
  assert.throws(() => operationalSnapshot(repo, before.snapshot!), /altered/);
});

test("confidence requirements and cost basis cannot be bypassed by a scalar reliability ratio", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-confidence-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);
  setPolicy(repo);

  const state = qualityPolicy(repo),
    p = workloadPolicy();

  p.axes.reliability[0].statistic = "scalar";
  p.axes.performance[0].statistic = "scalar";
  p.axes.performance[0].unit = "usd/operation";
  updatePolicy(repo, {
    revision: state.revision,
    settings: { ...state.settings, operational: p },
  });
  const e = boundEvidence(repo);
  e.policyHash = operationalPolicyHash(p);
  e.metrics[1] = {
    id: "latency",
    unit: "usd/operation",
    population: "all-attempts",
    observation: { kind: "scalar", samples: 2000000, value: 0.2 },
  };
  e.metrics[2].observation = { kind: "scalar", samples: 2000000, value: 0 };
  assert.throws(() => importOperational(repo, e), /cost basis/);
  e.costBasis =
    "USD infrastructure plus model cost per completed operation, fixed quality fixture";
  assert.throws(() => importOperational(repo, e), /confidence/);
  e.metrics[2].population = "fault-trials";
  assert.ok(importOperational(repo, e).snapshot);
  const tiny = workloadEvidence();
  tiny.metrics[2].observation = {
    kind: "bad-rate",
    bad: 0,
    samples: 10,
    independentTrials: true,
  };
  const score = operationalScores(workloadPolicy(), tiny)[2];
  assert.equal(score.score, null);
  assert.match(score.metrics[0].reasons.join(" "), /Insufficient/);
});

function taggedEvidence(repo: ReturnType<typeof repository>) {
  const e = boundEvidence(repo);
  e.provenance = {
    suite: "journey-replay-v1",
    appBuild: null,
    routingHash: "1".repeat(64),
    sourceTreeHash: "2".repeat(64),
    stage: "worktree",
  };

  return e;
}

test("original version-1 snapshots keep their IDs and null measurements remain null after the additive import extension", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-legacy-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);

  const fixture = JSON.parse(
    readFileSync(
      new URL("fixtures/operational/legacy-v1.json", import.meta.url),
      "utf8",
    ),
  );

  mkdirSync(join(repo.local, "operational"), { recursive: true });
  writeFileSync(
    join(repo.local, "operational", fixture.id + ".json"),
    JSON.stringify(fixture),
  );
  const loaded = operationalSnapshot(repo, fixture.id);
  assert.deepEqual(loaded, fixture);
  assert.equal(loaded.evidence.provenance, undefined);
  assert.ok(
    operationalReport(repo, fixture.id).axes.every((a) => a.score === null),
  );
  const history = operationalBaselines(repo);
  assert.throws(
    () =>
      selectOperationalBaseline(repo, {
        snapshot: fixture.id,
        revision: history.revision,
        reason: "legacy",
      }),
    /Legacy evidence/,
  );
  assert.equal(operationalSnapshot(repo, fixture.id).id, fixture.id);
});

test("baseline selections retain old evidence, reject conflicts and require the exact integrated revision", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-baselines-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);
  setPolicy(repo);
  const e = taggedEvidence(repo);
  e.metrics = [];
  const first = importOperational(repo, e);
  const empty = operationalBaselines(repo);

  const selected = selectOperationalBaseline(repo, {
    snapshot: first.snapshot!,
    revision: empty.revision,
    reason: "Preserve missing starting measurements",
  });

  assert.ok(selected.scorecard.axes.every((a) => a.score === null));
  const changed = taggedEvidence(repo);
  changed.provenance!.sourceTreeHash = "3".repeat(64);
  const second = importOperational(repo, changed);
  assert.throws(
    () =>
      selectOperationalBaseline(repo, {
        snapshot: second.snapshot!,
        revision: empty.revision,
        reason: "stale writer",
      }),
    /changed/,
  );

  const next = selectOperationalBaseline(repo, {
    snapshot: second.snapshot!,
    revision: selected.revision,
    reason: "Measured candidate",
  });

  assert.equal(next.entry.previous, selected.entry.id);
  assert.deepEqual(
    operationalSnapshot(repo, first.snapshot!).evidence.metrics,
    [],
  );
  const page = operationalBaselines(repo, 0, 1);
  assert.equal(page.total, 2);
  assert.equal(page.nextOffset, 1);
  assert.equal(
    operationalBaselines(repo, 1, 1).entries[0].snapshot,
    first.snapshot,
  );
  git(dir, "commit", "--allow-empty", "-qm", "integration advances");

  const oldIntegrated = {
    ...changed,
    provenance: { ...changed.provenance!, stage: "integrated" as const },
  };

  const old = importOperational(repo, oldIntegrated);
  assert.throws(
    () =>
      selectOperationalBaseline(repo, {
        snapshot: old.snapshot!,
        revision: next.revision,
        reason: "ancestor is not a rerun",
      }),
    /exact current integration/,
  );
  const integrated = taggedEvidence(repo);
  integrated.provenance!.stage = "integrated";
  const fresh = importOperational(repo, integrated);

  const promoted = selectOperationalBaseline(repo, {
    snapshot: fresh.snapshot!,
    revision: next.revision,
    reason: "Fresh measurement at integrated tip",
  });

  assert.equal(
    promoted.entry.integrationCommit,
    git(dir, "rev-parse", "main").trim(),
  );
  assert.equal(promoted.entry.previous, null);
  assert.equal(operationalBaselines(repo).total, 3);
  const oldBytes = JSON.stringify(operationalSnapshot(repo, second.snapshot!));
  git(dir, "commit", "--allow-empty", "-qm", "next integration");
  const latest = taggedEvidence(repo);
  latest.provenance!.stage = "integrated";
  const newest = importOperational(repo, latest);

  const newer = selectOperationalBaseline(repo, {
    snapshot: newest.snapshot!,
    revision: promoted.revision,
    reason: "Next integrated baseline",
  });

  assert.equal(newer.entry.previous, promoted.entry.id);
  assert.equal(
    JSON.stringify(operationalSnapshot(repo, second.snapshot!)),
    oldBytes,
  );
  assert.equal(operationalBaselines(repo).total, 4);
  assert.equal(
    operationalBaselines(repo).entries[3].evidence.provenance!.stage,
    "worktree",
  );
});

test("suite and routing identity constrain comparison; app builds are explicit source changes", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-provenance-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = makeRepo(dir);
  setPolicy(repo);

  const e = taggedEvidence(repo),
    other = structuredClone(e);

  assert.equal(compareOperational(e, other).comparable, true);
  other.provenance!.suite = "different-suite";
  assert.deepEqual(compareOperational(e, other).mismatches, ["suite"]);
  other.provenance!.suite = e.provenance!.suite;
  other.provenance!.routingHash = "4".repeat(64);
  assert.deepEqual(compareOperational(e, other).mismatches, ["routingHash"]);
  assert.equal(compareOperational(e, other, true).comparable, true);
  other.provenance!.appBuild = "desktop/2.0+42";
  other.imageHash = null;
  assert.ok(operationalEvidence.safeParse(other).success);
  assert.equal(
    compareOperational(e, other, true).changes.some(
      (c) => c.field === "appBuild",
    ),
    true,
  );
  assert.equal(
    operationalEvidence.safeParse({
      ...other,
      provenance: { ...other.provenance, appBuild: null },
    }).success,
    false,
  );
  const legacy = structuredClone(e);
  delete legacy.provenance;
  assert.ok(
    compareOperational(e, legacy).mismatches.includes("provenance version"),
  );
  const imported = importOperational(repo, other);
  const card = operationalMarkdown(imported);
  assert.match(card, /journey-replay-v1/);
  assert.match(card, /desktop\/2.0\+42/);
  assert.match(card, /95.00%/);
  assert.match(card, /worktree/);
});
