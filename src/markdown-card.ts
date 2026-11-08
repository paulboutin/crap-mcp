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
  let marker = "🔵";

  if (grade.startsWith("Unrated") || grade.startsWith("Not applicable"))
    marker = "⚪";
  else if (grade.includes("provisional")) marker = "🟡";

  return `## ${marker} ${grade} · ${title}`;
}

// A table pipe is structural even inside a GFM code span.
function symbolCell(symbol: string) {
  return symbol.split("|").map(literal).join("\\|");
}

function deltaCell(delta: number | null) {
  if (delta === null) return "—";

  if (delta === 0) return "0.00";

  return (delta > 0 ? "↑ +" : "↓ −") + Math.abs(delta).toFixed(2);
}

function checkLabel(state = "unmeasured") {
  if (state === "passed") return "✅ Passed";

  if (state === "failed") return "❌ Failed";

  return "⚪ " + state.charAt(0).toUpperCase() + state.slice(1);
}

export function sessionMarkdown(
  summary: ReturnType<typeof sessionSummary>,
  unassessed: number,
  latest: CheckRun | undefined,
  checks: string[],
) {
  const lines = [
    headline("Session health", summary.rating),
    "",
    "| Functions scored | Test suite | QA replays | Benchmarks |",
    "| ---: | :--- | :--- | :--- |",
    `| **${summary.measured}/${summary.total}** | ${checkLabel(latest?.tests)} | ${trialStatus(latest, "qa")} | ${trialStatus(latest, "benchmark")} |`,
    "",
    `**Project check** ${checkLabel(latest?.outcome)} · **Finding changes** ${summary.changes}`,
    "",
    `Functions removed **${summary.removed}** · Files unassessed **${unassessed}**`,
  ];

  if (summary.functions.length) {
    lines.push(
      "",
      "### Function CRAP",
      "",
      "| Function | Before | After | Change |",
      "| :--- | ---: | ---: | ---: |",
      ...summary.functions.map(
        (h) =>
          `| ${symbolCell(h.symbol)} | ${h.before} | **${h.after}** | ${deltaCell(h.delta)} |`,
      ),
      "",
      "Lower is better · high above 30",
    );
  }

  if (latest && latest.outcome !== "passed")
    lines.push(
      "",
      "### Check details",
      "",
      ...checks.map((item) => "- " + literal(item)),
    );

  return lines.join("\n");
}

export function securityMarkdown(r: SecurityReport) {
  return [
    headline("Application security", r.headline),
    "",
    "| Files assessed | Unassessed | Findings | Rules |",
    "| ---: | ---: | ---: | ---: |",
    `| **${r.assessed}** | ${r.skipped.length} | **${r.findings.length}** | ${r.rules.length} |`,
    "",
    r.score === null ? r.detail : "",
    "**Comparison** · " + r.comparisonText,
    "",
    `OWASP Top 10:2025 · ${r.version} · assessed source only`,
    "",
    "Snapshot " + literal(r.snapshot),
  ].join("\n");
}

export function accessMarkdown(
  r: AccessibilityReport,
  colorScore: string,
  colorEvidence: string,
) {
  const lines = [
    headline("Accessibility", r.headline),
    "",
    "| Passed | Failed | Need review |",
    "| ---: | ---: | ---: |",
    `| **${r.passed}** | **${r.findings.length}** | ${r.pending.length} |`,
    "",
    r.scope,
    "",
    "### " + colorScore + " · Colorblind score",
    "",
    colorEvidence,
    "",
    "**Comparison** · " + r.comparisonText,
  ];

  if (r.reason) lines.push("", r.reason);
  lines.push(
    "",
    "WCAG 2.2 and Revised Section 508 · source checks only.",
    "",
    "Snapshot " + literal(r.snapshot),
  );

  return lines.join("\n");
}
