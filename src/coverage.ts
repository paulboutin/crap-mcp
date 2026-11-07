import { adapter } from "./languages.ts";
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
  functions: z.record(z.string(), counts).optional(),
  files: z.record(z.string(), counts),
});

export type Receipt = z.infer<typeof receiptSchema>;

export function receipt(repo: Repo) {
  return readJson(join(repo.local, "coverage.json"), receiptSchema);
}

export function fingerprint(repo: Repo) {
  const parts: string[] = [
    ...repo.packs.map((id) => adapter(id).version),
    ...repo.omitDirectories.map((path) => "omit:" + path),
  ];

  for (const file of workFiles(repo)) {
    if (
      !supported(file, repo.packs) &&
      !/(?:^|\/)(?:\.crap\.json|[^/]*lock[^/]*|Package\.swift|pyproject\.toml|Cargo\.toml|go\.(?:mod|sum)|requirements[^/]*\.txt|[^/]*\.(?:js|jsx|mjs|cjs|json))$/.test(
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
  basis?: "function-entry";
  reason?: "shared-line" | "no-lines";
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

  if (!owned.length)
    return {
      ...absent("insufficient"),
      reason:
        r.start === r.end && r.omit.length > 0
          ? ("shared-line" as const)
          : ("no-lines" as const),
    };
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

function measured(rows: Counts, r: Routine, counters?: Counts): Evidence {
  if (r.callbackCounter && rows.some(([line]) => line === r.start)) {
    const hit = counters?.find(([line]) => line === r.start);

    if (hit) {
      const covered = Number(hit[1] > 0);

      return {
        status: "fresh",
        basis: "function-entry",
        covered,
        executable: 1,
        percent: 100 * covered,
        uncovered: covered ? [] : [r.start],
      };
    }
  }

  return measure(rows, r);
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

  return rows ? measured(rows, r, run.functions?.[file]) : absent("missing");
}

export function score(complexity: number, percent: number) {
  return complexity ** 2 * (1 - percent / 100) ** 3 + complexity;
}
