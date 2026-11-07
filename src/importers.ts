import { readFileSync, realpathSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";

import { functionHits } from "./function-hits.ts";

export const counts = z.array(
  z.tuple([z.number().int().positive(), z.number().int().nonnegative()]),
);

export type Counts = z.infer<typeof counts>;

export type Lines = Map<string, Map<number, number>>;

function add(lines: Lines, file: string, line: number, hits: number) {
  const rows = lines.get(file) ?? new Map<number, number>();
  rows.set(line, Math.max(hits, rows.get(line) ?? 0));
  lines.set(file, rows);
}

function local(root: string, file: string) {
  const full = resolve(root, file);

  return relative(root, existsSync(full) ? realpathSync(full) : full)
    .split("\\")
    .join("/");
}

export function lcov(root: string, report: string) {
  const lines: Lines = new Map();
  let file = "";

  for (const row of report.split(/\r?\n/)) {
    if (row.startsWith("SF:")) {
      file = local(root, row.slice(3));
      continue;
    }

    if (row === "end_of_record") {
      file = "";
      continue;
    }

    if (!row.startsWith("DA:") || !file) continue;
    const match = /^DA:(\d+),(\d+)(?:,.*)?$/.exec(row);

    if (!match || Number(match[1]) < 1)
      throw Error("Invalid LCOV line count: " + row);
    add(lines, file, Number(match[1]), Number(match[2]));
  }

  return lines;
}

const statement = z.object({
  start: z.object({ line: z.number().int().positive() }),
});

const istanbulFile = z.object({
  path: z.string(),
  statementMap: z.record(z.string(), statement),
  s: z.record(z.string(), z.number().int().nonnegative()),
});

export function istanbul(root: string, report: string) {
  const files = z.record(z.string(), istanbulFile).parse(JSON.parse(report));
  const lines: Lines = new Map();

  for (const entry of Object.values(files)) {
    for (const [key, location] of Object.entries(entry.statementMap)) {
      const hits = entry.s[key];

      if (hits === undefined) throw Error("Missing Istanbul statement counter");
      add(lines, local(root, entry.path), location.start.line, hits);
    }
  }

  return lines;
}

const xcLines = z.array(
  z.object({
    line: z.number().int().positive(),
    isExecutable: z.boolean(),
    executionCount: z.number().int().nonnegative().optional(),
  }),
);

export function xcArchive(root: string, bundle: string) {
  const output = execFileSync(
    "xcrun",
    ["xccov", "view", "--archive", "--json", bundle],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  return xcJson(root, output);
}

export function xcJson(root: string, report: string) {
  const files = z.record(z.string(), xcLines).parse(JSON.parse(report));
  const lines: Lines = new Map();

  for (const [path, rows] of Object.entries(files)) {
    for (const row of rows) {
      if (!row.isExecutable) continue;

      if (row.executionCount === undefined)
        throw Error("Missing xccov execution count");
      add(lines, local(root, path), row.line, row.executionCount);
    }
  }

  return lines;
}

export function importReport(root: string, file: string) {
  if (file.endsWith(".xcresult"))
    return { lines: xcArchive(root, file), functions: {} };
  const report = readFileSync(file, "utf8");

  if (file.endsWith(".json"))
    return { lines: istanbul(root, report), functions: {} };

  return { lines: lcov(root, report), functions: functionHits(root, report) };
}
