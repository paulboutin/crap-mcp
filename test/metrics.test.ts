import { functionHits } from "../src/function-hits.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/syntax.ts";
import { functionExplanation, health, findings } from "../src/findings.ts";
import { evidence, score, type Receipt } from "../src/coverage.ts";
import { lcov, istanbul, xcJson } from "../src/importers.ts";
import { lookup } from "../src/backlog.ts";

test("CRAP formula uses the full-precision coverage fraction and strict thresholds", () => {
  assert.equal(score(16, 50), 48);
  assert.equal(score(5, 0), 30);
  const r = parse("a.ts", "function test() { return 0; }")[0];

  const run: Receipt = {
    snapshot: "s",
    suite: "unit",
    at: "now",
    run: "r",
    files: { "a.ts": [[1, 0]] },
  };

  for (const [cc, risk] of [
    [5, "acceptable"],
    [6, "high"],
    [8, "critical"],
  ] as const) {
    const h = health({ ...r, complexity: cc }, "a.ts", "s", "unit", run);
    assert.equal(h.risk, risk);
    assert.equal(
      findings(h).some((f) => f.rule === "crap"),
      cc > 5,
    );
  }

  assert.equal(score(31, 100), 31);
});

test("scopes exclude nested functions, count decisions, and survive unrelated line shifts", () => {
  const source = `class Retry {
  retry(n: number) {
    function allowed(x: number) {
      if (x && n) return true;
      return false;
    }
    return n > 1 ? allowed(n) : false;
  }
}`;

  const rows = parse("retry.ts", source);
  assert.deepEqual(
    rows.map((r) => [r.symbol, r.complexity, r.start, r.end]),
    [
      ["Retry.retry", 2, 2, 8],
      ["Retry.retry.allowed", 3, 3, 6],
    ],
  );
  const shifted = parse("retry.ts", "\n" + source);
  assert.equal(
    health(shifted[0], "retry.ts", "s", "unit").id,
    health(rows[0], "retry.ts", "t", "unit").id,
  );

  const run: Receipt = {
    snapshot: "s",
    suite: "full",
    run: "r",
    at: "now",
    files: {
      "retry.ts": [
        [3, 3],
        [4, 0],
        [5, 0],
        [7, 1],
      ],
    },
  };

  assert.deepEqual(evidence(rows[0], "retry.ts", "s", "full", run), {
    status: "fresh",
    covered: 1,
    executable: 1,
    percent: 100,
    uncovered: [],
  });
  assert.equal(evidence(rows[1], "retry.ts", "s", "full", run).covered, 1);
  assert.equal(evidence(rows[0], "retry.ts", "t", "full", run).status, "stale");
  assert.equal(
    evidence(rows[0], "retry.ts", "s", "fast", run).status,
    "wrong-suite",
  );
  assert.equal(
    evidence(rows[0], "other.ts", "s", "full", run).status,
    "missing",
  );
  assert.equal(evidence(rows[0], "retry.ts", "s", "unit").status, "missing");
  const healths = rows.map((r) => health(r, "retry.ts", "s", "unit"));
  assert.equal(
    lookup(healths, "retry.ts", undefined, 4).symbol,
    "Retry.retry.allowed",
  );
  assert.throws(() => lookup(healths, "retry.ts"));
  assert.throws(() => lookup(healths, "../retry.ts", "retry"));
});

test("Swift guard, logical conditions, loops, cases, nesting and initializer", () => {
  const source = `struct Counter {
 init() {}
 func count(_ n: Int) -> Int {
   guard n > 0 && n < 10 else { return 0 }
   for i in 0..<n {
     if i > 2 {
       while i == 4 {
         if n > 5 { return i }
       }
     }
   }
   switch n {
     case 1: return 4
     default: return 2
   }
 }
}`;

  const [init, r] = parse("Counter.swift", source);
  assert.equal(init.complexity, 1);
  assert.equal(r.symbol, "Counter.count");
  assert.equal(r.complexity, 8);
  assert.equal(r.depth, 4);
  assert.equal(r.deepest, 8);
  assert.ok(
    findings(health(r, "Counter.swift", "s", "unit")).some(
      (f) => f.rule === "nesting",
    ),
  );
  assert.throws(() => parse("bad.ts", "function ( {"));
});

test("detailed report imports deduplicate line hits and reject malformed or coarse data", () => {
  assert.deepEqual(
    [
      ...lcov(
        "/x",
        "SF:/x/a.ts\nDA:1,0\nDA:1,2\nDA:2,0,abc\nend_of_record",
      ).get("a.ts")!,
    ],
    [
      [1, 2],
      [2, 0],
    ],
  );
  assert.equal(lcov("/x", "SF:a.ts\nLF:2\nLH:1\nend_of_record").size, 0);
  assert.throws(() => lcov("/x", "SF:a.ts\nDA:-1,0"));

  const json = JSON.stringify({
    a: {
      path: "/x/a.ts",
      statementMap: { a: { start: { line: 4 } }, b: { start: { line: 4 } } },
      s: { a: 2, b: 0 },
    },
  });

  assert.equal(istanbul("/x", json).get("a.ts")?.get(4), 2);
  assert.throws(() => istanbul("/x", '{"total":{"lines":42}}'));
  assert.deepEqual(
    [
      ...xcJson(
        "/x",
        JSON.stringify({
          "/x/a.swift": [
            { line: 1, isExecutable: false },
            { line: 2, isExecutable: true, executionCount: 0 },
          ],
        }),
      ).get("a.swift")!,
    ],
    [[2, 0]],
  );
});

