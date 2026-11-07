import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "self-review", version: "1" });

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, result.content[0].text);

  return JSON.parse(result.content[0].text);
}

async function pages(name, args, field) {
  const first = await call(name, { ...args, limit: 100 });
  let page = field ? first[field] : first;
  const rows = [...page.items];

  while (page.nextOffset !== null) {
    const next = await call(name, {
      ...args,
      limit: 100,
      offset: page.nextOffset,
    });

    page = field ? next[field] : next;
    rows.push(...page.items);
  }

  return { first, rows };
}

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/server.js", "."],
      stderr: "inherit",
    }),
  );
  const inventory = await client.listTools();
  assert.equal(inventory.tools.length, 3);
  const started = performance.now();

  const inspection = await call("analyze_function_health", {
    file: "src/coverage.ts",
    symbol: "score",
  });

  const warm = performance.now();
  await call("analyze_function_health", {
    file: "src/coverage.ts",
    symbol: "score",
  });
  const warmMs = Math.round(performance.now() - warm);
  const backlog = await pages("scan_repository_hotspots", {}, null);

  const diff = await pages(
    "review_changes",
    { base: process.env.CRAP_BASE ?? "HEAD" },
    "findings",
  );

  console.log(
    JSON.stringify(
      {
        source: inspection.snapshot.input,
        suite: inspection.snapshot.suite,
        run: inspection.snapshot.run,
        files: inspection.snapshot.files,
        functions: inspection.snapshot.functions,
        skipped: inspection.snapshot.skipped,
        lookup: {
          score: inspection.function.score,
          coverage: inspection.function.coverage,
          warmMs,
          initialMs: Math.round(warm - started),
        },
        findings: backlog.rows.map((r) => [
          r.rule,
          r.symbol,
          r.value,
          r.coverage.status,
        ]),
        review: {
          affected: diff.first.affected.total,
          findings: diff.rows.length,
        },
      },
      null,
      2,
    ),
  );
  assert.ok(inspection.snapshot.complete, "Some source files were skipped");
  assert.equal(
    inspection.function.coverage.status,
    "fresh",
    "Run npm run coverage first",
  );
  assert.equal(inspection.function.score, 1);
  assert.deepEqual(
    backlog.rows.filter((r) => r.rule !== "coverage"),
    [],
    "Resolve repository hotspots",
  );
  assert.deepEqual(
    backlog.rows.filter((r) => r.coverage.status !== "insufficient"),
    [],
    "Unexpected missing or stale coverage",
  );
} finally {
  await client.close();
}
