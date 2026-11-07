import { findMarkedTicket } from "../src/github.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionSummary } from "../src/session.ts";
import { health } from "../src/findings.ts";
import { parse } from "../src/syntax.ts";
import type { Receipt } from "../src/coverage.ts";

const run: Receipt = {
  snapshot: "s",
  suite: "unit",
  at: "now",
  run: "r",
  files: { "a.ts": [[1, 1]] },
};

const simple = parse("a.ts", "function add(x:number){return x+1;}")[0];
const good = health(simple, "a.ts", "s", "unit", run);

const deep = health(
  { ...simple, depth: 4, complexity: 12 },
  "a.ts",
  "s",
  "unit",
  run,
);

const absent = health(simple, "a.ts", "stale", "unit", run);
const clean = { findings: [], selected: null, unassessed: [] };

test("session rating separates known performance, missing evidence, deletions and no change", () => {
  const pair = { before: deep, after: good };
  assert.equal(
    sessionSummary({ ...clean, affected: [pair] }).rating,
    "10.0/10",
  );

  const more = sessionSummary({
    ...clean,
    affected: [pair, { before: null, after: deep }],
  });

  assert.equal(more.rating, "7.5/10");
  assert.match(more.chat, /12.00 → 1.00/);
  assert.equal(
    sessionSummary({
      ...clean,
      affected: [pair, { before: null, after: absent }],
    }).rating,
    "7.5–10.0/10 (provisional)",
  );
  assert.match(
    sessionSummary({ ...clean, affected: [{ before: good, after: absent }] })
      .rating,
    /Unrated/,
  );
  assert.match(
    sessionSummary({ ...clean, unassessed: ["bad.ts"], affected: [pair] })
      .rating,
    /incomplete/,
  );
  assert.match(
    sessionSummary({ ...clean, affected: [] }).rating,
    /Not applicable/,
  );

  const removed = sessionSummary({
    ...clean,
    affected: [{ before: deep, after: null }],
  });

  assert.equal(removed.removed, 1);
  assert.match(removed.rating, /Not applicable/);
});

test("recovery finds the exact marker across GitHub result pages and rejects mentions", () => {
  const pages = JSON.stringify([
    [
      { number: 2, body: null, state: "open" },
      { number: 3, body: "someone mentioned <!-- id -->", state: "open" },
    ],
    [{ number: 5, body: "<!-- id -->\nmanaged finding", state: "closed" }],
  ]);

  assert.equal(findMarkedTicket(pages, "<!-- id -->")?.number, 5);
  assert.equal(findMarkedTicket(pages, "<!-- other -->"), undefined);
});
