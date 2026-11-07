import { basename, isAbsolute, join } from "node:path";
import { z } from "zod";
import { digest, readJson, repository, writeJson } from "./files.ts";
import { analysisServer, Desk } from "./service.ts";
import { findings } from "./findings.ts";
import { review } from "./review.ts";
import { sessionSummary } from "./session.ts";
import type { Report } from "./report-view.ts";

export class Projects {
  readonly file: string;
  readonly roots: Map<string, string>;
  readonly desks = new Map<string, Desk>();

  constructor(directory: string) {
    this.file = join(directory, "projects.json");
    const paths = readJson(this.file, z.array(z.string())) ?? [];
    this.roots = new Map(paths.map((root) => [digest(root), root]));
  }

  register(path: string) {
    if (!isAbsolute(path)) throw Error("Pass an absolute Git checkout path");
    const { root } = repository(path);
    const id = digest(root);

    if (!this.roots.has(id)) {
      writeJson(this.file, [...this.roots.values(), root]);
      this.roots.set(id, root);
    }

    return { id, root };
  }

  desk(id = "") {
    const root = this.roots.get(id);

    if (!root) throw Error("Unknown project. Use register_project first.");
    const repo = repository(root);

    if (repo.root !== root) throw Error("Registered checkout moved");
    const cached = this.desks.get(id);

    if (
      cached &&
      JSON.stringify(cached.repo.config) === JSON.stringify(repo.config)
    )
      return cached;
    const desk = new Desk(repo);
    this.desks.set(id, desk);

    return desk;
  }

  list() {
    return [...this.roots].map(([id, root]) => ({ id, root }));
  }
}

export function sharedServer(projects: Projects) {
  const server = analysisServer((id) => projects.desk(id), true);
  server.registerTool(
    "register_project",
    {
      description:
        "Register this chat's absolute Git checkout path. Use the returned project ID on every analysis call.",
      inputSchema: { path: z.string().min(1) },
    },
    ({ path }) => ({
      content: [
        { type: "text", text: JSON.stringify(projects.register(path)) },
      ],
    }),
  );
  server.registerTool(
    "list_projects",
    {
      description: "List registered checkouts and their IDs.",
      inputSchema: {},
    },
    () => ({
      content: [{ type: "text", text: JSON.stringify(projects.list()) }],
    }),
  );

  return server;
}

export async function projectReport(
  desk: Desk,
  baseline?: string,
): Promise<Report> {
  const current = await desk.current();
  const { rows, churn: _churn, ...snapshot } = current;

  const report: Report = {
    repository: basename(desk.repo.root),
    snapshot: { ...snapshot, functions: rows.length },
    functions: rows.map((row) => ({ ...row, findings: findings(row) })),
    review: null,
  };

  if (!current.commit && !baseline) return report;
  const base = baseline ? desk.base(undefined, baseline) : desk.base("HEAD");
  const changes = review(base, current);
  report.review = {
    ref: baseline ? "task snapshot " + baseline.slice(0, 12) : "HEAD",
    commit: base.commit ?? base.id,
    summary: sessionSummary(changes),
    affected: changes.affected.length,
    unassessed: changes.unassessed,
    deltas: changes.findings,
  };

  return report;
}
