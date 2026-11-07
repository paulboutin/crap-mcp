import { findings, type Finding, type Health } from "./findings.ts";
import type { Snapshot } from "./scan.ts";

type Change =
  "new" | "worsened" | "resolved" | "improved" | "pre-existing" | "unknown";

export interface Delta {
  status: Change;
  findingId: string;
  file: string;
  symbol: string;
  before: Finding | null;
  after: Finding | null;
}

function classify(
  before: Finding | undefined,
  after: Finding | undefined,
): Change {
  if (!before) return "new";

  if (!after) return "resolved";

  if (after.value > before.value) return "worsened";

  return after.value < before.value ? "improved" : "pre-existing";
}

function status(
  old: Health | undefined,
  now: Health | undefined,
  before: Finding | undefined,
  after: Finding | undefined,
): Change {
  if (
    (before ?? after)?.rule === "crap" &&
    (old?.score === null || now?.score === null)
  )
    return "unknown";

  return classify(before, after);
}

function compare(old: Health | undefined, now: Health | undefined) {
  const before = old ? findings(old) : [],
    after = now ? findings(now) : [];

  const ids = new Set([...before, ...after].map((f) => f.id)),
    deltas: Delta[] = [];

  const h = now ?? old;

  if (!h) throw Error("Expected at least one function");

  for (const id of ids) {
    const a = before.find((f) => f.id === id),
      b = after.find((f) => f.id === id);

    deltas.push({
      status: status(old, now, a, b),
      findingId: id,
      file: h.file,
      symbol: h.symbol,
      before: a ?? null,
      after: b ?? null,
    });
  }

  return deltas;
}

const order: Change[] = [
  "new",
  "worsened",
  "resolved",
  "unknown",
  "improved",
  "pre-existing",
];

function comparableScoreChanged(old?: Health, now?: Health) {
  if (!old || !now) return false;

  return old.score !== null && now.score !== null && old.score !== now.score;
}

function changed(
  old: Health | undefined,
  now: Health | undefined,
  selected?: string,
) {
  return (
    old?.hash !== now?.hash ||
    comparableScoreChanged(old, now) ||
    selected?.startsWith((now ?? old)!.id + ":")
  );
}

export function review(base: Snapshot, current: Snapshot, selected?: string) {
  const before = new Map(base.rows.map((h) => [h.id, h])),
    after = new Map(current.rows.map((h) => [h.id, h]));

  const unassessed = new Set(
    [...base.skipped, ...current.skipped].map((k) => k.file),
  );

  const affected = [],
    deltas: Delta[] = [];

  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id),
      now = after.get(id);

    if (unassessed.has((now ?? old)!.file)) continue;

    if (!changed(old, now, selected)) continue;
    affected.push({ before: old ?? null, after: now ?? null });
    deltas.push(...compare(old, now));
  }

  deltas.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return {
    affected,
    findings: deltas,
    unassessed: [...unassessed],
    selected: selected
      ? (deltas.find((f) => f.findingId === selected) ?? null)
      : null,
  };
}
