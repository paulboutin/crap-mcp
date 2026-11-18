import {
  operationalAxes,
  gateNames,
  type OperationalPolicy,
  type OperationalEvidence,
  type MetricPolicy,
  type MetricEvidence,
  type OperationalAxis,
} from "./operational-schema.ts";

export function normalized(m: MetricPolicy, observed: number) {
  const ratio =
    (observed - m.failureThreshold) / (m.target - m.failureThreshold);

  return Math.max(0, Math.min(1, ratio));
}

// One-sided Hoeffding bound for independent Bernoulli trials. Conservative,
// distribution-free; never substitutes a zero observed rate for uncertainty.
export function badRateUpper(bad: number, samples: number, confidence: number) {
  return Math.min(
    1,
    bad / samples + Math.sqrt(Math.log(1 / (1 - confidence)) / (2 * samples)),
  );
}

function percentile(
  d: Extract<MetricEvidence["observation"], { kind: "histogram" }>,
  quantile: number,
) {
  let seen = 0;

  for (const bin of d.bins) {
    seen += bin.count;

    if (seen >= Math.ceil(d.samples * quantile)) return bin.upper;
  }

  throw Error("Histogram has no quantile");
}

function observed(m: MetricPolicy, e: MetricEvidence, confidence: number) {
  const d = e.observation;

  if (m.statistic === "scalar" && d.kind === "scalar") return d.value;

  if (m.statistic === "bad-rate-upper" && d.kind === "bad-rate")
    return badRateUpper(d.bad, d.samples, confidence);

  if (d.kind === "histogram" && m.statistic === "p95")
    return percentile(d, 0.95);

  if (d.kind === "histogram" && m.statistic === "p99")
    return percentile(d, 0.99);

  return null;
}

export function evidenceProblems(
  p: OperationalPolicy,
  e: OperationalEvidence,
  now: number,
) {
  const reasons: string[] = [];

  if (e.status !== "completed") reasons.push("Harness " + e.status);

  if (!e.telemetryComplete) reasons.push("Incomplete telemetry");

  if (!e.coordinatedOmissionCorrected)
    reasons.push("Coordinated omission not accounted for");

  if (!e.attempts.offered) reasons.push("No offered attempts");

  if (e.durationSeconds < p.minDurationSeconds)
    reasons.push("Collection window too short");

  if (Date.parse(e.endedAt) > now) reasons.push("Evidence is in the future");

  if (now - Date.parse(e.endedAt) > p.maxAgeSeconds * 1000)
    reasons.push("Stale evidence");

  return reasons;
}

function metricProblems(
  m: MetricPolicy,
  found: MetricEvidence | undefined,
  problems: string[],
) {
  const reasons = [...problems];

  if (!found) reasons.push("Missing metric");
  else {
    if (found.unit !== m.unit) reasons.push("Incompatible units");

    if (found.observation.samples < m.minSamples)
      reasons.push("Insufficient samples");

    if (found.population === "successful-attempts")
      reasons.push(
        "Successful attempts alone exclude slow, failed or incomplete work",
      );
  }

  return reasons;
}

function metricResult(
  m: MetricPolicy,
  e: OperationalEvidence | null,
  confidence: number,
  problems: string[],
) {
  const found = e?.metrics.find((item) => item.id === m.id);
  const reasons = metricProblems(m, found, problems);
  const raw = found ? observed(m, found, confidence) : null;

  if (found && raw === null) reasons.push("Incompatible statistic");
  const valid = !reasons.length && raw !== null;

  return {
    id: m.id,
    label: m.label,
    weight: m.weight,
    unit: m.unit,
    target: m.target,
    mandatory: m.mandatory,
    samples: found?.observation.samples ?? 0,
    raw,
    quality: valid ? normalized(m, raw!) : null,
    reasons,
    meetsTarget: valid
      ? m.direction === "lower"
        ? raw! <= m.target
        : raw! >= m.target
      : null,
  };
}

function integrityFailures(e: OperationalEvidence) {
  const failures = gateNames.filter((name) => e.gates[name] === "failed");

  const faults = e.faults.flatMap((f) => {
    const reasons: string[] = [];

    if (f.status === "failed") reasons.push("Fault failed: " + f.name);

    if (f.lostAccepted) reasons.push("Accepted-data loss: " + f.name);

    if (f.duplicateEffects)
      reasons.push("Duplicate external effects: " + f.name);

    if (f.privacyBypass) reasons.push("Privacy/reset bypass: " + f.name);

    return reasons;
  });

  return [...failures, ...faults];
}

function pendingQualification(
  e: OperationalEvidence,
  rows: ReturnType<typeof metricResult>[],
  axis: OperationalAxis,
) {
  const pending = gateNames.filter((name) => e.gates[name] === "unmeasured");

  if (axis === "reliability" && !e.faults.length) pending.push("accepted-data");
  const missing = rows.filter((r) => r.quality === null);

  if (
    !rows.length ||
    missing.length ||
    pending.length ||
    e.faults.some((f) => f.status === "unmeasured")
  )
    return ["Missing eligible metrics or gate evidence", ...pending];

  return [];
}

