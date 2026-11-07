import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backlog, lookup, page, query, slice } from "./backlog.ts";
import { fingerprint, receipt } from "./coverage.ts";
import { findings } from "./findings.ts";
import { policy, maybeRevision, revision, type Repo } from "./files.ts";
import {
  integrationView,
  historical,
  last,
  saved,
  scan,
  type Snapshot,
} from "./scan.ts";
import { sessionSummary } from "./session.ts";
import { review } from "./review.ts";
import type { Routine } from "./syntax.ts";

export class Desk {
  readonly repo: Repo;
  progress = { done: 0, total: 0 };
  cache = new Map<string, Routine[]>();
  latest: Snapshot | undefined;
  active: Promise<Snapshot> | undefined;
  error: string | null = null;
  constructor(repo: Repo) {
    this.repo = repo;
    this.latest = last(repo);
    this.background();
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

function reply<T>(value: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

const inspect = z.object({
  file: z.string().min(1),
  symbol: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
});

const changes = z.object({
  format: z.enum(["data", "chat"]).default("data"),
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

  server.registerTool(
    "analyze_function_health",
    {
      description:
        "Inspect a TypeScript or Swift symbol by repository-relative path and name or line. Returns measured evidence and matching findings.",
      inputSchema: inspect.extend(scope),
    },
    async (q) => {
      const desk = select(q.project);

      const s = await desk.current(),
        h = lookup(s.rows, q.file, q.symbol, q.line);

      return reply({ snapshot: meta(s), function: h, findings: findings(h) });
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
        items: section.items.map((h) => ({ ...h, findings: findings(h) })),
      });
    },
  );
  server.registerTool(
    "review_changes",
    {
      description:
        "Review a session against its starting snapshot or revision. Use format=chat at completion and show the returned session health and raw CRAP changes in your reply.",
      inputSchema: changes.extend(scope),
    },
    async (q) => {
      const desk = select(q.project);

      const now = await desk.current(),
        base = desk.base(q.base, q.snapshot);

      const result = review(base, now, q.findingId);
      const summary = sessionSummary(q.findingId ? review(base, now) : result);

      if (q.format === "chat")
        return {
          content: [
            {
              type: "text" as const,
              text:
                summary.chat +
                "\nSuite: " +
                now.suite +
                " · run " +
                (now.run ?? "none") +
                " · baseline " +
                base.id.slice(0, 12) +
                " → " +
                now.id.slice(0, 12),
            },
          ],
        };

      return reply({
        summary,
        baseline: meta(base),
        current: meta(now),
        scope: "worktree",
        affected: slice(result.affected, q.offset, q.limit),
        findings: slice(result.findings, q.offset, q.limit),
        unassessed: result.unassessed,
        selected: result.selected,
      });
    },
  );

  return server;
}
