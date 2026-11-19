import type { Trial } from "./experiments.ts";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJson, type Repo } from "./files.ts";
import type { Snapshot } from "./scan.ts";
import type { Targets } from "./quality-policy.ts";

export function measurements(s: Snapshot, targets: Targets) {
  const measured = s.rows.filter((h) => h.score !== null);
  const scores = measured.map((h) => h.score!);
  const worst = scores.reduce((highest, value) => Math.max(highest, value), 0);

  const belowCoverage = measured.filter(
    (h) => h.coverage.percent! < targets.minCoverage,
  ).length;

  const covered = measured.reduce((n, h) => n + h.coverage.covered!, 0);
  const executable = measured.reduce((n, h) => n + h.coverage.executable!, 0);

  return {
    covered,
    executable,
    snapshot: s.id,
    measured: measured.length,
    total: s.rows.length,
    skipped: s.skipped.length,
    worst: measured.length ? worst : null,
    overCrap: scores.filter((value) => value > targets.maxCrap).length,
    belowCoverage,
  };
}

export interface CheckRun {
  attempt?: string;
  checkpoint?: number;
  phase?: string;
  completedAt?: string;
  runtime?: { executable: string; version: string; architecture: string };
  patternSnapshot?: string;
  thresholds?: { maxCrap: number; minCoverage: number };
  accessibility?: ReturnType<
    typeof import("./accessibility.ts").accessibilityCheck
  >;
  security?: ReturnType<typeof import("./security.ts").securityCheck>;
  trials?: Trial[];
  at: string;
  note: string;
  commit: string | null;
  suite: string;
  policy: string;
  run: string | null;
  lint: {
    files: number;
    violations: number;
    rules: Record<string, number>;
    error: string | null;
  };
  tools: { name: string; status: number | null; error: string | null }[];
  tests: string;
  error: string | null;
  metrics: ReturnType<typeof measurements> | null;
  outcome: "passed" | "failed" | "incomplete";
}

export function saveRun(repo: Repo, run: CheckRun) {
  if (run.attempt) run.checkpoint = (run.checkpoint ?? 0) + 1;

  const checkpoint = run.attempt
    ? String(run.checkpoint).padStart(6, "0") + "-"
    : "";

  writeJson(
    join(
      repo.local,
      "checks",
      run.at.replaceAll(":", "-") + "-" + checkpoint + randomUUID() + ".json",
    ),
    run,
  );
}

export function recentRuns(repo: Repo): CheckRun[] {
  const dir = join(repo.local, "checks");

  if (!existsSync(dir)) return [];

  const attempts = new Set<string>();

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")))
    .filter((run: CheckRun) => {
      if (!run.attempt) return true;

      if (attempts.has(run.attempt)) return false;
      attempts.add(run.attempt);

      return true;
    })
    .slice(0, 30);
}
