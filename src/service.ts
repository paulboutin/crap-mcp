import {
  sessionMarkdown,
  artifactLink,
  type CardFormat,
} from "./markdown-card.ts";
import { backgroundPatterns, savedPatterns } from "./pattern-scan.ts";
import { linkPatterns } from "./pattern-evidence.ts";
import { accessibilityTools } from "./accessibility-tools.ts";
import { securityTools } from "./security-tools.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backlog, lookup, page, query, slice } from "./backlog.ts";
import { fingerprint, receipt } from "./coverage.ts";
import { findings, functionExplanation } from "./findings.ts";
import { policy, maybeRevision, revision, type Repo } from "./files.ts";
import {
  integrationView,
  historical,
  last,
  saved,
  scan,
  type Snapshot,
} from "./scan.ts";
import { saveFindingReport } from "./report-html.ts";
import { codeReport, comparisonReport } from "./code-report.ts";
import { scorecard } from "./scorecard.ts";
import { compareChecks } from "./check-comparison.ts";
import { recentRuns } from "./check-history.ts";
import { sessionSummary, sessionContribution } from "./session.ts";
import { review } from "./review.ts";
import { prepareLanguage, type Routine } from "./syntax.ts";

export class Desk {
  readonly repo: Repo;
  progress = { done: 0, total: 0 };
  cache = new Map<string, Routine[]>();
  latest: Snapshot | undefined;
  active: Promise<Snapshot> | undefined;
  error: string | null = null;
  constructor(repo: Repo, startScan = true) {
    this.repo = repo;
    this.latest = last(repo);

    if (startScan) this.background();
  }
  background() {
    void this.refresh().catch((error) => {
      this.error = String(error);
    });
  }
  refresh() {
    if (!this.active) {
      this.error = null;
      this.active = scan(this.repo, this.progress, this.cache)
        .then((s) => {
          this.latest = s;

          return s;
        })
        .finally(() => {
          this.active = undefined;
        });
    }

    return this.active;
  }
  async current() {
    if (this.active) return this.active;
    const s = this.latest;

    if (
      s &&
      s.policy === policy(this.repo) &&
      s.input === fingerprint(this.repo) &&
      s.run === (receipt(this.repo)?.run ?? null) &&
      s.commit === maybeRevision(this.repo.root, "HEAD")
    )
      return s;

    return this.refresh();
  }
  base(ref?: string, id?: string) {
    if (ref && id)
      throw Error("Choose a starting revision or a snapshot, not both");

    if (!id)
      return historical(
        this.repo,
        revision(this.repo.root, ref ?? this.repo.config.integrationBranch),
      );
    const s = saved(this.repo, id);

    if (!s || s.id !== id) throw Error("Unknown task snapshot");

    if (s.policy !== policy(this.repo))
      throw Error("Analysis policy differs from starting snapshot");

    return s;
  }
}

function meta(s: Snapshot) {
  const { rows, churn: _churn, ...details } = s;

  return { ...details, functions: rows.length };
}

function matchingCheck(
  repo: Repo,
  snapshot: Snapshot,
  runs: ReturnType<typeof recentRuns>,
) {
  const candidate = runs.find((r) => r.run !== null && r.run === snapshot.run);

  if (!candidate?.metrics) return undefined;

  if (candidate.metrics.snapshot === snapshot.id) return candidate;
  // A commit changes the snapshot ID even when the tested inputs are identical.
  const recorded = saved(repo, candidate.metrics.snapshot);

  return recorded?.input === snapshot.input ? candidate : undefined;
}

async function chatReview(
  repo: Repo,
  base: Snapshot,
  now: Snapshot,
  changes: ReturnType<typeof review>,
  showCard: boolean,
  format: CardFormat,
) {
  const report = codeReport(repo.root, now);
  report.review = comparisonReport(
    base,
    changes,
    "snapshot " + base.id.slice(0, 12),
  );
  const summary = report.review.summary!;
  const path = saveFindingReport(repo.local, base.id + "-" + now.id, report);
  const runs = recentRuns(repo);
  const latest = matchingCheck(repo, now, runs);

  const suite =
    "Suite: " +
    now.suite +
    " · run " +
    (now.run ?? "none") +
    " · baseline " +
    base.id.slice(0, 12) +
    " → " +
    now.id.slice(0, 12);

  const checks = latest
    ? compareChecks(latest, matchingCheck(repo, base, runs))
    : [];

  const text =
    format === "markdown"
      ? sessionMarkdown(
          summary,
          changes.unassessed.length,
          latest,
          checks,
          suite,
        ) +
        "\n\n" +
        artifactLink("Detailed report", path)
      : [
          summary.chat,
          suite,
          ...(latest?.trials?.length ? checks : []),
          "Detailed report: " + path,
        ].join("\n");

  const result = { type: "text" as const, text };

  if (!showCard) return { content: [result] };
  const card = await scorecard(repo.local, base.id, now.id, summary, latest);
  result.text +=
    format === "markdown"
      ? "\n\n" + artifactLink("PNG scorecard", card.path)
      : "\nScorecard: " + card.path;

  return { content: [result, card.image] };
}

