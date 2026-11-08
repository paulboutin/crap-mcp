import { linkPatterns } from "./pattern-evidence.ts";
import { latestPatterns } from "./pattern-scan.ts";
import { dashboardAccessibility } from "./accessibility.ts";
import { dashboardSecurity } from "./security.ts";
import {
  applyPolicy,
  edit,
  languageChange,
  setLanguage,
  qualityPolicy,
} from "./quality-policy.ts";
import {
  learningInput,
  projectEvidence,
  recordLearning,
} from "./project-learning.ts";
import { recentRuns } from "./check-history.ts";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { digest, readJson, repository, writeJson } from "./files.ts";
import { analysisServer, Desk } from "./service.ts";
import { codeReport, comparisonReport } from "./code-report.ts";
import { review } from "./review.ts";
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

  repo(id: string) {
    const root = this.roots.get(id);

    if (!root) throw Error("Unknown project. Use register_project first.");
    const repo = repository(root);

    if (repo.root !== root) throw Error("Registered checkout moved");

    return repo;
  }
  desk(id = "") {
    const repo = this.repo(id);
    const cached = this.desks.get(id);

    if (
      cached &&
      JSON.stringify(cached.repo.omitDirectories) ===
        JSON.stringify(repo.omitDirectories) &&
      JSON.stringify(cached.repo.packs) === JSON.stringify(repo.packs) &&
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

  server.registerTool(
    "get_project_settings",
    {
      description:
        "Read this checkout's lint rules, coverage targets, rule changes and last 30 measured check outcomes before choosing the next change.",
      inputSchema: { project: z.string() },
    },
    ({ project }) => {
      const repo = projects.repo(project);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...qualityPolicy(repo),
              runs: recentRuns(repo),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "set_project_language",
    {
      description:
        "Set one language on the selected checkout using its current settings revision. Enable downloads and verifies only this parser. Optionally enable its already-installed native linter.",
      inputSchema: languageChange,
    },
    async (q) => {
      const state = await setLanguage(projects.repo(q.project), q);

      return { content: [{ type: "text", text: JSON.stringify(state) }] };
    },
  );

  server.registerTool(
    "record_project_learning",
    {
      description:
        "Record what a cleanup changed, the finding, interpretation, and proposed rule. Links two project check timestamps and derives evidence from those checks. A proposed rule is advice until implemented.",
      inputSchema: learningInput,
    },
    (q) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(recordLearning(projects.repo(q.project), q)),
        },
      ],
    }),
  );
  server.registerTool(
    "update_project_settings",
    {
      description:
        "Apply a project policy change with a rationale recorded in the report. Supply current settings and revision.",
      inputSchema: edit.extend({
        project: z.string(),
        reason: z.string().trim().min(1).max(2000),
      }),
    },
    async (q) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await applyPolicy(projects.repo(q.project), q)),
        },
      ],
    }),
  );

  return server;
}

export async function projectReport(
  desk: Desk,
  baseline?: string,
  securitySnapshot?: string,
  accessibilitySnapshot?: string,
): Promise<Report> {
  const current = await desk.current();

  const report: Report = {
    ...codeReport(desk.repo.root, current),
    accessibility: dashboardAccessibility(
      desk.repo,
      accessibilitySnapshot,
      current.commit,
    ),
    security: dashboardSecurity(desk.repo, securitySnapshot, current.commit),
    patterns: linkPatterns(
      latestPatterns(desk.repo, current.input),
      current.rows,
    ),
    evidence: projectEvidence(desk.repo),
  };

  if (!current.commit && !baseline) return report;
  const base = baseline ? desk.base(undefined, baseline) : desk.base("HEAD");
  const changes = review(base, current);
  report.review = comparisonReport(
    base,
    changes,
    baseline ? "task snapshot " + baseline.slice(0, 12) : "HEAD",
  );

  return report;
}
