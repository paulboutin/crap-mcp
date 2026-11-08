import { basename } from "node:path";
import { findings, functionExplanation } from "./findings.ts";
import { sessionSummary, sessionContribution } from "./session.ts";
import type { review } from "./review.ts";
import type { Snapshot } from "./scan.ts";
import type { Report } from "./report-view.ts";

export function codeReport(root: string, current: Snapshot): Report {
  const { rows, churn: _churn, ...snapshot } = current;

  return {
    repository: basename(root),
    snapshot: { ...snapshot, functions: rows.length },
    functions: rows.map((row) => ({
      ...row,
      findings: findings(row),
      detail: functionExplanation(row),
    })),
    review: null,
  };
}

export function comparisonReport(
  base: Snapshot,
  changes: ReturnType<typeof review>,
  ref: string,
) {
  return {
    ref,
    commit: base.commit ?? base.id,
    summary: sessionSummary(changes),
    affected: changes.affected.length,
    contributions: changes.affected.map(sessionContribution),
    unassessed: changes.unassessed,
    deltas: changes.findings,
  };
}
