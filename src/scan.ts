import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { z } from "zod";
import {
  digest,
  maxSourceBytes,
  policy,
  checkConfig,
  eligible,
  git,
  isMissing,
  maybeRevision,
  nul,
  readJson,
  safeFile,
  workFiles,
  writeJson,
  type Repo,
} from "./files.ts";
import { languageCatalog, languageFor } from "./languages.ts";
import { fingerprint, receipt, type Receipt } from "./coverage.ts";
import { health, healthSchema } from "./findings.ts";
import { parse, prepareLanguage, type Routine } from "./syntax.ts";

import { sourceExcerpt } from "./finding-detail.ts";
import { reconcile } from "./reconcile.ts";

const skipped = z.object({ file: z.string(), reason: z.string() });

const snapshotSchema = z.object({
  id: z.string(),
  commit: z.string().nullable(),
  at: z.string(),
  input: z.string(),
  policy: z.string(),
  suite: z.string(),
  run: z.string().nullable(),
  runAt: z.string().nullable(),
  files: z.number(),
  rows: z.array(healthSchema),
  skipped: z.array(skipped),
  churn: z.record(z.string(), z.number()),
  complete: z.boolean(),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export interface Progress {
  done: number;
  total: number;
}

export function saved(repo: Repo, id: string) {
  if (!/^[0-9a-f]{40,64}$/.test(id)) throw Error("Invalid snapshot ID");

  return readJson(join(repo.store, id + ".json"), snapshotSchema);
}

function churn(repo: Repo) {
  const counts = new Map<string, number>();

  if (!maybeRevision(repo.root, "HEAD")) return {};

  for (const name of nul(
    git(
      repo.root,
      "log",
      "--since=90.days",
      "--format=",
      "--name-only",
      "-z",
      "HEAD",
    ),
  ))
    counts.set(name, (counts.get(name) ?? 0) + 1);

  return Object.fromEntries(counts);
}

function clean(repo: Repo) {
  return git(repo.root, "status", "--porcelain=v1", "-z") === "";
}

function start(
  input: string,
  repo: Repo,
  commit: string | null,
  run?: Receipt,
): Snapshot {
  return {
    id: "",
    commit,
    at: new Date().toISOString(),
    input,
    policy: policy(repo),
    suite: repo.config.suite,
    run: run?.run ?? null,
    runAt: run?.at ?? null,
    files: 0,
    rows: [],
    skipped: [],
    churn: {},
    complete: false,
  };
}

function inspect(
  s: Snapshot,
  file: string,
  source: string,
  cache: Map<string, Routine[]>,
  run?: Receipt,
) {
  const key = languageFor(file)!.version + "\0" + file + "\0" + digest(source);
  const rows = cache.get(key) ?? parse(file, source);

  if (cache.size >= 5000) cache.clear();
  cache.set(key, rows);

  const lines = source.split(/\r?\n/);

  for (const r of rows) {
    const h = health(r, file, s.input, s.suite, run);
    h.excerpt = sourceExcerpt(lines, r.start, r.end);

    if (h.depth >= 4)
      h.deepestExcerpt = sourceExcerpt(lines, h.deepest, h.deepest);

    if (h.coverage.uncovered.length && h.score !== null && h.score > 30)
      h.uncoveredExcerpt = h.coverage.uncovered
        .slice(0, 5)
        .map((line) => sourceExcerpt(lines, line, line))
        .join("\n");
    s.rows.push(h);
  }

  s.files++;
}

function skip(s: Snapshot, file: string, reason: string) {
  s.skipped.push({ file, reason });
}

function finalize(s: Snapshot) {
  s.complete = s.skipped.length === 0;
  s.id = digest(
    JSON.stringify([s.commit, s.suite, s.input, s.run, s.rows, s.skipped]),
  );

  return s;
}

function inspectWorkFile(
  repo: Repo,
  s: Snapshot,
  file: string,
  cache: Map<string, Routine[]>,
  run?: Receipt,
) {
  try {
    inspect(
      s,
      file,
      readFileSync(safeFile(repo.root, file), "utf8"),
      cache,
      run,
    );
  } catch (error) {
    if (!(error instanceof Error && isMissing(error)))
      skip(s, file, String(error));
  }
}

export async function scan(
  repo: Repo,
  progress: Progress,
  cache: Map<string, Routine[]>,
) {
  checkConfig(repo);

  const core = languageCatalog()
    .filter((pack) => pack.core)
    .map((pack) => pack.id);

  await Promise.all([...core, ...repo.packs].map(prepareLanguage));

  const input = fingerprint(repo),
    run = receipt(repo),
    head = maybeRevision(repo.root, "HEAD");

  const wasClean = clean(repo);

  const s = start(input, repo, head, run),
    files = workFiles(repo).filter((f) => eligible(repo, f));

  progress.total = files.length;
  progress.done = 0;

  for (const file of files) {
    await yieldTurn();

    inspectWorkFile(repo, s, file, cache, run);
    progress.done++;
  }

  checkConfig(repo);

  if (input !== fingerprint(repo) || head !== maybeRevision(repo.root, "HEAD"))
    throw Error("Source changed during scan; refresh again");
  s.churn = churn(repo);
  finalize(s);
  writeJson(join(repo.store, s.id + ".json"), s);
  writeJson(join(repo.local, "last.json"), s);

  if (head && wasClean && clean(repo) && s.complete)
    saveBaseline(repo, head, s);

  return s;
}

function saveBaseline(repo: Repo, head: string, s: Snapshot) {
  const old = saved(repo, head);

  // A later launch without coverage must not discard confirmed scores.
  if (
    old?.rows.some((row) => row.score !== null) &&
    !s.rows.some((row) => row.score !== null)
  )
    return;
  writeJson(join(repo.store, head + ".json"), s);

  if (head === maybeRevision(repo.root, repo.config.integrationBranch))
    writeJson(integrationFile(repo), s);
  reconcile(repo, head);
}

export function historical(repo: Repo, commit: string) {
  const known = saved(repo, commit);

  if (known && known.policy === policy(repo)) return known;

  const s = start(commit, repo, commit),
    cache = new Map<string, Routine[]>();

  for (const entry of nul(
    git(repo.root, "ls-tree", "-r", "-l", "-z", commit),
  )) {
    const tab = entry.indexOf("\t"),
      file = entry.slice(tab + 1);

    if (!eligible(repo, file)) continue;
    const [mode, , oid, size] = entry.slice(0, tab).trim().split(/\s+/);

    try {
      if (!["100644", "100755"].includes(mode) || Number(size) > maxSourceBytes)
        throw Error("Not a regular source blob within the 16 MiB limit");
      inspect(s, file, git(repo.root, "cat-file", "blob", oid), cache);
    } catch (error) {
      skip(s, file, String(error));
    }
  }

  return finalize(s);
}

function integrationFile(repo: Repo) {
  return join(
    repo.store,
    "baseline-" +
      digest(repo.config.integrationBranch + policy(repo)) +
      ".json",
  );
}

export function integrationView(repo: Repo) {
  const target = maybeRevision(repo.root, repo.config.integrationBranch);

  if (!target)
    throw Error("Configured integration branch is not available locally");
  const exact = saved(repo, target);

  if (exact && exact.policy === policy(repo))
    return { scan: exact, target, status: "confirmed" };
  const prior = readJson(integrationFile(repo), snapshotSchema);

  if (prior) return { scan: prior, target, status: "last-confirmed" };

  return { scan: historical(repo, target), target, status: "structural-only" };
}

export function last(repo: Repo) {
  return readJson(join(repo.local, "last.json"), snapshotSchema);
}
