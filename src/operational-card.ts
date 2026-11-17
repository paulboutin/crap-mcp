import type {
  OperationalReport,
  reviewOperational,
} from "./operational-store.ts";

type Axis = OperationalReport["axes"][number];

type Metric = Axis["metrics"][number];

function cell(value: string) {
  return value
    .replace(/[&<>|`*_[\]\\]/g, (c) => "&#" + c.charCodeAt(0) + ";")
    .replace(/\s+/g, " ");
}

function axisRow(a: Axis) {
  const score = a.score === null ? "Unrated" : a.score.toFixed(1) + "/100";

  const bounds =
    a.score === null
      ? a.lower.toFixed(1) + "–" + a.upper.toFixed(1)
      : "Complete";

  return `| ${a.axis} | ${score} | ${a.measured}/${a.total} · ${a.evidencePercent.toFixed(1)}% | ${bounds} | ${cell(a.qualification.state)} |`;
}

function provenance(report: OperationalReport) {
  const e = report.evidence;

  if (!e) return [];
  const a = e.attempts;

  return [
    "",
    `Source: ${e.sourceCommit} · ${cell(e.mode)} / ${cell(e.environment)} · ${cell(e.deployment)}`,
    "",
    `Evidence: ${e.startedAt} → ${e.endedAt} · ${e.durationSeconds}s · harness ${cell(e.harnessVersion)}`,
    "",
    "Integration: " +
      cell(report.integration) +
      ". " +
      (report.sourceMatchesHead
        ? "Source matches HEAD; working-tree edits are not measured."
        : "Evidence source differs from checkout HEAD."),
    "",
    `Harness: ${e.status} · ${a.offered} offered · ${a.accepted} accepted · ${a.completed} completed · ${a.errors} errors · ${a.cancelled} cancelled · ${a.incomplete} incomplete`,
  ];
}

function metricRow(m: Metric) {
  const status =
    m.reasons.join("; ") ||
    (m.meetsTarget === false && m.mandatory
      ? "Mandatory target missed"
      : "Measured");

  return `| ${cell(m.label)} | ${m.raw === null ? "—" : m.raw.toFixed(4)} ${cell(m.unit)} | ${m.target} ${cell(m.unit)} | ${m.samples} | ${cell(status)} |`;
}

function metricTable(report: OperationalReport) {
  return [
    "",
    "| Metric | Observed | Target | Samples | Evidence status |",
    "| :--- | ---: | ---: | ---: | :--- |",
    ...report.axes.flatMap((axis) => axis.metrics.map(metricRow)),
    ...report.axes.flatMap((axis) =>
      axis.qualification.reasons.length
        ? [
            "",
            cell(axis.axis + ": " + axis.qualification.reasons.join("; ")),
            "",
          ]
        : [],
    ),
  ];
}

function comparisonTable(
  c: ReturnType<typeof reviewOperational>["comparison"],
) {
  return [
    "",
    c.comparable
      ? "Comparable evidence contract; changes are observations, not causal attribution."
      : "Not comparable: " + cell(c.mismatches.join(", ")),
    "",
    "| Axis | Before | After | Change |",
    "| :--- | ---: | ---: | ---: |",
    ...c.deltas.map(
      (d) =>
        `| ${d.axis} | ${d.before?.toFixed(1) ?? "Unrated"} | ${d.after?.toFixed(1) ?? "Unrated"} | ${d.change?.toFixed(1) ?? "—"} |`,
    ),
    ...c.changes.flatMap((change) => [
      "",
      cell(change.field + ": " + change.before + " → " + change.after),
    ]),
  ];
}

export function operationalMarkdown(
  report: OperationalReport | ReturnType<typeof reviewOperational>,
) {
  const lines = [
    "## Operational health · three independent axes",
    "",
    "Higher is better · 0–100 · imported evidence",
    "",
    "| Axis | Score | Evidence | Provisional bounds | Qualification |",
    "| :--- | ---: | ---: | :--- | :--- |",
    ...report.axes.map(axisRow),
  ];

  if (!report.axes.length)
    lines.push("| All axes | Unrated | 0 | — | Configure a workload policy | ");
  lines.push(
    "",
    "Workload: " + cell(report.workload ?? "unconfigured"),
    "",
    report.note,
    ...provenance(report),
    ...metricTable(report),
  );

  if ("comparison" in report) lines.push(...comparisonTable(report.comparison));
  lines.push(
    "",
    "Snapshot: " +
      (report.snapshot ?? "none") +
      " · evaluated " +
      report.evaluatedAt,
  );

  return lines.join("\n");
}
