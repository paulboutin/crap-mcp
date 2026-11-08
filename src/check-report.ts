import { linkPatterns } from "./pattern-evidence.ts";
import { savedPatterns } from "./pattern-scan.ts";
import { basename } from "node:path";
import { accessibilityBaseline, accessibilityReport } from "./accessibility.ts";
import { recentRuns } from "./check-history.ts";
import { findings, functionExplanation } from "./findings.ts";
import { saved } from "./scan.ts";
import { securityBaseline, securityReport } from "./security.ts";
import type { Repo } from "./files.ts";

function section<T>(id: string | null | undefined, load: (id: string) => T) {
  if (!id) return { error: "This check recorded no snapshot." };

  try {
    return { data: load(id) };
  } catch {
    return { error: "The snapshot recorded by this check is unavailable." };
  }
}

export function checkReport(repo: Repo, at: string) {
  const run = recentRuns(repo).find((item) => item.at === at);

  if (!run) throw Error("Unknown recorded check");

  const code = section(run.metrics?.snapshot, (id) => {
    const s = saved(repo, id);

    if (!s || s.id !== id) throw Error("Missing function snapshot");

    return s.rows.map((h) => ({
      ...h,
      detail: functionExplanation(h),
      findings: findings(h),
    }));
  });

  const patterns = section(run.patternSnapshot, (id) =>
    savedPatterns(repo, id),
  );

  return {
    patterns: linkPatterns(patterns.data, code.data ?? []),
    check: run.at,
    repository: basename(repo.root),
    outcome: run.outcome,
    note: run.note,
    code,
    thresholds: run.thresholds,
    access: section(run.accessibility?.snapshot, (id) =>
      accessibilityReport(accessibilityBaseline(repo, id)),
    ),
    security: section(run.security?.snapshot, (id) =>
      securityReport(securityBaseline(repo, id)),
    ),
  };
}

export type CheckReport = ReturnType<typeof checkReport>;
