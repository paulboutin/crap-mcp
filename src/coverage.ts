import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  digest,
  readJson,
  type Repo,
  safeFile,
  workFiles,
  isMissing,
  supported,
} from "./files.ts";
import { counts, type Counts } from "./importers.ts";
import type { Routine } from "./syntax.ts";

export const receiptSchema = z.object({
  suite: z.string(),
  snapshot: z.string(),
  run: z.string(),
  at: z.string(),
  files: z.record(z.string(), counts),
});

export type Receipt = z.infer<typeof receiptSchema>;

export function receipt(repo: Repo) {
  return readJson(join(repo.local, "coverage.json"), receiptSchema);
}

export function fingerprint(repo: Repo) {
  const parts: string[] = [];

  for (const file of workFiles(repo)) {
    if (
      !supported(file) &&
      !/(?:^|\/)(?:\.crap\.json|[^/]*lock[^/]*|Package\.swift|[^/]*\.(?:js|jsx|mjs|cjs|json))$/.test(
        file,
      )
    )
      continue;

    try {
      parts.push(file + "\0" + digest(readFileSync(safeFile(repo.root, file))));
    } catch (error) {
      if (!(error instanceof Error && isMissing(error)))
        parts.push(file + "\0unreadable");
    }
  }

  return digest(JSON.stringify(parts));
}

export interface Evidence {
  status: "fresh" | "missing" | "stale" | "wrong-suite" | "insufficient";
  covered: number | null;
  executable: number | null;
  percent: number | null;
  uncovered: number[];
}

function absent(status: Evidence["status"]): Evidence {
  return {
    status,
    covered: null,
    executable: null,
    percent: null,
    uncovered: [],
  };
}

function measure(rows: Counts, r: Routine): Evidence {
  const owned = rows.filter(
    ([line]) =>
      line >= r.start &&
      line <= r.end &&
      !r.omit.some(([from, to]) => line >= from && line <= to),
  );

  if (!owned.length) return absent("insufficient");
  const uncovered = owned.flatMap(([line, hits]) => (hits === 0 ? [line] : []));
  const covered = owned.length - uncovered.length;

  return {
    status: "fresh",
    covered,
    executable: owned.length,
    percent: (100 * covered) / owned.length,
    uncovered,
  };
}

export function evidence(
  r: Routine,
  file: string,
  snapshot: string,
  suite: string,
  run?: Receipt,
) {
  if (!run) return absent("missing");

  if (run.suite !== suite) return absent("wrong-suite");

  if (snapshot !== run.snapshot) return absent("stale");

  const rows = run.files[file];

  return rows ? measure(rows, r) : absent("missing");
}

export function score(complexity: number, percent: number) {
  return complexity ** 2 * (1 - percent / 100) ** 3 + complexity;
}
