import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { policy, eligible, git, revision, type Repo } from "./files.ts";
import { findings, type Finding, type Health } from "./findings.ts";
import { saved, type Snapshot } from "./scan.ts";

export interface Tracker {
  upsert(
    project: string,
    marker: string,
    title: string,
    body: string,
    number?: number,
  ): number;
  close(project: string, number: number, marker: string): void;
}

const link = z.object({
  project: z.string(),
  id: z.string(),
  number: z.number(),
  file: z.string(),
  commit_id: z.string(),
  branch: z.string(),
  suite: z.string(),
  closed: z.number(),
});

type Link = z.infer<typeof link>;

export function marker(id: string) {
  return "<!-- crap-mcp:" + id + " -->";
}

function confirmed(repo: Repo) {
  const head = revision(repo.root, repo.config.integrationBranch);
  const scan = saved(repo, head);

  if (!scan?.complete || scan.commit !== head || scan.policy !== policy(repo))
    throw Error(
      "Scan a clean integration checkout with the designated suite first",
    );

  return { head, scan };
}

function entry(scan: Snapshot, id: string) {
  const h = scan.rows.find((row) => id.startsWith(row.id + ":"));

  return { h, f: h ? findings(h).find((row) => row.id === id) : undefined };
}

function body(h: Health, f: Finding, head: string) {
  return [
    marker(f.id),
    "\n" + h.file + ":" + h.start + "–" + h.end + " · " + h.symbol,
    "\n" + f.reason,
    "\n" + f.action,
    "\nCheck: " + f.check,
    "\nVerified baseline: " + head,
  ].join("\n");
}

function database(repo: Repo) {
  mkdirSync(repo.store, { recursive: true });

  const db = new DatabaseSync(join(repo.store, "github.sqlite"), {
    timeout: 3000,
  });

  db.exec(
    "CREATE TABLE IF NOT EXISTS links(project TEXT,id TEXT,number INTEGER,file TEXT,commit_id TEXT,branch TEXT,suite TEXT,closed INTEGER,PRIMARY KEY(project,id))",
  );

  return db;
}

function transaction<T>(repo: Repo, work: (db: DatabaseSync) => T) {
  const db = database(repo);

  try {
    db.exec("BEGIN IMMEDIATE");
    const result = work(db);
    db.exec("COMMIT");

    return result;
  } finally {
    db.close();
  }
}

export function publish(
  repo: Repo,
  project: string,
  id: string,
  tracker: Tracker,
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(project))
    throw Error("Use a GitHub owner/repository");

  const { head, scan } = confirmed(repo),
    { h, f } = entry(scan, id);

  if (!h || !f)
    throw Error("Finding is not open on the scanned integration commit");

  return transaction(repo, (db) => {
    const known = db
      .prepare("SELECT number FROM links WHERE project=? AND id=?")
      .get(project, id);

    const number = tracker.upsert(
      project,
      marker(id),
      f.rule + ": " + h.symbol,
      body(h, f, head),
      known ? z.number().parse(known.number) : undefined,
    );

    db.prepare("INSERT OR REPLACE INTO links VALUES(?,?,?,?,?,?,?,0)").run(
      project,
      id,
      number,
      h.file,
      head,
      repo.config.integrationBranch,
      policy(repo),
    );

    return number;
  });
}

function descended(repo: Repo, old: string, head: string) {
  try {
    git(repo.root, "merge-base", "--is-ancestor", old, head);

    return true;
  } catch {
    return false;
  }
}

function resolved(repo: Repo, row: Link, scan: Snapshot) {
  if (
    row.branch !== repo.config.integrationBranch ||
    row.suite !== scan.policy ||
    !eligible(repo, row.file)
  )
    return false;
  const { h, f } = entry(scan, row.id);

  if (f) return false;

  if (!h) return true;

  return !row.id.endsWith(":crap") || h.score !== null;
}

export function sync(repo: Repo, tracker: Tracker) {
  const { head, scan } = confirmed(repo);

  return transaction(repo, (db) => {
    const links = link
      .array()
      .parse(db.prepare("SELECT * FROM links WHERE closed=0").all());

    const closed = [];

    for (const row of links) {
      if (!descended(repo, row.commit_id, head) || !resolved(repo, row, scan))
        continue;
      tracker.close(row.project, row.number, marker(row.id));
      db.prepare("UPDATE links SET closed=1 WHERE project=? AND id=?").run(
        row.project,
        row.id,
      );
      closed.push({ project: row.project, number: row.number, commit: head });
    }

    return closed;
  });
}