function reply<T>(value: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

const inspect = z.object({
  file: z.string().min(1),
  symbol: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
});

const changes = z.object({
  scorecard: z
    .boolean()
    .default(false)
    .describe(
      "With chat or markdown format, include a PNG image and its absolute file path.",
    ),
  format: z.enum(["data", "chat", "markdown"]).default("data"),
  ...page,
  base: z.string().min(1).optional(),
  snapshot: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  findingId: z.string().optional(),
});

export function createServer(repo: Repo) {
  const desk = new Desk(repo);

  return analysisServer(() => desk, false);
}

export function analysisServer(select: (id?: string) => Desk, shared: boolean) {
  const server = new McpServer({ name: "crap-score-mcp", version: "0.1.0" });

  const id = z
    .string()
    .min(1)
    .describe("Project ID returned by register_project");

  const scope = { project: shared ? id : z.never().optional() };
  accessibilityTools(server, select, scope);
  securityTools(server, select, scope);

  server.registerTool(
    "scan_code_patterns",
    {
      description:
        "Run advisory TypeScript promise and SwiftLint checks plus the project's Oxlint rules. Returns source lines and enclosing functions even without coverage. Page using the returned pattern snapshot.",
      inputSchema: {
        ...scope,
        ...page,
        snapshot: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      },
    },
    async (q) => {
      const desk = select(q.project);
      const current = q.snapshot ? undefined : await desk.current();

      const snapshot =
        q.snapshot ??
        (await backgroundPatterns(desk.repo, current!.input, current!.id));

      const data = savedPatterns(desk.repo, snapshot);

      if (!data) throw Error("Unknown language-rule snapshot");

      const code =
        current ??
        (data.codeSnapshot ? saved(desk.repo, data.codeSnapshot) : undefined);

      const batch = slice(data.findings, q.offset, q.limit);

      const linked = linkPatterns(
        { ...data, findings: batch.items },
        data.input === code?.input ? code.rows : [],
      )!;

      return reply({
        snapshot,
        notes: data.notes,
        spacing: data.spacing,
        ...batch,
        items: linked.findings,
      });
    },
  );
  server.registerTool(
    "analyze_function_health",
    {
      description:
        "Inspect a symbol in an enabled language by repository-relative path and name or line. Returns measured evidence and matching findings.",
      inputSchema: inspect.extend(scope),
    },
    async (q) => {
      const desk = select(q.project);

      const s = await desk.current(),
        h = lookup(s.rows, q.file, q.symbol, q.line);

      return reply({
        snapshot: meta(s),
        function: h,
        detail: functionExplanation(h),
        findings: findings(h),
      });
    },
  );
  server.registerTool(
    "scan_repository_hotspots",
    {
      description:
        "Rank and page findings. Set refresh for background scan progress; use the snapshot id as a task baseline.",
      inputSchema: query.extend(scope),
    },
    async (q) => {
      const desk = select(q.project);

      if (q.refresh) {
        desk.background();

        return reply({
          status: "scanning",
          progress: desk.progress,
          last: desk.latest ? meta(desk.latest) : null,
        });
      }

      await Promise.all(desk.repo.packs.map(prepareLanguage));

      const baseline =
        q.view === "integration" ? integrationView(desk.repo) : null;

      const s = baseline?.scan ?? (await desk.current());

      return reply({
        status: s.complete ? "complete" : "partial",
        view: q.view,
        baseline: baseline
          ? { status: baseline.status, target: baseline.target }
          : null,
        snapshot: meta(s),
        progress: desk.progress,
        ...backlog(desk.repo, s, q),
      });
    },
  );
  server.registerTool(
    "get_repository_report",
    {
      description:
        "Page through all assessed functions, including acceptable and unscored ones. Pass the first snapshot ID on subsequent pages for a consistent report.",
      inputSchema: z.object({
        ...scope,
        ...page,
        snapshot: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    },
    async (q) => {
      const desk = select(q.project);

      const s = q.snapshot
        ? desk.base(undefined, q.snapshot)
        : await desk.current();

      const section = slice(s.rows, q.offset, q.limit);

      return reply({
        snapshot: meta(s),
        ...section,
        items: section.items.map((h) => ({
          ...h,
          detail: functionExplanation(h),
          findings: findings(h),
        })),
      });
    },
  );
  server.registerTool(
    "review_changes",
    {
      description:
        "Review a session against its starting snapshot or revision. Use format=markdown for a text-only scorecard at completion and show the returned session health and raw CRAP changes in your reply.",
      inputSchema: changes.extend(scope),
    },
    async (q) => {
      const desk = select(q.project);

      const now = await desk.current(),
        base = desk.base(q.base, q.snapshot);

      const result = review(base, now, q.findingId);
      const fullReview = q.findingId ? review(base, now) : result;

      if (q.format !== "data")
        return chatReview(
          desk.repo,
          base,
          now,
          fullReview,
          q.scorecard,
          q.format,
        );

      const affected = slice(result.affected, q.offset, q.limit);

      return reply({
        summary: sessionSummary(fullReview),
        baseline: meta(base),
        current: meta(now),
        scope: "worktree",
        affected: {
          ...affected,
          items: affected.items.map((p) => ({
            ...p,
            contribution: sessionContribution(p),
          })),
        },
        findings: slice(result.findings, q.offset, q.limit),
        unassessed: result.unassessed,
        selected: result.selected,
      });
    },
  );

  return server;
}
