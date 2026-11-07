import { saved } from "./scan.ts";
import { review } from "./review.ts";
import { sessionSummary } from "./session.ts";
import { z } from "zod";
import { compareChecks } from "./check-comparison.ts";
import { recentRuns, type CheckRun } from "./check-history.ts";
import {
  qualityPolicy,
  saveCapture,
  saveLesson,
  observation,
} from "./quality-policy.ts";
import type { Repo } from "./files.ts";
import type { Desk } from "./service.ts";
import { findings } from "./findings.ts";

export const learningInput = observation.extend({
  project: z.string(),
  revision: z.string(),
});

function learningEvidence(repo: Repo, before: CheckRun, after: CheckRun) {
  const evidence = compareChecks(after, before);

  if (before.metrics && after.metrics && before.policy === after.policy) {
    const base = saved(repo, before.metrics.snapshot);
    const end = saved(repo, after.metrics.snapshot);

    if (base && end) evidence.push(sessionSummary(review(base, end)).chat);
  }

  return evidence;
}

export function recordLearning(
  repo: Repo,
  input: z.infer<typeof learningInput>,
) {
  const runs = recentRuns(repo);
  const before = runs.find((run) => run.at === input.before);
  const after = runs.find((run) => run.at === input.after);

  if (!before || !after || before.at >= after.at)
    throw Error("Choose two recorded project checks in chronological order.");

  const lesson = {
    ...observation.parse(input),
    beforeSnapshot: before.metrics?.snapshot ?? null,
    afterSnapshot: after.metrics?.snapshot ?? null,
    beforeCommit: before.commit,
    afterCommit: after.commit,
    evidence: learningEvidence(repo, before, after),
  };

  saveLesson(repo, input.revision, lesson);

  return lesson;
}

export async function shareProject(desk: Desk, revision: string) {
  const snapshot = await desk.current();

  const items = snapshot.rows.flatMap((row) =>
    findings(row).map((f) => ({
      id: f.id,
      file: row.file,
      symbol: row.symbol,
      reason: f.reason,
    })),
  );

  return saveCapture(desk.repo, revision, {
    snapshot: snapshot.id,
    at: snapshot.at,
    complete: snapshot.complete,
    findings: items,
  });
}

export function projectEvidence(repo: Repo) {
  const { changes, lessons, capture } = qualityPolicy(repo);
  const [latest, previous] = recentRuns(repo);

  return {
    checks: latest
      ? [latest.at + " · " + latest.note, ...compareChecks(latest, previous)]
      : [],
    changes,
    lessons,
    capture,
  };
}
