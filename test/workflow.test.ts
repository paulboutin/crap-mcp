import { publish, sync } from "../src/issues.ts";
import { githubTracker, type Ticket } from "../src/github.ts";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { repository, git, revision, safeFile } from "../src/files.ts";
import { record } from "../src/record.ts";
import { createServer } from "../src/service.ts";
import { receipt } from "../src/coverage.ts";
import { z } from "zod";

function fixture(t: TestContext) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "crap-test-")));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  git(path, "init", "-b", "main");
  git(path, "config", "user.name", "Tester");
  git(path, "config", "user.email", "test@example.invalid");
  writeFileSync(join(path, ".gitignore"), "out.info\n");
  writeFileSync(
    join(path, ".crap.json"),
    JSON.stringify({
      suite: "unit",
      command: [process.execPath, ...suiteArgs()],
      criticalPaths: ["a.ts"],
    }),
  );

  return path;
}

function commit(path: string) {
  git(path, "add", ".");
  git(path, "commit", "-m", "fixture");

  return revision(path, "HEAD");
}

const source =
  "export function work(x: number) {\n" +
  "  if (x > 4) return x;\n".repeat(9) +
  "  return 0;\n}\n";

const report =
  "SF:a.ts\n" +
  Array.from({ length: 11 }, (_, i) => "DA:" + (i + 1) + ",0").join("\n") +
  "\nend_of_record\n";

function suiteArgs() {
  return [
    "-e",
    "require('fs').writeFileSync('out.info'," + JSON.stringify(report) + ")",
  ];
}

function recordRun(path: string) {
  return record(repository(path), "out.info", process.execPath, suiteArgs());
}

async function connect(t: TestContext, path: string) {
  const server = createServer(repository(path)),
    client = new Client({ name: "test", version: "1" });

  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  return client;
}

async function call(
  client: Client,
  name: string,
  args: Parameters<Client["callTool"]>[0]["arguments"],
) {
  const res = await client.callTool({ name, arguments: args });

  const content = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .parse(res.content);

  assert.ok(!res.isError, content[0].text);

  return JSON.parse(content[0].text);
}

test("a fix stays local across worktrees; an integrated clean scan confirms it", async (t) => {
  const path = fixture(t);
  writeFileSync(join(path, "a.ts"), source);
  const head = commit(path);
  recordRun(path);
  const main = await connect(t, path);

  const a = await call(main, "analyze_function_health", {
    file: "a.ts",
    symbol: "work",
  });

  assert.equal(a.function.score, 110);
  assert.equal(a.function.coverage.status, "fresh");
  const start = a.snapshot.id;

  const ranked = await call(main, "scan_repository_hotspots", {
    priority: "critical",
    limit: 1,
  });

  assert.equal(ranked.total, 2);
  assert.equal(ranked.nextOffset, 1);
  assert.equal(ranked.items[0].critical, true);
  const feature = path + "-wt";
  git(path, "worktree", "add", "-b", "fix", feature);
  t.after(() => rmSync(feature, { recursive: true, force: true }));
  writeFileSync(
    join(feature, "a.ts"),
    "export function work(x: number) {\n return x > 4 ? x : 0;\n}\n",
  );
  const client = await connect(t, feature);
  const change = await call(client, "review_changes", { snapshot: start });
  assert.equal(change.affected.total, 1);
  assert.ok(
    change.findings.items.some(
      (d: { status: string; findingId: string }) =>
        d.status === "resolved" && d.findingId.endsWith(":complexity"),
    ),
  );
  assert.ok(
    change.findings.items.some(
      (d: { status: string }) => d.status === "unknown",
    ),
  );
  assert.equal(
    (
      await call(client, "scan_repository_hotspots", {
        view: "integration",
        rule: "crap",
      })
    ).total,
    1,
  );
  recordRun(feature);
  commit(feature);

  const verified = await call(client, "review_changes", {
    base: head,
    findingId: a.findings[0].id,
  });

  assert.equal(verified.selected.status, "resolved");
  assert.equal(
    (await call(main, "scan_repository_hotspots", { rule: "crap" })).total,
    1,
  );
  git(path, "merge", "--ff-only", "fix");
  recordRun(path);
  await call(main, "analyze_function_health", { file: "a.ts", line: 2 });
  assert.equal(
    (
      await call(client, "scan_repository_hotspots", {
        view: "integration",
        rule: "crap",
      })
    ).total,
    0,
  );
});

