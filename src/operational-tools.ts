import { saveFindingReport } from "./report-html.ts";
import { artifactLink } from "./markdown-card.ts";
import type { OperationalReport } from "./operational-store.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Desk } from "./service.ts";
import { hash, operationalEvidence } from "./operational-schema.ts";
import {
  importOperational,
  operationalReport,
  reviewOperational,
} from "./operational-store.ts";
import { operationalMarkdown } from "./operational-card.ts";
import { scanOperationalRisks } from "./operational-risks.ts";

function reportText(
  report: OperationalReport | ReturnType<typeof reviewOperational>,
  directory: string,
) {
  const key =
    "operational-" +
    ("comparison" in report ? report.comparison.before + "-" : "") +
    (report.snapshot ?? "unmeasured");

  const path = saveFindingReport(directory, key, {
    sourceSnapshot: report.snapshot ?? "none",
    operational: report,
  });

  return (
    operationalMarkdown(report) + "\n\n" + artifactLink("Detailed report", path)
  );
}

export function operationalTools(
  server: McpServer,
  select: (id?: string) => Desk,
  scope: { project: z.ZodString | z.ZodOptional<z.ZodNever> },
) {
  server.registerTool(
    "import_operational_evidence",
    {
      description:
        "Validate and store content-free workload aggregates. Does not run load or fault tests. Configure settings.operational first. Import failed harnesses truthfully; they remain unmeasured.",
      inputSchema: { ...scope, evidence: operationalEvidence },
    },
    (q) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            importOperational(select(q.project).repo, q.evidence),
          ),
        },
      ],
    }),
  );
  server.registerTool(
    "get_operational_scorecard",
    {
      description:
        "Read Scalability, Performance and Reliability separately for an imported workload. Missing evidence stays unrated. Returns repository/policy hashes for import. Never starts tests.",
      inputSchema: {
        ...scope,
        snapshot: hash.optional(),
        format: z.enum(["data", "markdown"]).default("markdown"),
      },
    },
    (q) => {
      const report = operationalReport(select(q.project).repo, q.snapshot);

      return {
        content: [
          {
            type: "text",
            text:
              q.format === "markdown"
                ? reportText(report, select(q.project).repo.local)
                : JSON.stringify(report),
          },
        ],
      };
    },
  );
  server.registerTool(
    "review_operational_changes",
    {
      description:
        "Compare two immutable operational imports from this checkout. Incompatible contracts produce no score delta. Config changes need explicit acknowledgement. Source/image/deployment changes are listed; rerun on integration.",
      inputSchema: {
        ...scope,
        before: hash,
        after: hash,
        allowConfigChange: z.boolean().default(false),
        format: z.enum(["data", "markdown"]).default("markdown"),
      },
    },
    (q) => {
      const report = reviewOperational(
        select(q.project).repo,
        q.before,
        q.after,
        q.allowConfigChange,
      );

      return {
        content: [
          {
            type: "text",
            text:
              q.format === "markdown"
                ? reportText(report, select(q.project).repo.local)
                : JSON.stringify(report),
          },
        ],
      };
    },
  );
  server.registerTool(
    "scan_operational_risks",
    {
      description:
        "Advisory TypeScript/JavaScript source patterns with verification recipes. Does not measure latency, throughput or reliability. Save the returned snapshot; source omissions remain explicit.",
      inputSchema: { ...scope },
    },
    (q) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(scanOperationalRisks(select(q.project).repo)),
        },
      ],
    }),
  );
}
