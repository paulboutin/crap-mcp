import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";
import { safeFile, type Repo } from "./files.ts";
import type { OxDiagnostic } from "./pattern-oxlint.ts";
import type { Health } from "./findings.ts";

interface Guidance {
  [rule: string]: readonly [string, string] | undefined;
}

const advice: Guidance = {
  "typescript(no-floating-promises)": [
    "A rejection may go unhandled or work may finish after the caller returns.",
    "Await or return the promise, or handle rejection deliberately. Test the rejected path.",
  ],
  "typescript(no-misused-promises)": [
    "The caller may expect a synchronous value or ignore an async callback's rejection.",
    "Check the callback contract or await the condition. Test both success and rejection.",
  ],
  force_try: [
    "A thrown error here terminates the process.",
    "Handle the error or document the invariant and test what happens when it fails.",
  ],
  force_cast: [
    "An unexpected runtime type can crash the app.",
    "Use a conditional cast or enforce the type earlier. Test an unexpected value.",
  ],
  weak_delegate: [
    "A strong delegate reference can keep an object alive if the delegate retains its owner.",
    "Check ownership; use a weak, class-bound delegate when appropriate and verify deallocation.",
  ],
};

const finding = z.object({
  tool: z.string(),
  rule: z.string(),
  file: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  message: z.string(),
  impact: z.string().optional(),
  action: z.string(),
  excerpt: z.string(),
});

export const patternData = z.object({
  input: z.string(),
  codeSnapshot: z.string().optional(),
  policy: z.string(),
  notes: z.array(z.string()),
  spacing: z.number(),
  findings: z.array(finding),
});

export type PatternData = z.infer<typeof patternData>;

type Match = z.infer<typeof finding>;

type Owner = Pick<Health, "id" | "symbol" | "file" | "start" | "end">;

export class PatternSink {
  readonly data: PatternData;
  readonly root: string;
  private lines = new Map<string, string[]>();

  constructor(repo: Repo, input: string, policy: string) {
    this.root = repo.root;
    this.data = { input, policy, notes: [], spacing: 0, findings: [] };
  }

  add(item: Omit<Match, "excerpt">) {
    const file = relative(this.root, resolve(this.root, item.file));
    let lines = this.lines.get(file);

    if (!lines) {
      try {
        lines = readFileSync(safeFile(this.root, file), "utf8").split(/\r?\n/);
      } catch {
        lines = [];
      }

      if (this.lines.size >= 8) this.lines.clear();
      this.lines.set(file, lines);
    }

    const excerpt = lines[(item.line ?? 0) - 1]?.trim().slice(0, 400) ?? "";
    const guide = advice[item.rule];
    this.data.findings.push({
      ...item,
      file,
      excerpt,
      impact: guide?.[0],
      action: guide?.[1] ?? item.action,
    });
  }

  ox(item: OxDiagnostic) {
    const rule = item.code ?? "diagnostic";

    if (rule === "anti-slop(require-readable-spacing)") {
      this.data.spacing++;

      return;
    }

    const span = item.labels[0]?.span;
    this.add({
      tool: "Oxlint",
      rule,
      file: item.filename,
      line: span?.line ?? null,
      column: span?.column ?? null,
      message: item.message,
      action: item.help ?? "",
    });
  }
}

export function linkPatterns(data: PatternData | undefined, rows: Owner[]) {
  if (!data) return undefined;
  const files = new Map<string, Owner[]>();

  for (const row of rows) {
    const group = files.get(row.file) ?? [];
    group.push(row);
    files.set(row.file, group);
  }

  for (const group of files.values())
    group.sort((a, b) => a.end - a.start - (b.end - b.start));

  return {
    ...data,
    findings: data.findings.map((item) => {
      const owner = ownerAt(files.get(item.file) ?? [], item.line);

      return {
        ...item,
        owner: owner?.id ?? null,
        symbol: owner?.symbol ?? null,
      };
    }),
  };
}

function ownerAt(rows: Owner[], line: number | null) {
  if (line === null) return;
  const hits = rows.filter((row) => row.start <= line && row.end >= line);
  const [first, second] = hits;

  if (second && second.end - second.start === first.end - first.start) return;

  return first;
}

export type PatternReport = NonNullable<ReturnType<typeof linkPatterns>>;