function qualification(
  e: OperationalEvidence | null,
  rows: ReturnType<typeof metricResult>[],
  axis: OperationalAxis,
) {
  if (!e) return { state: "unmeasured", reasons: ["No evidence imported"] };
  const failures = integrityFailures(e);

  if (failures.length) return { state: "blocked", reasons: failures };
  const failed = rows.filter((r) => r.mandatory && r.meetsTarget === false);

  if (failed.length)
    return {
      state: "measured-below-target",
      reasons: failed.map((r) => r.id + " misses mandatory target"),
    };

  const pending = pendingQualification(e, rows, axis);

  if (pending.length) return { state: "unmeasured", reasons: pending };

  return { state: "target-qualified", reasons: [] };
}

function axisScore(
  axis: OperationalAxis,
  p: OperationalPolicy,
  e: OperationalEvidence | null,
  problems: string[],
) {
  const metrics = p.axes[axis].map((m) =>
    metricResult(m, e, p.confidence, problems),
  );

  let contribution = 0,
    weight = 0;

  for (const m of metrics) {
    if (m.quality !== null) {
      contribution += m.weight * m.quality;
      weight += m.weight;
    }
  }

  const complete =
    metrics.length > 0 && metrics.every((m) => m.quality !== null);

  const lower = Math.max(0, Math.min(100, contribution * 100));
  const upper = Math.min(100, lower + 100 * Math.max(0, 1 - weight));

  return {
    axis,
    score: complete ? lower : null,
    lower,
    upper,
    evidencePercent: Math.min(100, weight * 100),
    measured: metrics.filter((m) => m.quality !== null).length,
    total: metrics.length,
    qualification: qualification(e, metrics, axis),
    metrics,
  };
}

export function operationalScores(
  p: OperationalPolicy,
  e: OperationalEvidence | null,
  problems: string[] = [],
  now = Date.now(),
) {
  const reasons = e
    ? [...problems, ...evidenceProblems(p, e, now)]
    : ["No evidence imported"];

  return operationalAxes.map((axis) => axisScore(axis, p, e, reasons));
}

function compareProvenance(
  before: OperationalEvidence,
  after: OperationalEvidence,
  allowConfigChange: boolean,
) {
  const a = before.provenance,
    b = after.provenance;

  const mismatches: string[] = [];

  if (Boolean(a) !== Boolean(b)) mismatches.push("provenance version");

  if (a?.suite !== b?.suite) mismatches.push("suite");

  if (!allowConfigChange && a?.routingHash !== b?.routingHash)
    mismatches.push("routingHash");

  const changes = (
    ["appBuild", "routingHash", "sourceTreeHash", "stage"] as const
  ).flatMap((field) =>
    a?.[field] === b?.[field]
      ? []
      : [{ field, before: a?.[field] ?? null, after: b?.[field] ?? null }],
  );

  return { mismatches, changes };
}

export function compareOperational(
  before: OperationalEvidence,
  after: OperationalEvidence,
  allowConfigChange = false,
) {
  const fields = [
    "repository",
    "policyHash",
    "workload",
    "workloadHash",
    "datasetHash",
    "harnessVersion",
    "environment",
    "mode",
    "model",
    "corpusHash",
    "durationSeconds",
    "costBasis",
  ] as const;

  const mismatches: string[] = fields.filter(
    (key) => before[key] !== after[key],
  );

  if (before.attempts.offered !== after.attempts.offered)
    mismatches.push("offered attempts");

  const cohorts = (e: OperationalEvidence) =>
    JSON.stringify(
      e.metrics
        .map((m) => [m.id, m.population])
        .sort((a, b) => a[0].localeCompare(b[0])),
    );

  if (cohorts(before) !== cohorts(after)) mismatches.push("metric populations");

  const faults = (e: OperationalEvidence) =>
    JSON.stringify(e.faults.map((f) => f.name).sort());

  if (faults(before) !== faults(after)) mismatches.push("fault cases");

  const resources = (e: OperationalEvidence) =>
    JSON.stringify(
      [...e.resources].sort((a, b) => a.name.localeCompare(b.name)),
    );

  if (resources(before) !== resources(after)) mismatches.push("resources");

  if (!allowConfigChange && before.configHash !== after.configHash)
    mismatches.push("configHash");

  const changes = (
    ["sourceCommit", "imageHash", "deployment", "configHash"] as const
  ).flatMap((key) =>
    before[key] === after[key]
      ? []
      : [{ field: key, before: before[key], after: after[key] }],
  );

  const provenance = compareProvenance(before, after, allowConfigChange);
  mismatches.push(...provenance.mismatches);

  return {
    comparable: !mismatches.length,
    mismatches,
    changes: [...changes, ...provenance.changes],
  };
}
