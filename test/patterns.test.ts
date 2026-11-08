import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { git, repository } from "../src/files.ts";
import {
  capturePatterns,
  latestPatterns,
  savedPatterns,
} from "../src/pattern-scan.ts";
import { readSwiftOutput } from "../src/pattern-languages.ts";
import { linkPatterns, PatternSink } from "../src/pattern-evidence.ts";
import { scan } from "../src/scan.ts";
import { codeReport } from "../src/code-report.ts";
import { renderReport } from "../src/report-view.ts";

test("language findings survive absent coverage and file-level matches, and the recorded data stays pinned", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-patterns-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  mkdirSync(join(root, "relay"));
  writeFileSync(
    join(root, "relay/tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "es2022" } }),
  );
  const path = join(root, "relay/entry.ts");
  writeFileSync(
    path,
    "Promise.resolve(0);\nexport function outer() {\n  function inner() {\n    Promise.resolve(1);\n  }\n  return inner;\n}\n",
  );
  writeFileSync(
    join(root, "Example.swift"),
    "func extract(_ value: Any) -> Int {\n    return value as! Int\n}\n",
  );
  const repo = repository(root);
  const snapshot = await scan(repo, { done: 0, total: 0 }, new Map());
  const captured = capturePatterns(repo, snapshot.input);
  const report = codeReport(repo.root, snapshot);
  const data = latestPatterns(repo, snapshot.input)!;
  report.patterns = linkPatterns(data, report.functions);

  const hits = report.patterns!.findings.filter(
    (f) => f.rule === "typescript(no-floating-promises)",
  );

  assert.equal(hits.length, 2, JSON.stringify(data.notes));
  const inner = hits.find((f) => f.line === 4)!;
  assert.match(inner.symbol!, /inner/);
  assert.equal(inner.excerpt, "Promise.resolve(1);");
  assert.match(inner.action, /rejection/);
  assert.equal(hits.find((f) => f.line === 1)!.owner, null);
  assert.equal(
    report.functions.find((row) => row.id === inner.owner)?.score,
    null,
  );
  assert.ok(data.spacing > 0);
  assert.ok(
    data.findings.every((f) => !f.rule.includes("require-readable-spacing")),
  );

  if (spawnSync("swiftlint", ["version"]).status === 0) {
    const swift = report.patterns!.findings.find(
      (f) => f.rule === "force_cast",
    );

    assert.equal(swift?.line, 2, JSON.stringify(data.notes));
    assert.match(swift.symbol!, /extract/);
  } else assert.match(data.notes.join(" "), /SwiftLint incomplete/);

  const doc = new JSDOM(
    readFileSync(
      new URL("../dashboard/template.html", import.meta.url),
      "utf8",
    ),
  ).window.document;

  renderReport(doc, report);
  assert.match(
    doc.querySelector("#pattern-list")!.textContent!,
    /Promise.resolve\(1\)/,
  );
  const filter = doc.querySelector<HTMLSelectElement>("#filter")!;
  filter.value = "patterns";
  filter.dispatchEvent(new doc.defaultView!.Event("change"));
  assert.match(doc.querySelector("#rows")!.textContent!, /Unscored/);

  const toggle = [
    ...doc.querySelectorAll<HTMLButtonElement>("#rows button"),
  ].find((button) => button.textContent === inner.symbol)!;

  toggle.click();
  assert.match(
    doc.querySelector("#rows")!.textContent!,
    /no-floating-promises/,
  );
  writeFileSync(path, "export const clean = 1;\n");
  const fixed = capturePatterns(repo);
  assert.ok(
    !fixed.data.findings.some((f) => f.rule.includes("floating-promises")),
  );
  assert.equal(latestPatterns(repo, snapshot.input), undefined);
  assert.equal(
    savedPatterns(repo, captured.id)?.findings.length,
    data.findings.length,
  );
});

test("SwiftLint error-severity findings are retained, tool failures stay unavailable", (t) => {
  const root = mkdtempSync(join(tmpdir(), "crap-swift-json-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "a.swift"), "let n = try! parse()");
  const sink = new PatternSink(repository(root), "input", "policy");

  const json = JSON.stringify([
    {
      file: "a.swift",
      line: 1,
      character: 9,
      rule_id: "force_try",
      reason: "Avoid force try",
    },
  ]);

  readSwiftOutput(sink, json, "", 2);
  assert.match(sink.data.findings[0].impact!, /terminates/);
  assert.equal(sink.data.findings[0].excerpt, "let n = try! parse()");
  assert.throws(
    () => readSwiftOutput(sink, "[]", "failed to initialize", 2),
    /failed to initialize/,
  );
  assert.throws(
    () => readSwiftOutput(sink, "", "invalid input", 1),
    /invalid input/,
  );
});
