import assert from "node:assert/strict";
import { parse } from "../src/syntax.ts";

const source = Array.from(
  { length: 48 },
  (_, i) =>
    `function evaluate${i}(n: number) { if (n > 2) { while (n > 0) n--; } return n; }`,
).join("\n");

const expected = Array.from({ length: 48 }, (_, i) => [
  "evaluate" + i,
  i + 1,
  3,
  2,
]);

function replay() {
  return parse("fixture.ts", source).map((row) => [
    row.symbol,
    row.start,
    row.complexity,
    row.depth,
  ]);
}

assert.deepEqual(replay(), expected);

if (process.argv.includes("--benchmark")) {
  const start = performance.now();

  for (let i = 0; i < 10; i++) replay();
  process.stdout.write(JSON.stringify(performance.now() - start));
}
