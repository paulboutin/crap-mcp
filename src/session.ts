import type { Health } from "./findings.ts";
import type { review } from "./review.ts";

type Review = ReturnType<typeof review>;

type Pair = Review["affected"][number];

interface Tally {
  known: number;
  unknown: number;
  measured: number;
  total: number;
  removed: number;
}

function tally(rows: Pair[]) {
  const t: Tally = { known: 0, unknown: 0, measured: 0, total: 0, removed: 0 };

  for (const { after: h } of rows) {
    if (!h) {
      t.removed++;
      continue;
    }

    t.total++;
    t.known += Number(h.complexity < 10) + Number(h.depth < 4);

    if (h.score === null || h.coverage.percent === null) {
      t.unknown += 2;
      continue;
    }

    t.measured++;
    t.known += Number(h.score <= 30) + h.coverage.percent / 100;
  }

  return t;
}

// Truncate rather than rounding a near-perfect or provisional result up to ten.
function points(credits: number, count: number) {
  return (Math.floor((25 * credits) / count) / 10).toFixed(1);
}

function rating(t: Tally, skipped: number) {
  if (skipped) return "Unrated · incomplete scan";

  if (!t.total) return "Not applicable · no surviving changed functions";

  if (!t.measured) return "Unrated · no comparable coverage";
  const low = points(t.known, t.total);

  return t.unknown
    ? low + "–" + points(t.known + t.unknown, t.total) + "/10 (provisional)"
    : low + "/10";
}

function raw(h: Health | null) {
  if (!h) return "absent";

  return h.score?.toFixed(2) ?? "unscored";
}

function magnitude(p: Pair) {
  if (
    !p.before ||
    !p.after ||
    p.before.score === null ||
    p.after.score === null
  )
    return -1;

  return Math.abs(p.after.score - p.before.score);
}

function highlights(rows: Pair[]) {
  const ranked = [...rows].sort(
    (a, b) =>
      magnitude(b) - magnitude(a) ||
      (b.after?.score ?? -1) - (a.after?.score ?? -1),
  );

  return ranked.slice(0, 3).map((p) => {
    const h = p.after ?? p.before!;

    return (
      h.file +
      ":" +
      h.start +
      " · " +
      h.symbol +
      ": " +
      raw(p.before) +
      " → " +
      raw(p.after)
    );
  });
}

export function sessionSummary(result: Review) {
  const t = tally(result.affected);
  const score = rating(t, result.unassessed.length);
  const counts = new Map<string, number>();

  for (const f of result.findings)
    counts.set(f.status, (counts.get(f.status) ?? 0) + 1);

  const changes =
    [...counts].map(([status, n]) => n + " " + status).join(", ") || "none";

  const examples = highlights(result.affected);

  return {
    rating: score,
    measured: t.measured,
    total: t.total,
    removed: t.removed,
    examples,
    chat: [
      "Session health: " + score,
      t.measured +
        "/" +
        t.total +
        " remaining affected functions scored; " +
        t.removed +
        " removed; " +
        result.unassessed.length +
        " files unassessed.",
      "Finding changes: " + changes + ".",
      ...examples.map((line) => "CRAP (lower is better) · " + line),
    ].join("\n"),
  };
}
