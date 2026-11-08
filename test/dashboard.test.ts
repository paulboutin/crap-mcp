import type { Receipt } from "../src/coverage.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { renderReport, type Report } from "../src/report-view.ts";
import { functionExplanation, health, findings } from "../src/findings.ts";
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

    return {
      ...h,
      findings: findings(h),
      detail: {
        ...functionExplanation(h),
        scoring: "Previously saved generic formula",
      },
    };
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

  assert.equal(doc.querySelectorAll("tbody tr:not([hidden])").length, 10);
  const cells = doc.querySelectorAll("tbody tr:first-child td");
  assert.equal(cells[1].textContent, "11 / 10");
  assert.equal(cells[3].textContent, "132.00 / 30");
  assert.equal(cells[4].textContent, "Critical");
  const toggle = cells[0].querySelector("button")!;
  toggle.click();
  const inspection = doc.getElementById(toggle.getAttribute("aria-controls")!)!;
  assert.equal(inspection, cells[0].parentElement!.nextElementSibling);
  assert.equal(inspection.hidden, false);
  assert.equal(inspection.querySelector("td")!.colSpan, cells.length);
  assert.match(inspection.textContent!, /How to address it/);
  assert.match(inspection.textContent!, /coverage gap adds 121 points/);
  assert.doesNotMatch(
    inspection.textContent!,
    /Previously saved generic formula/,
  );
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.click();
  assert.equal(inspection.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
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
    assert.equal(doc.querySelector("tbody button")?.textContent, symbol);
  }

  const search = doc.querySelector<HTMLInputElement>("#search")!;
  assert.equal(doc.querySelector("tbody tr td:nth-child(4)")?.textContent, "—");
  search.value = "absent";
  search.dispatchEvent(new window.Event("input"));
  assert.equal(text("range"), "0 results");
  assert.equal(doc.getElementById("empty")!.hidden, false);
  window.close();
});