test("dirty snapshots isolate later edits; stale coverage and skipped files cannot prove a fix", async (t) => {
  const path = fixture(t);
  writeFileSync(join(path, "a.ts"), source);
  commit(path);
  writeFileSync(join(path, "other.ts"), "function unrelated() { return 1; }");
  recordRun(path);
  const c = await connect(t, path);
  const snap = (await call(c, "scan_repository_hotspots", {})).snapshot.id;
  writeFileSync(join(path, "a.ts"), source.replace("return 0", "return 9"));
  const delta = await call(c, "review_changes", { snapshot: snap });
  assert.equal(delta.affected.total, 1);
  assert.equal(delta.affected.items[0].after.coverage.status, "stale");
  writeFileSync(join(path, "a.ts"), "function !!!");
  const broken = await call(c, "review_changes", { snapshot: snap });
  assert.deepEqual(broken.unassessed, ["a.ts"]);
  assert.equal(broken.findings.total, 0);
  const refresh = await call(c, "scan_repository_hotspots", { refresh: true });
  assert.equal(refresh.status, "scanning");
  const scan = await call(c, "scan_repository_hotspots", {});
  assert.equal(scan.status, "partial");
});

test("recorder refuses failed, unchanged and racing runs; symlinks are never read as source", (t) => {
  const path = fixture(t);
  writeFileSync(join(path, "a.ts"), source);
  commit(path);
  recordRun(path);

  const repo = repository(path),
    run = receipt(repo)?.run;

  assert.throws(
    () => record(repo, "out.info", process.execPath, ["-e", ""]),
    /designated suite/,
  );

  function attempt(args: string[]) {
    writeFileSync(
      join(path, ".crap.json"),
      JSON.stringify({ suite: "unit", command: [process.execPath, ...args] }),
    );

    return record(repository(path), "out.info", process.execPath, args);
  }

  assert.throws(() => attempt(["-e", "process.exit(1)"]), /did not pass/);
  assert.throws(() => attempt(["-e", "void 0"]), /new report/);
  assert.throws(
    () =>
      attempt([
        "-e",
        "let f=require('fs');f.appendFileSync('a.ts',' ');f.appendFileSync('out.info','\\n')",
      ]),
    /changed during/,
  );
  assert.equal(receipt(repo)?.run, run);
  symlinkSync(join(path, "a.ts"), join(path, "link.ts"));
  assert.throws(() => safeFile(path, "link.ts"), /symlinks/);
  assert.throws(() => safeFile(path, "../oops.ts"));
  assert.match(readFileSync(join(path, "a.ts"), "utf8"), /function work/);
});

test("linked GitHub finding updates one issue and closes only after matching integration coverage", async (t) => {
  const path = fixture(t);
  writeFileSync(join(path, "a.ts"), source);
  commit(path);
  recordRun(path);
  const main = await connect(t, path);
  const result = await call(main, "scan_repository_hotspots", { rule: "crap" });

  const repo = repository(path),
    id = result.items[0].id;

  let ticket: Ticket = {
    number: 17,
    body: "",
    state: "open",
  };

  const methods: string[] = [];

  const tracker = githubTracker(
    (_path, method, fields) => {
      methods.push(method);
      ticket = { ...ticket, ...fields };

      return ticket;
    },
    () => undefined,
  );

  assert.equal(publish(repo, "example/test", id, tracker), 17);
  assert.equal(publish(repo, "example/test", id, tracker), 17);
  assert.deepEqual(methods, ["POST", "GET"]);
  writeFileSync(
    join(path, "a.ts"),
    "export function work(x: number) { return x; }",
  );
  await call(main, "analyze_function_health", { file: "a.ts", symbol: "work" });
  assert.deepEqual(sync(repo, tracker), []);
  commit(path);
  await call(main, "analyze_function_health", { file: "a.ts", symbol: "work" });
  assert.deepEqual(sync(repo, tracker), []);
  recordRun(path);
  await call(main, "analyze_function_health", { file: "a.ts", symbol: "work" });
  assert.equal(sync(repo, tracker).length, 1);
  assert.equal(ticket.state, "closed");
  assert.deepEqual(sync(repo, tracker), []);
  assert.deepEqual(methods, ["POST", "GET", "GET", "PATCH"]);
});