test("LCOV callback counters distinguish an uncalled callback from its executed enclosing line", () => {
  const source =
    "function f(items:number[]) {\n  return items.map(x => x + 1);\n}";

  const r = parse("a.ts", source)[1];

  const report =
    "SF:a.ts\nFN:1,f\nFN:2,anonymous_1\nFNDA:5,f\nFNDA:0,anonymous_1\nDA:2,5\nend_of_record";

  const run: Receipt = {
    snapshot: "s",
    suite: "unit",
    at: "now",
    run: "r",
    files: { "a.ts": [[2, 5]] },
    functions: functionHits("/repo", report),
  };

  assert.equal(health(r, "a.ts", "s", "unit", run).score, 2);
  assert.deepEqual(evidence(r, "a.ts", "s", "unit", run).uncovered, [2]);

  const hit = {
    ...run,
    functions: functionHits("/repo", report.replace("FNDA:0", "FNDA:1")),
  };

  assert.equal(health(r, "a.ts", "s", "unit", hit).score, 1);
  assert.equal(evidence(r, "a.ts", "s", "unit", hit).basis, "function-entry");

  for (const ambiguous of [
    report + "\n" + report,
    report.replace("FN:1,f", "FN:2,f"),
    report.replace("FN:1,f", "FN:7,anonymous_1"),
    report.replace("FNDA:0,anonymous_1", ""),
    report.replace("FN:2,anonymous_1", "FN:2,4,anonymous_1"),
  ]) {
    assert.equal(
      evidence(r, "a.ts", "s", "unit", {
        ...run,
        functions: functionHits("/repo", ambiguous),
      }).status,
      "insufficient",
    );
  }

  const siblings = parse(
    "a.ts",
    "function f(items:number[]){\n return items.map(x=>x).map(y=>y);\n}",
  );

  assert.equal(
    evidence(siblings[1], "a.ts", "s", "unit", hit).reason,
    "shared-line",
  );
  assert.equal(evidence(r, "a.ts", "other", "unit", hit).status, "stale");
});

test("score explanations separate measured contributions, coverage targets and structural findings", () => {
  const routine = parse("a.ts", "function check() { return 0; }")[0];

  function sample(complexity: number, covered: number, total: number) {
    const lines: [number, number][] = Array.from({ length: total }, (_, i) => [
      i + 1,
      Number(i < covered),
    ]);

    return health(
      { ...routine, end: total, complexity, depth: 4 },
      "a.ts",
      "s",
      "unit",
      {
        snapshot: "s",
        suite: "unit",
        at: "now",
        run: "r",
        files: { "a.ts": lines },
      },
    );
  }

  const measured = sample(16, 5, 10);
  const explanation = functionExplanation(measured).scoring;
  assert.match(explanation, /5 of 10 measured lines/);
  assert.match(
    explanation,
    /32 points above the complexity of 16, bringing CRAP to 48/,
  );
  assert.match(explanation, /2 more measured lines \(7\/10\)/);
  const entries = findings(measured);
  assert.match(
    entries.find((f) => f.rule === "complexity")!.detail.scoring,
    /from 48 to 43.13/,
  );
  assert.match(
    entries.find((f) => f.rule === "nesting")!.detail.scoring,
    /depth of 4 adds no points/,
  );
  assert.match(
    functionExplanation(sample(31, 5, 10)).scoring,
    /full measured coverage, CRAP would be 31/,
  );
  assert.match(
    functionExplanation(sample(31, 10, 10)).scoring,
    /entire CRAP score of 31/,
  );
  assert.match(
    functionExplanation(sample(30, 9, 10)).scoring,
    /1 more measured line \(10\/10\)/,
  );
  assert.match(
    functionExplanation(sample(5, 0, 5)).scoring,
    /25 points above the complexity of 5, bringing CRAP to 30\.$/,
  );
  const near = sample(30, 999, 1000);
  assert.match(
    functionExplanation(near).scoring,
    /less than 0.01 points.*just over 30/,
  );
  const missing = health(routine, "a.ts", "s", "unit");
  assert.match(functionExplanation(missing).scoring, /no coverage.*unknown/);
  const callback = sample(6, 0, 1);
  callback.coverage.basis = "function-entry";
  assert.match(
    functionExplanation(callback).scoring,
    /did not enter this callback.*would fall to 6/,
  );
});
