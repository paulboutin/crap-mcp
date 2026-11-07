import type { CheckRun } from "./check-history.ts";
import type { Trial } from "./experiments.ts";

function rawComparison(before: CheckRun, after: CheckRun) {
  if (before.policy !== after.policy || before.suite !== after.suite)
    return "Suite or policy changed; aggregate CRAP is not comparable.";

  if (before.metrics?.worst == null || after.metrics?.worst == null)
    return "Paired CRAP measurements unavailable.";

  return `Highest measured CRAP: ${before.metrics.worst.toFixed(2)} → ${after.metrics.worst.toFixed(2)} (${before.metrics.measured}/${before.metrics.total} → ${after.metrics.measured}/${after.metrics.total} functions scored)`;
}

function trialSummary(current: Trial, previous?: Trial) {
  const label = current.name + " · " + current.kind + ": ";

  const lines = [
    label +
      (previous?.status ?? "no matching baseline") +
      " → " +
      current.status,
  ];

  if (current.medianMs !== null) {
    const prior = previous?.medianMs;

    const delta =
      prior == null
        ? ""
        : ` (previous ${prior.toFixed(2)} ms, change ${(current.medianMs - prior).toFixed(2)} ms)`;

    lines.push(
      `Median ${current.medianMs.toFixed(2)} ms across ${current.samples.length} samples` +
        delta,
    );
  }

  if (current.error) lines.push(current.error);

  return lines;
}

export function compareChecks(after: CheckRun, before?: CheckRun) {
  const lines = [
    `Suite ${after.suite}: ${after.tests} · check ${after.outcome}`,
  ];

  if (before)
    lines.push(
      `Before ${before.at} (${before.outcome}, ${before.suite} tests ${before.tests}) → after ${after.at} (${after.outcome})`,
      rawComparison(before, after),
    );
  const prior = before?.trials ?? [];
  const trials = after.trials ?? [];

  for (const trial of trials)
    lines.push(
      ...trialSummary(
        trial,
        prior.find((item) => item.protocol === trial.protocol),
      ),
    );

  const currentProtocols = new Set(trials.map((t) => t.protocol));

  for (const trial of prior.filter(
    (item) => !currentProtocols.has(item.protocol),
  ))
    lines.push(
      trial.name + ": prior workload has no comparable result in this run.",
    );

  if (!trials.length)
    lines.push("No formal QA or benchmark workloads recorded.");

  return lines;
}
