import { z } from "zod";
import { findings, type Health } from "./findings.ts";
import type { Snapshot } from "./scan.ts";
import type { Repo } from "./files.ts";

export const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
};

export const query = z.object({
  ...page,
  path: z.string().optional(),
  rule: z.enum(["crap", "complexity", "nesting", "coverage"]).optional(),
  coverage: z
    .enum([
      "fresh",
      "missing",
      "stale",
      "wrong-suite",
      "insufficient",
      "unscored",
    ])
    .optional(),
  priority: z.enum(["score", "churn", "critical"]).default("score"),
  view: z.enum(["worktree", "integration"]).default("worktree"),
  refresh: z.boolean().default(false),
});

export function slice<T>(rows: T[], offset: number, limit: number) {
  return {
    total: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
    items: rows.slice(offset, offset + limit),
  };
}

function matches(h: Health, q: z.infer<typeof query>) {
  if (q.path && !h.file.startsWith(q.path)) return false;

  if (q.coverage === "unscored") return h.score === null;

  return !q.coverage || h.coverage.status === q.coverage;
}

export function backlog(repo: Repo, s: Snapshot, q: z.infer<typeof query>) {
  const rows = s.rows.flatMap((h) => {
    if (!matches(h, q)) return [];

    const changes = s.churn[h.file] ?? 0,
      critical = repo.config.criticalPaths.some((p) => h.file.startsWith(p));

    return findings(h).flatMap((f) =>
      !q.rule || q.rule === f.rule ? [{ ...h, ...f, changes, critical }] : [],
    );
  });

  rows.sort((a, b) => {
    if (q.priority === "critical" && a.critical !== b.critical)
      return Number(b.critical) - Number(a.critical);

    if (q.priority === "churn" && a.changes !== b.changes)
      return b.changes - a.changes;

    return (
      (b.score ?? -1) - (a.score ?? -1) ||
      b.complexity - a.complexity ||
      a.id.localeCompare(b.id)
    );
  });

  return {
    ...slice(rows, q.offset, q.limit),
    priority: q.priority,
    churn: { scope: "file", days: 90, ref: s.commit },
  };
}

export function lookup(
  rows: Health[],
  file: string,
  symbol?: string,
  line?: number,
) {
  if (!symbol && !line) throw Error("Specify a symbol or a one-based line");
  let hits = rows.filter((r) => r.file === file);

  if (symbol)
    hits = hits.filter(
      (r) => r.symbol === symbol || r.symbol.endsWith("." + symbol),
    );

  if (line)
    hits = hits
      .filter((r) => r.start <= line && r.end >= line)
      .sort((a, b) => a.end - a.start - (b.end - b.start));

  if (!hits.length)
    throw Error("No matching function; inspect scan status for skipped files");

  if (
    hits.length > 1 &&
    (!line || hits[0].end - hits[0].start === hits[1].end - hits[1].start)
  )
    throw Error(
      "Ambiguous function: " +
        hits.map((h) => h.symbol + " at " + h.start).join(", "),
    );

  return hits[0];
}
