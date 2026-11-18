import {
  operationalPolicy,
  type OperationalEvidence,
} from "../src/operational-schema.ts";
import { operationalPolicyHash } from "../src/operational-store.ts";

export function workloadPolicy() {
  return operationalPolicy.parse({
    version: 1,
    profile: "example-service",
    workload: "catalog-read-v1",
    sourceRules: ["per-call-client", "promise-fanout"],
    maxAgeSeconds: 86400,
    minDurationSeconds: 60,
    confidence: 0.95,
    axes: {
      scalability: [
        {
          id: "capacity",
          label: "Sustainable capacity ratio",
          weight: 1,
          unit: "ratio",
          direction: "higher",
          target: 1.5,
          failureThreshold: 0.5,
          mandatory: true,
          minSamples: 10,
          statistic: "scalar",
        },
      ],
      performance: [
        {
          id: "latency",
          label: "All-attempt latency p95",
          weight: 1,
          unit: "ms",
          direction: "lower",
          target: 100,
          failureThreshold: 500,
          mandatory: true,
          minSamples: 100,
          statistic: "p95",
        },
      ],
      reliability: [
        {
          id: "bad-events",
          label: "Bad-event rate upper bound",
          weight: 1,
          unit: "ratio",
          direction: "lower",
          target: 0.001,
          failureThreshold: 0.01,
          mandatory: true,
          minSamples: 1000,
          statistic: "bad-rate-upper",
        },
      ],
    },
  });
}

export function workloadEvidence(): OperationalEvidence {
  const end = Date.now() - 1000;

  return {
    version: 1,
    repository: "a".repeat(64),
    sourceCommit: "a".repeat(40),
    imageHash: "b".repeat(64),
    configHash: "c".repeat(64),
    policyHash: operationalPolicyHash(workloadPolicy()),
    workload: "catalog-read-v1",
    workloadHash: "d".repeat(64),
    datasetHash: "e".repeat(64),
    harnessVersion: "catalog-replay/1",
    environment: "disposable-fixture",
    deployment: "candidate-a",
    mode: "synthetic",
    resources: [{ name: "cpu", value: 2, unit: "vCPU" }],
    model: null,
    corpusHash: null,
    startedAt: new Date(end - 60000).toISOString(),
    endedAt: new Date(end).toISOString(),
    durationSeconds: 60,
    status: "completed",
    telemetryComplete: true,
    coordinatedOmissionCorrected: true,
    attempts: {
      offered: 2000000,
      accepted: 2000000,
      completed: 2000000,
      errors: 0,
      cancelled: 0,
      incomplete: 0,
    },
    metrics: [
      {
        id: "capacity",
        unit: "ratio",
        population: "active-windows",
        observation: { kind: "scalar", samples: 60, value: 1.5 },
      },
      {
        id: "latency",
        unit: "ms",
        population: "all-attempts",
        observation: {
          kind: "histogram",
          samples: 2000000,
          bins: [
            { upper: 100, count: 1950000 },
            { upper: 1000, count: 50000 },
          ],
        },
      },
      {
        id: "bad-events",
        unit: "ratio",
        population: "all-attempts",
        observation: {
          kind: "bad-rate",
          samples: 2000000,
          bad: 0,
          independentTrials: true,
        },
      },
    ],
    gates: {
      slo: "passed",
      "accepted-data": "passed",
      "external-effects": "passed",
      "privacy-reset": "passed",
    },
    queues: [{ name: "oldest", value: 0, unit: "s" }],
    costBasis: null,
    faults: [
      {
        name: "restart",
        status: "passed",
        recoverySeconds: 2,
        lostAccepted: 0,
        duplicateEffects: 0,
        privacyBypass: false,
      },
    ],
    artifactHash: "f".repeat(64),
    privacy: "content-free-aggregates",
  };
}
