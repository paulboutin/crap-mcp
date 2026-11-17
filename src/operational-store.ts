import { join } from "node:path";
import { z } from "zod";
import {
  digest,
  git,
  readJson,
  revision,
  maybeRevision,
  writeJson,
  type Repo,
} from "./files.ts";
import { qualityPolicy } from "./quality-policy.ts";
import {
  hash,
  operationalEvidence,
  operationalPolicy,
  operationalAxes,
  type OperationalEvidence,
  type OperationalPolicy,
  type MetricEvidence,
  type MetricPolicy,
} from "./operational-schema.ts";
import { compareOperational, operationalScores } from "./operational-score.ts";

export function operationalRepository(repo: Repo) {
  try {
    return digest(
      git(repo.root, "remote", "get-url", "origin")
        .trim()
        .replace(/\.git$/, ""),
    );
  } catch {
    return digest(repo.store);
  }
}

export function operationalPolicyHash(p: OperationalPolicy) {
  return digest(JSON.stringify(operationalPolicy.parse(p)));
}

const stored = z
  .object({
    version: z.literal(1),
    id: hash,
    importedAt: z.iso.datetime(),
    policy: operationalPolicy,
    evidence: operationalEvidence,
  })
  .strict();

export type OperationalSnapshot = z.infer<typeof stored>;

function validatePopulation(item: MetricEvidence, e: OperationalEvidence) {
  const d = item.observation;

  if (item.population === "all-attempts") {
    if (d.samples !== e.attempts.offered - e.attempts.cancelled)
      throw Error(
        "Metric sample count must include every non-cancelled initial attempt",
      );

    if (
      d.kind === "bad-rate" &&
      d.bad < e.attempts.errors + e.attempts.incomplete
    )
      throw Error("Bad events omit errors or incomplete attempts");
  }
}

function validateMetric(
  spec: MetricPolicy,
  item: MetricEvidence,
  e: OperationalEvidence,
) {
  if (item.unit !== spec.unit) throw Error("Unit mismatch: " + item.id);

  if (item.unit === "usd/operation" && !e.costBasis)
    throw Error("Cost requires a cost basis");
  const d = item.observation;

  const kinds = {
    scalar: "scalar",
    p95: "histogram",
    p99: "histogram",
    "bad-rate-upper": "bad-rate",
  };

  if (kinds[spec.statistic] !== d.kind)
    throw Error("Statistic mismatch: " + item.id);

  validatePopulation(item, e);
}

function metricContract(p: OperationalPolicy, e: OperationalEvidence) {
  const metrics = operationalAxes.flatMap((axis) => p.axes[axis]);

  for (const item of e.metrics) {
    const spec = metrics.find((m) => m.id === item.id);

    if (!spec) throw Error("Unknown operational metric: " + item.id);

    validateMetric(spec, item, e);

    if (
      p.axes.reliability.some((m) => m.id === item.id) &&
      item.observation.kind !== "bad-rate" &&
      item.population !== "fault-trials"
    )
      throw Error(
        "Reliability requires confidence-bounded rates or explicit fault trials",
      );
  }
}

export function importOperational(repo: Repo, input: OperationalEvidence) {
  const evidence = operationalEvidence.parse(input);
  const policy = qualityPolicy(repo).settings.operational;

  if (!policy)
    throw Error(
      "Configure an operational workload policy before importing evidence",
    );

  if (evidence.repository !== operationalRepository(repo))
    throw Error("Evidence belongs to another repository");

  if (
    evidence.policyHash !== operationalPolicyHash(policy) ||
    evidence.workload !== policy.workload
  )
    throw Error("Evidence policy/workload mismatch");

  if (revision(repo.root, evidence.sourceCommit) !== evidence.sourceCommit)
    throw Error("Expected an exact source commit");

  if (Date.parse(evidence.endedAt) > Date.now())
    throw Error("Cannot import future evidence");
  metricContract(policy, evidence);
  const id = digest(JSON.stringify([policy, evidence]));
  const prior = readJson(join(repo.local, "operational", id + ".json"), stored);

  const snapshot = prior ?? {
    version: 1 as const,
    id,
    importedAt: new Date().toISOString(),
    policy,
    evidence,
  };

  if (!prior)
    writeJson(join(repo.local, "operational", id + ".json"), snapshot);
  writeJson(join(repo.local, "operational", "latest.json"), { id });

  return operationalReport(repo, id);
}

