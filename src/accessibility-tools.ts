import {
  accessMarkdown,
  artifactLink,
  type CardFormat,
} from "./markdown-card.ts";
import {
  measurePair,
  survives,
  rgbHex,
  colorExplanation,
} from "./color-contrast.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { slice } from "./backlog.ts";
import type { Desk } from "./service.ts";
import { sourceTools } from "./source-tools.ts";
import {
  accessibilityScan,
  accessibilityBaseline,
  accessibilityReport,
  type AccessibilityReport,
} from "./accessibility.ts";
import { saveFindingReport } from "./report-html.ts";
import { saveCard } from "./scorecard.ts";

function paged(r: AccessibilityReport, offset: number, limit: number) {
  const c = r.comparison;

  return {
    ...r,
    colors: slice(r.colors, offset, limit),
    passedChecks: slice(r.passedChecks, offset, limit),
    findings: slice(r.findings, offset, limit),
    pending: slice(r.pending, offset, limit),
    skipped: slice(r.skipped, offset, limit),
    comparison: c && {
      ...c,
      baselineColors: slice(c.baselineColors, offset, limit),
      introduced: slice(c.introduced, offset, limit),
      resolved: slice(c.resolved, offset, limit),
    },
  };
}

async function chat(
  r: AccessibilityReport,
  dir: string,
  card: boolean,
  format: CardFormat,
) {
  const colorScore =
    r.colorblind.score === null ? "Unrated" : r.colorblind.score + "/100";

  const colorEvidence =
    r.colorblind.passed +
    "/" +
    r.colorblind.measured +
    " measured pairs pass all three simulations";

  const color = "Colorblind score · " + colorScore + " · " + colorEvidence;

  const message = {
    type: "text" as const,
    text: [
      "Accessibility source checks · " + r.headline,
      r.reason,
      r.detail,
      r.scope,
      color,
      r.comparisonText,
      "WCAG 2.2 and Revised Section 508 mappings · source evidence only",
      "Snapshot: " + r.snapshot,
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const key =
    "accessibility-" + (r.comparison?.snapshot ?? "current") + "-" + r.snapshot;

  const report = saveFindingReport(dir, key, {
    sourceSnapshot: r.snapshot,
    accessibility: r,
  });

  message.text =
    format === "markdown"
      ? accessMarkdown(r, colorScore, colorEvidence) +
        "\n\n" +
        artifactLink("Detailed report", report)
      : message.text + "\nDetailed report: " + report;

  if (!card) return { content: [message] };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="310"><rect width="720" height="310" rx="16" fill="#193e36"/><g font-family="sans-serif" fill="white">
    <text x="28" y="38" font-size="20">Accessibility · WCAG and Section 508 source checks</text>
    <text x="28" y="99" font-size="50" font-weight="bold">${r.headline}</text><text x="28" y="134" font-size="19">${r.detail}</text>
    <text x="28" y="166" font-size="18">${r.scope}</text><text x="28" y="197" font-size="17">${r.comparisonText}</text>
    <text x="28" y="232" font-size="17" fill="#fff">${color}</text>
    <text x="28" y="278" font-size="16" fill="#c8e9dd">${r.reason ?? "Percentage of evaluated source checks that passed"} · v1</text></g></svg>`;

  const saved = await saveCard(dir, key, svg);

  message.text +=
    format === "markdown"
      ? "\n\n" + artifactLink("PNG scorecard", saved.path)
      : "\nScorecard: " + saved.path;

  return { content: [message, saved.image] };
}

export function accessibilityTools(
  server: McpServer,
  select: (id?: string) => Desk,
  scope: { project: z.ZodString | z.ZodOptional<z.ZodNever> },
) {
  server.registerTool(
    "analyze_accessibility_color_pair",
    {
      description:
        "Check sampled opaque sRGB foreground and background colors for ordinary text, large text or a meaningful UI boundary, including three color vision simulations.",
      inputSchema: z.object({
        ...scope,
        foreground: rgbHex,
        background: rgbHex,
        usage: z.enum(["text", "large-text", "ui-boundary"]).default("text"),
      }),
    },
    (q) => {
      select(q.project);

      const pair = measurePair(
        q.foreground,
        q.background,
        q.usage === "text" ? 4.5 : 3,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...pair,
              detail: colorExplanation({
                file: "MCP input",
                line: 0,
                element: q.usage,
                pair,
              }).detail,
              passes: pair.ratio >= pair.threshold,
              colorblindScore: survives(pair) ? 100 : 0,
            }),
          },
        ],
      };
    },
  );
  sourceTools(
    "accessibility",
    {
      scan: accessibilityScan,
      load: accessibilityBaseline,
      data: (offset, limit, now, before) =>
        paged(accessibilityReport(now, before), offset, limit),
      chat: (dir, card, now, format, before) =>
        chat(accessibilityReport(now, before), dir, card, format),
    },
    server,
    select,
    scope,
  );
}
