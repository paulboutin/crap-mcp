import {
  securityMarkdown,
  artifactLink,
  type CardFormat,
} from "./markdown-card.ts";
import { sourceTools } from "./source-tools.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { slice } from "./backlog.ts";
import type { Desk } from "./service.ts";
import {
  securityBaseline,
  securityReport,
  securityScan,
  type SecurityReport,
} from "./security.ts";
import { saveFindingReport } from "./report-html.ts";
import { saveCard } from "./scorecard.ts";

function paged(r: SecurityReport, offset: number, limit: number) {
  const c = r.comparison;

  return {
    ...r,
    findings: slice(r.findings, offset, limit),
    skipped: slice(r.skipped, offset, limit),
    comparison: c && {
      ...c,
      introduced: slice(c.introduced, offset, limit),
      resolved: slice(c.resolved, offset, limit),
    },
  };
}

async function securityChat(
  r: SecurityReport,
  directory: string,
  card: boolean,
  format: CardFormat,
) {
  const text = {
    type: "text" as const,
    text: [
      "Application security · " + r.headline + " · " + r.version,
      r.detail,
      r.comparisonText,
      r.rules.length +
        " enabled source rules · OWASP Top 10:2025 mapping · higher is better; not a security certification.",
      "Snapshot: " + r.snapshot,
    ].join("\n"),
  };

  const key =
    "security-" + (r.comparison?.snapshot ?? "current") + "-" + r.snapshot;

  const report = saveFindingReport(directory, key, {
    sourceSnapshot: r.snapshot,
    security: r,
  });

  text.text =
    format === "markdown"
      ? securityMarkdown(r) + "\n\n" + artifactLink("Detailed report", report)
      : text.text + "\nDetailed report: " + report;

  if (!card) return { content: [text] };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="245">
    <rect width="720" height="245" rx="16" fill="#172e48"/><g font-family="sans-serif" fill="#fff">
    <text x="28" y="40" font-size="19">Application security · OWASP-mapped source checks</text>
    <text x="28" y="103" font-size="52" font-weight="bold">${r.headline}</text>
    <text x="28" y="145" font-size="20">${r.detail}</text><text x="28" y="179" font-size="18">${r.comparisonText}</text>
    <text x="28" y="217" font-size="16" fill="#bfd6ee">appsec-1 · ${r.rules.length} enabled rules · Higher is better within the assessed scope</text></g></svg>`;

  const saved = await saveCard(directory, key, svg);

  text.text +=
    format === "markdown"
      ? "\n\n" + artifactLink("PNG scorecard", saved.path)
      : "\nScorecard: " + saved.path;

  return { content: [text, saved.image] };
}

export function securityTools(
  server: McpServer,
  select: (id?: string) => Desk,
  scope: { project: z.ZodString | z.ZodOptional<z.ZodNever> },
) {
  sourceTools(
    "security",
    {
      scan: securityScan,
      load: securityBaseline,
      data: (offset, limit, now, before) =>
        paged(securityReport(now, before), offset, limit),
      chat: (dir, card, now, format, before) =>
        securityChat(securityReport(now, before), dir, card, format),
    },
    server,
    select,
    scope,
  );
}