export function operationalSnapshot(repo: Repo, id: string) {
  hash.parse(id);
  const found = readJson(join(repo.local, "operational", id + ".json"), stored);

  if (
    !found ||
    found.id !== id ||
    digest(JSON.stringify([found.policy, found.evidence])) !== id
  )
    throw Error("Unknown or altered operational snapshot for this checkout");

  return found;
}

function integrationState(repo: Repo, source: string) {
  const integration = maybeRevision(repo.root, repo.config.integrationBranch);

  if (!integration) return "integration reference unavailable";

  try {
    git(repo.root, "merge-base", "--is-ancestor", source, integration);

    return "source included in integration revision";
  } catch {
    return "candidate source; integration rerun required";
  }
}

function reportPolicy(repo: Repo, snapshot: OperationalSnapshot | null) {
  const current = qualityPolicy(repo).settings.operational;
  const policy = current ?? snapshot?.policy ?? null;
  const problems: string[] = [];

  if (
    snapshot &&
    (!current ||
      operationalPolicyHash(current) !== snapshot.evidence.policyHash)
  )
    problems.push("Current policy differs from evidence policy");

  return { policy, problems };
}

function reportSource(repo: Repo, source: string | null) {
  return {
    sourceMatchesHead:
      source !== null && source === maybeRevision(repo.root, "HEAD"),
    integration: source ? integrationState(repo, source) : "unmeasured",
  };
}

function selectedSnapshot(repo: Repo, id?: string) {
  const latest =
    id ??
    readJson(
      join(repo.local, "operational", "latest.json"),
      z.object({ id: hash }),
    )?.id;

  return latest ? operationalSnapshot(repo, latest) : null;
}

export function operationalReport(repo: Repo, id?: string) {
  const snapshot = selectedSnapshot(repo, id);
  const { policy, problems } = reportPolicy(repo, snapshot);

  return {
    snapshot: snapshot?.id ?? null,
    repository: operationalRepository(repo),
    workload: policy?.workload ?? null,
    policyHash: policy ? operationalPolicyHash(policy) : null,
    policy,
    evidence: snapshot?.evidence ?? null,
    evaluatedAt: new Date().toISOString(),
    problems,
    ...reportSource(repo, snapshot?.evidence.sourceCommit ?? null),
    axes: policy
      ? operationalScores(policy, snapshot?.evidence ?? null, problems)
      : [],
    note: "Imported observations describe only their declared workload and source/deployment. Scores do not run tests or prove production capacity.",
  };
}

export type OperationalReport = ReturnType<typeof operationalReport>;

export function reviewOperational(
  repo: Repo,
  before: string,
  after: string,
  allowConfigChange = false,
) {
  const left = operationalSnapshot(repo, before),
    right = operationalSnapshot(repo, after);

  const comparison = compareOperational(
    left.evidence,
    right.evidence,
    allowConfigChange,
  );

  const previous = operationalReport(repo, before),
    current = operationalReport(repo, after);

  return {
    ...current,
    comparison: {
      ...comparison,
      before,
      deltas: current.axes.map((axis, i) => ({
        axis: axis.axis,
        before: previous.axes[i]?.score ?? null,
        after: axis.score,
        change:
          comparison.comparable &&
          axis.score !== null &&
          previous.axes[i]?.score != null
            ? axis.score - previous.axes[i].score!
            : null,
      })),
    },
  };
}
