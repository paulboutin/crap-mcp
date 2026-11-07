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
  writeJson(
    join(
      repo.local,
      "checks",
      run.at.replaceAll(":", "-") + "-" + randomUUID() + ".json",
    ),
    run,
  );
}

export function recentRuns(repo: Repo): CheckRun[] {
  const dir = join(repo.local, "checks");

  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 30)
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
}
