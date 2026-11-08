import { sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { CheckRun } from "./check-history.ts";
import type { sessionSummary } from "./session.ts";
import type { AccessibilityReport } from "./accessibility.ts";
import type { SecurityReport } from "./security.ts";
import { trialStatus } from "./scorecard.ts";

export type CardFormat = "chat" | "markdown";

// Repository-controlled names and tool output must stay literal in the transcript.
function literal(value: string) {
  const line = stripVTControlCharacters(value).replace(/\s+/gu, " ").trim();
  const runs = line.match(/`+/g) ?? [];

  const fence = "`".repeat(
    1 + runs.reduce((n, run) => Math.max(n, run.length), 0),
  );

  return fence + " " + line + " " + fence;
}

export function artifactLink(label: string, path: string) {
  const target = path
    .split(sep)
    .map((part) =>
      encodeURIComponent(part).replaceAll("(", "%28").replaceAll(")", "%29"),
    )
    .join("/");

  return "[" + label + "](" + target + ")";
}

function headline(title: string, grade: string) {
  if (grade.startsWith("Unrated") || grade.startsWith("Not applicable"))
    return "⚪ **" + title + " · " + grade + "**";

  if (grade.includes("provisional"))
    return "🟡 **" + title + " · " + grade + "**";

  return "🔵 **" + title + " · " + grade + "**";
}

function bullet(label: string, value: string) {
  return "- **" + label + ":** " + value;
}

export function sessionMarkdown(
  summary: ReturnType<typeof sessionSummary>,
  unassessed: number,
  latest: CheckRun | undefined,
  checks: string[],
  provenance: string,
) {
  const lines = [
    headline("Session health", summary.rating),
    "",
    bullet(
      "Evidence",
      summary.measured +
        "/" +
        summary.total +
        " remaining affected functions scored · " +
        summary.removed +
        " removed · " +
        unassessed +
        " files unassessed",
    ),
    bullet("Finding changes", summary.changes),
    bullet("QA replays", trialStatus(latest, "qa")) +
      " · **Benchmarks:** " +
      trialStatus(latest, "benchmark"),
  ];

  if (summary.examples.length)
    lines.push(
      "",
      "**Function CRAP** · lower is better; high above 30",
      "",
      ...summary.examples.map((example) => "- " + literal(example)),
    );

  if (checks.length)
    lines.push(
      "",
      "**Recorded checks**",
      "",
      ...checks.map((item) => "- " + literal(item)),
    );
  lines.push("", literal(provenance));

  return lines.join("\n");
}

export function securityMarkdown(r: SecurityReport) {
  return [
    headline("Application security", r.headline),
    "",
    bullet("Evidence", r.detail),
    bullet("Comparison", r.comparisonText),
    bullet(
      "Scope",
      r.rules.length +
        " enabled source rules · OWASP Top 10:2025 · " +
        r.version,
    ),
    "",
    "Higher scores indicate fewer findings in assessed source. This scan does not certify security.",
    "",
    "Snapshot: " + literal(r.snapshot),
  ].join("\n");
}

export function accessMarkdown(r: AccessibilityReport, color: string) {
  const lines = [
    headline("Accessibility", r.headline),
    "",
    bullet("Evidence", r.detail + " · " + r.scope),
    bullet("Color vision", color),
    bullet("Comparison", r.comparisonText),
  ];

  if (r.reason) lines.push(bullet("Rating evidence", r.reason));
  lines.push(
    "",
    "WCAG 2.2 and Revised Section 508 · source checks only.",
    "",
    "Snapshot: " + literal(r.snapshot),
  );

  return lines.join("\n");
}