test("review orders introduced, worsened and resolved findings; a broken integration scan retains the confirmed backlog", async (t) => {
  const path = fixture(t);
  writeFileSync(
    join(path, "a.ts"),
    source + "\n" + source.replace("work(", "retire("),
  );
  commit(path);
  recordRun(path);
  const c = await connect(t, path);

  const baseline = await call(c, "scan_repository_hotspots", {
    view: "worktree",
  });

  writeFileSync(
    join(path, "a.ts"),
    source.replace("return 0;", "if (x < -1) return -1;\n return 0;") +
      "\n" +
      source.replace("work(", "fresh("),
  );
  recordRun(path);

  const delta = await call(c, "review_changes", {
    snapshot: baseline.snapshot.id,
    limit: 100,
  });

  const structural = delta.findings.items.filter((f: { findingId: string }) =>
    f.findingId.endsWith(":complexity"),
  );

  assert.deepEqual(
    structural.map((f: { status: string }) => f.status),
    ["new", "worsened", "resolved"],
  );
  writeFileSync(join(path, "a.ts"), "function {");
  const target = commit(path);
  const partial = await call(c, "scan_repository_hotspots", {});
  assert.equal(partial.status, "partial");

  const previous = await call(c, "scan_repository_hotspots", {
    view: "integration",
    rule: "complexity",
  });

  assert.equal(previous.baseline.status, "last-confirmed");
  assert.equal(previous.baseline.target, target);
  assert.equal(previous.snapshot.id, baseline.snapshot.id);
  assert.equal(previous.total, 2);
});

test("reports keep acceptable and unscored functions, and additional pages stay on the requested snapshot", async (t) => {
  const path = fixture(t);
  writeFileSync(
    join(path, "a.ts"),
    "function first() { return 1; }\nfunction second() { return 2; }",
  );
  writeFileSync(join(path, "b.ts"), "function untested() { return false; }");
  commit(path);
  recordRun(path);
  const c = await connect(t, path);
  const page = await call(c, "get_repository_report", { limit: 1 });
  assert.equal(page.total, 3);
  assert.equal(page.items[0].score, 2);
  assert.deepEqual(page.items[0].findings, []);
  writeFileSync(join(path, "a.ts"), "function first() { return 42; }");

  const next = await call(c, "get_repository_report", {
    snapshot: page.snapshot.id,
    offset: 1,
  });

  assert.equal(next.items[0].symbol, "second");
  assert.equal(next.items[1].coverage.status, "missing");
  assert.equal(next.snapshot.id, page.snapshot.id);
  const fresh = await call(c, "get_repository_report", {});
  assert.equal(fresh.total, 2);
  assert.notEqual(fresh.snapshot.id, page.snapshot.id);
});

test("an uncached Git baseline uses committed bytes and reports historical symlinks as unassessed", async (t) => {
  const path = fixture(t);
  writeFileSync(join(path, "a.ts"), source);
  symlinkSync("a.ts", join(path, "alias.ts"));
  const ref = commit(path);
  writeFileSync(
    join(path, "a.ts"),
    "export function work(x: number) { return x; }",
  );
  rmSync(join(path, "alias.ts"));
  writeFileSync(
    join(path, "alias.ts"),
    "export function formerlyLinked() { return 1; }",
  );
  const c = await connect(t, path);
  const result = await call(c, "review_changes", { base: ref });
  assert.equal(result.baseline.commit, ref);
  assert.deepEqual(result.unassessed, ["alias.ts"]);
  assert.equal(result.affected.total, 1);
  assert.equal(result.affected.items[0].before.complexity, 10);
  assert.equal(result.affected.items[0].before.score, null);
  assert.equal(result.affected.items[0].after.complexity, 1);
  assert.equal(
    result.findings.items.find((f: { findingId: string }) =>
      f.findingId.endsWith(":complexity"),
    ).status,
    "resolved",
  );
});

