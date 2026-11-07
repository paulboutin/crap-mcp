import { z } from "zod";
import { digest } from "./files.ts";
import { evidence, score, type Receipt } from "./coverage.ts";
import type { Routine } from "./syntax.ts";

const coverage = z.object({
  basis: z.literal("function-entry").optional(),
  reason: z.enum(["shared-line", "no-lines"]).optional(),
  status: z.enum(["fresh", "missing", "stale", "wrong-suite", "insufficient"]),
  covered: z.number().nullable(),
  executable: z.number().nullable(),
  percent: z.number().nullable(),
  uncovered: z.array(z.number()),
});

export const healthSchema = z.object({
  id: z.string(),
  file: z.string(),
  symbol: z.string(),
  start: z.number(),
  end: z.number(),
  hash: z.string(),
  complexity: z.number(),
  depth: z.number(),
  deepest: z.number(),
  coverage,
  score: z.number().nullable(),
  risk: z.enum(["acceptable", "high", "critical"]).nullable(),
});

export type Health = z.infer<typeof healthSchema>;

export function health(
  r: Routine,
  file: string,
  snapshot: string,
  suite: string,
  run?: Receipt,
): Health {
  const c = evidence(r, file, snapshot, suite, run);
  const value = c.percent === null ? null : score(r.complexity, c.percent);

  return {
    id: digest(JSON.stringify([file, r.symbol])).slice(0, 20),
    file,
    symbol: r.symbol,
    start: r.start,
    end: r.end,
    hash: r.hash,
    complexity: r.complexity,
    depth: r.depth,
    deepest: r.deepest,
    coverage: c,
    score: value,
    risk: band(value),
  };
}

function band(n: number | null) {
  if (n === null) return null;

  if (n > 60) return "critical";

  return n > 30 ? "high" : "acceptable";
}

export type Rule = "crap" | "complexity" | "nesting" | "coverage";

export interface Finding {
  id: string;
  rule: Rule;
  value: number;
  reason: string;
  action: string;
  check: string;
}

export function findings(h: Health) {
  const rows: Finding[] = [];

  function add(
    rule: Rule,
    value: number,
    reason: string,
    action: string,
    check: string,
  ) {
    rows.push({ id: h.id + ":" + rule, rule, value, reason, action, check });
  }

  if (h.score !== null && h.score > 30)
    add(
      "crap",
      h.score,
      `CRAP ${h.score.toFixed(2)}; ${h.coverage.covered}/${h.coverage.executable} measured lines covered.`,
      "Inspect uncovered lines and add a behavior test, or simplify a decision.",
      "Rerun the designated suite and verify CRAP ≤ 30.",
    );

  if (h.complexity >= 10)
    add(
      "complexity",
      h.complexity,
      `${h.complexity} independent paths under the configured counting policy.`,
      "Separate an independent decision into a named function.",
      "Recheck complexity < 10 and verify the behavior tests.",
    );

  if (h.depth >= 4)
    add(
      "nesting",
      h.depth,
      `Control depth ${h.depth} at line ${h.deepest}.`,
      "Inspect the nested condition for an early exit.",
      "Recheck depth < 4 and test both exits.",
    );

  if (h.score === null)
    add(
      "coverage",
      0,
      h.coverage.reason === "shared-line"
        ? "The callback shares a source line and has no uniquely attributable function counter."
        : `No comparable score: coverage is ${h.coverage.status}.`,
      "Produce line coverage for this function using the designated suite.",
      "Verify a fresh score with a nonzero executable-line denominator.",
    );

  return rows;
}
