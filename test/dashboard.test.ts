import type { Receipt } from "../src/coverage.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { renderReport, type Report } from "../src/report-view.ts";
import { health, findings } from "../src/findings.ts";
import { parse } from "../src/syntax.ts";

test("offline dashboard distinguishes risk from unscored, pages and filters, and renders repository strings as text", () => {
  const window = new JSDOM(
    readFileSync(
      new URL("../dashboard/template.html", import.meta.url),
      "utf8",
    ),
  ).window;

  const doc = window.document;
  const r = parse("a.ts", "function changed() { return 0; }")[0];

  const run: Receipt = {
    suite: "full",
    snapshot: "sha",
    run: "abc",
    at: "2026-01-01",
    files: { "a.ts": [[1, 0]] },
  };

  const fixture = Array.from({ length: 12 }, (_, i) => {
    const h = health(
      { ...r, complexity: i === 0 ? 11 : 2, symbol: "fn" + i },
      "a.ts",
      "sha",
      "full",
      i === 1 ? undefined : run,
    );

    return { ...h, findings: findings(h) };
  });

  const base: Report = {
    repository: "demo",
    functions: fixture,
    review: {
      summary: {
        rating: "Unrated · incomplete scan",
        measured: 1,
        total: 1,
        removed: 0,
        examples: ["a.ts:1 · fn0: 12.00 → 1.00"],
        chat: "",
      },
      ref: "HEAD",
      commit: "abcdef",
      affected: 1,
      unassessed: ["bad.ts"],
      deltas: [
        {
          status: "new",
          findingId: fixture[0].findings[0].id,
          file: "a.ts",
          symbol: "fn0",
          before: null,
          after: fixture[0].findings[0],
        },
      ],
    },
    snapshot: {
      id: "snap",
      functions: 12,
      files: 2,
      complete: false,
      skipped: [{ file: "<img src=x>", reason: "parse error" }],
      suite: "full",
      run: "abc",
      at: "2026-01-01",
      runAt: null,
      policy: "a",
      input: "sha",
      commit: null,
    },
  };

  renderReport(doc, base);
  const text = (id: string) => doc.getElementById(id)?.textContent;
  assert.match(text("session-score")!, /Unrated/);
  assert.match(text("raw-scores")!, /median 6.00 · highest 132.00/);
  assert.match(text("score-examples")!, /12.00 → 1.00/);
  assert.match(text("gaps")!, /missing report data/);
  assert.equal(text("assessed"), "12");
  assert.equal(text("hot"), "1");
  assert.equal(text("unscored"), "1");
  assert.match(text("scan-status")!, /Partial/);
  assert.match(text("deltas")!, /1 new/);
  assert.match(text("skips")!, /<img/);
  assert.equal(doc.querySelector("img"), null);

  const next = doc.querySelector<HTMLButtonElement>("#next")!,
    prev = doc.querySelector<HTMLButtonElement>("#previous")!;

  assert.equal(doc.querySelectorAll("tbody tr").length, 10);
  next.click();
  assert.equal(text("range"), "11–12 of 12");
  prev.click();
  const filter = doc.querySelector("select")!;

  for (const [value, symbol] of [
    ["risk", "fn0"],
    ["structure", "fn0"],
    ["unscored", "fn1"],
  ]) {
    filter.value = value;
    filter.dispatchEvent(new window.Event("change"));
    assert.equal(doc.querySelector("tbody summary")?.textContent, symbol);
  }

  const search = doc.querySelector("input")!;
  search.value = "absent";
  search.dispatchEvent(new window.Event("input"));
  assert.equal(text("range"), "0 results");
  assert.equal(doc.getElementById("empty")!.hidden, false);
  window.close();
});