test("security MCP scans syntax, compares a dirty baseline and renders a separate PNG", async (t) => {
  const root = fixture(t);

  const write = (name: string, source: string) =>
    writeFileSync(join(root, name), source);

  write(
    "auth.js",
    "eval(incoming);\n// eval(x)\nconst example = 'rejectUnauthorized: false';\nconst good = crypto.createHash('sha256');",
  );
  write(
    "Client.swift",
    "func check() {\n _ = Insecure.MD5.hash(data: bytes)\n}",
  );
  commit(root);
  write(
    "panel.tsx",
    "export const ui = <div/>;\nconst options = { rejectUnauthorized: false };",
  );
  const c = await connect(t, root);

  const scan = "scan_application_security",
    review = "review_application_security";

  const first = await call(c, scan, { limit: 1 });
  assert.equal(first.score, 40);
  assert.equal(first.assessed, 3);
  assert.equal(first.findings.total, 3);

  const page = await call(c, scan, {
    snapshot: first.snapshot,
    offset: 1,
    limit: 1,
  });

  assert.equal(page.findings.items[0].rule, "dynamic-eval");
  write("auth.js", "\n\neval(incoming);");
  write("panel.tsx", "const options = { rejectUnauthorized: true };");
  const diff = await call(c, review, { snapshot: first.snapshot });
  assert.equal(diff.score, 65);
  assert.equal(diff.comparison.resolved.items[0].rule, "tls-verification");
  assert.equal(diff.comparison.introduced.total, 0);

  const pinned = await call(c, review, {
    base: "HEAD",
    current: first.snapshot,
  });

  assert.equal(pinned.comparison.introduced.total, 1);

  const card = await c.callTool({
    name: review,
    arguments: {
      snapshot: first.snapshot,
      current: diff.snapshot,
      format: "chat",
      scorecard: true,
    },
  });

  const png = z
    .object({
      type: z.literal("image"),
      mimeType: z.literal("image/png"),
      data: z.string(),
    })
    .parse(card.content[1]);

  assert.equal(
    Buffer.from(png.data, "base64").subarray(1, 4).toString(),
    "PNG",
  );

  const textCard = await c.callTool({
    name: scan,
    arguments: { snapshot: first.snapshot, format: "chat" },
  });

  assert.match(
    z.object({ text: z.string() }).parse(textCard.content[0]).text,
    /40\/100/,
  );
  await assert.rejects(
    call(c, review, { snapshot: first.snapshot, base: "HEAD" }),
    /Choose/,
  );
  await assert.rejects(
    call(c, scan, { snapshot: "a".repeat(64) }),
    /Unknown security snapshot/,
  );
  write("auth.js", "function (");
  const gap = await call(c, review, { snapshot: first.snapshot });
  assert.equal(gap.score, null);
  assert.equal(gap.comparison.comparable, false);
  assert.equal(gap.comparison.resolved.total, 0);
  assert.match(gap.skipped.items[0].reason, /Syntax error/);
});

test("accessibility MCP preserves a dirty baseline, reports known results separately from manual checks and returns its own card", async (t) => {
  const root = fixture(t);
  const path = join(root, "screen.html");
  const put = (source: string) => writeFileSync(path, source);
  put('<html lang="en"><img alt="Map"></html>');
  commit(root);
  put('<html lang="en"><img>\n<button aria-label="Exit">Save</button></html>');
  const c = await connect(t, root);

  const scan = "scan_application_accessibility",
    review = "review_application_accessibility";

  const first = await call(c, scan, { limit: 1 });
  assert.equal(first.score, 50);
  assert.equal(first.findings.total, 2);

  const page = await call(c, scan, {
    snapshot: first.snapshot,
    offset: 1,
    limit: 1,
  });

  assert.equal(page.findings.items[0].line, 2);
  assert.match(first.catalog["label-in-name"].section508, /outside/);
  put(
    '<html lang="en"><img alt="Map">\n<button aria-label="Save draft">Save</button></html>',
  );
  const diff = await call(c, review, { snapshot: first.snapshot });
  assert.equal(diff.score, 100);
  assert.equal(diff.comparison.resolved.total, 2);
  const old = await call(c, review, { base: "HEAD", current: first.snapshot });
  assert.equal(old.comparison.introduced.total, 2);

  const card = await c.callTool({
    name: review,
    arguments: {
      snapshot: first.snapshot,
      current: diff.snapshot,
      format: "chat",
      scorecard: true,
    },
  });

  assert.equal(card.content[1].type, "image");
  assert.match(
    z.object({ text: z.string() }).parse(card.content[0]).text,
    /50 → 100/,
  );
  const text = await c.callTool({ name: scan, arguments: { format: "chat" } });
  assert.match(
    z.object({ text: z.string() }).parse(text.content[0]).text,
    /4 passed/,
  );
  writeFileSync(join(root, "view.tsx"), "const ui = <button>{label}</button>;");
  const unknown = await call(c, review, { snapshot: first.snapshot });
  assert.equal(unknown.pending.total, 3);
  assert.equal(unknown.comparison.comparable, true);
  assert.equal(unknown.comparison.resolved.total, 2);
  await assert.rejects(
    call(c, review, { snapshot: "a".repeat(64) }),
    /Unknown accessibility snapshot/,
  );
});
