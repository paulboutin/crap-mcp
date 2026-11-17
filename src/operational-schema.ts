import { z } from "zod";

export const operationalAxes = [
  "scalability",
  "performance",
  "reliability",
] as const;

export const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().trim().min(1).max(200);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const value = z.number().nonnegative().max(1e15);

export const unit = z.enum([
  "ms",
  "s",
  "ratio",
  "count",
  "bytes",
  "usd/operation",
]);

export const gateNames = [
  "slo",
  "accepted-data",
  "external-effects",
  "privacy-reset",
] as const;

const gate = z.enum(["passed", "failed", "unmeasured"]);

export const metricPolicy = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    label,
    weight: z.number().positive().max(1),
    unit,
    direction: z.enum(["lower", "higher"]),
    target: value,
    failureThreshold: value,
    mandatory: z.boolean(),
    minSamples: count.min(1),
    statistic: z.enum(["scalar", "p95", "p99", "bad-rate-upper"]),
  })
  .strict()
  .refine(
    (m) =>
      m.direction === "lower"
        ? m.target < m.failureThreshold
        : m.target > m.failureThreshold,
    "Target and failure threshold must be distinct and ordered for the direction",
  )
  .refine(
    (m) =>
      m.statistic !== "bad-rate-upper" ||
      (m.unit === "ratio" &&
        m.direction === "lower" &&
        m.failureThreshold <= 1),
    "Bad-event bounds require a lower-is-better ratio between zero and one",
  );

const axisPolicy = z
  .array(metricPolicy)
  .max(40)
  .refine((metrics) => {
    return !metrics.length || metrics.some((m) => m.mandatory);
  }, "A configured axis needs a mandatory SLO")
  .refine(
    (metrics) =>
      !metrics.length ||
      Math.abs(metrics.reduce((sum, m) => sum + m.weight, 0) - 1) < 1e-9,
    "Each configured axis must have weights summing to one",
  );

export const operationalPolicy = z
  .object({
    version: z.literal(1),
    profile: label,
    sourceRules: z
      .array(z.enum(["per-call-client", "promise-fanout"]))
      .max(2)
      .default([]),
    workload: label,
    maxAgeSeconds: z.number().int().positive().max(31536000),
    minDurationSeconds: z.number().positive().max(31536000),
    confidence: z.number().min(0.9).max(0.9999),
    axes: z
      .object({
        scalability: axisPolicy,
        performance: axisPolicy,
        reliability: axisPolicy,
      })
      .strict(),
  })
  .strict()
  .refine((p) => {
    const ids = operationalAxes.flatMap((axis) =>
      p.axes[axis].map((m) => m.id),
    );

    return new Set(ids).size === ids.length;
  }, "Metric IDs must be unique across axes");

export type OperationalPolicy = z.infer<typeof operationalPolicy>;

export type MetricPolicy = z.infer<typeof metricPolicy>;

export type OperationalAxis = (typeof operationalAxes)[number];

export const attemptCounts = z
  .object({
    offered: count,
    accepted: count,
    completed: count,
    errors: count,
    cancelled: count,
    incomplete: count,
  })
  .strict()
  .refine(
    (c) =>
      c.accepted <= c.offered &&
      c.completed <= c.accepted &&
      c.completed + c.errors + c.cancelled + c.incomplete === c.offered,
    "All initial attempts must have exactly one outcome; retries cannot inflate offered counts",
  );

const histogram = z
  .array(z.object({ upper: value, count }).strict())
  .min(1)
  .max(2048)
  .refine((bins) => {
    return bins.every((b, i) => i === 0 || b.upper > bins[i - 1].upper);
  }, "Histogram upper bounds must strictly increase");

const scalar = z
  .object({ kind: z.literal("scalar"), value, samples: count.min(1) })
  .strict();

const distribution = z
  .object({
    kind: z.literal("histogram"),
    bins: histogram,
    samples: count.min(1),
  })
  .strict()
  .refine((d) => {
    return d.bins.reduce((sum, b) => sum + b.count, 0) === d.samples;
  }, "Histogram count must equal samples");

const badRate = z
  .object({
    kind: z.literal("bad-rate"),
    bad: count,
    samples: count.min(1),
    independentTrials: z.literal(true),
  })
  .strict()
  .refine((d) => d.bad <= d.samples, "Bad events cannot exceed trials");

export const metricEvidence = z
  .object({
    id: label,
    unit,
    population: z.enum([
      "all-attempts",
      "successful-attempts",
      "active-windows",
      "fault-trials",
    ]),
    observation: z.discriminatedUnion("kind", [scalar, distribution, badRate]),
  })
  .strict();

const resource = z.object({ name: label, value, unit: label }).strict();

export const operationalEvidence = z
  .object({
    version: z.literal(1),
    repository: hash,
    sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
    imageHash: hash,
    configHash: hash,
    policyHash: hash,
    workload: label,
    workloadHash: hash,
    datasetHash: hash,
    harnessVersion: label,
    environment: label,
    deployment: label,
    mode: z.enum(["synthetic", "local", "staging", "production"]),
    resources: z.array(resource).min(1).max(50),
    model: label.nullable(),
    corpusHash: hash.nullable(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    durationSeconds: z.number().positive(),
    status: z.enum(["completed", "failed", "incomplete"]),
    telemetryComplete: z.boolean(),
    coordinatedOmissionCorrected: z.boolean(),
    attempts: attemptCounts,
    metrics: z.array(metricEvidence).max(120),
    gates: z
      .object({
        slo: gate,
        "accepted-data": gate,
        "external-effects": gate,
        "privacy-reset": gate,
      })
      .strict(),
    queues: z.array(resource).max(50),
    costBasis: label.nullable(),
    faults: z
      .array(
        z
          .object({
            name: label,
            status: gate,
            recoverySeconds: value.nullable(),
            lostAccepted: count,
            duplicateEffects: count,
            privacyBypass: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    artifactHash: hash,
    privacy: z.literal("content-free-aggregates"),
  })
  .strict()
  .refine((e) => {
    return new Set(e.faults.map((f) => f.name)).size === e.faults.length;
  }, "Duplicate fault cases")
  .refine((e) => {
    return new Set(e.metrics.map((m) => m.id)).size === e.metrics.length;
  }, "Duplicate metric IDs")
  .refine((e) => {
    return new Set(e.resources.map((r) => r.name)).size === e.resources.length;
  }, "Duplicate resource names")
  .refine(
    (e) =>
      Math.abs(
        (Date.parse(e.endedAt) - Date.parse(e.startedAt)) / 1000 -
          e.durationSeconds,
      ) < 0.001,
    "Duration must match the positive collection interval",
  );

export type OperationalEvidence = z.infer<typeof operationalEvidence>;

export type MetricEvidence = z.infer<typeof metricEvidence>;
