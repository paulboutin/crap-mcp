import { renderReport } from "../src/report-view.ts";
import assert from "node:assert/strict";
import { z } from "zod";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { JSDOM } from "jsdom";
import { machineApp } from "../src/machine-app.ts";
import { Projects, projectReport } from "../src/projects.ts";
import { git } from "../src/files.ts";

test("one HTTP service isolates same-name checkouts across clients, dashboard selections and restart", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crap-machine-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const projects = new Projects(dir);
  const server = machineApp(projects).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const addr = z.object({ port: z.number() }).parse(server.address());
  const url = "http://127.0.0.1:" + addr.port;

  const clients = await Promise.all(
    ["alpha", "beta"].map(async (name) => {
      const client = new Client({ name, version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url + "/mcp")),
      );
      t.after(() => client.close());

      return client;
    }),
  );

  async function call(
    client: Client,
    name: string,
    args: Record<string, string | boolean>,
  ) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content[0];
    assert.ok(content.type === "text");
    assert.ok(!result.isError, content.text);

    return JSON.parse(content.text);
  }

  const ids = await Promise.all(
    ["alpha", "beta"].map(async (name, i) => {
      const root = join(dir, name, "app");
      mkdirSync(root, { recursive: true });
      git(root, "init", "-b", "main");
      writeFileSync(
        join(root, "code.ts"),
        "export function " + name + "(){return 1}",
      );
      const { id } = await call(clients[i], "register_project", { path: root });

      const { id: again } = await call(clients[i], "register_project", {
        path: root,
      });

      assert.equal(again, id);

      return id;
    }),
  );

  const endpoint = url + "/projects/" + ids[0] + "/settings";
  const policy = await (await fetch(endpoint)).json();

  const payload = {
    revision: policy.revision,
    settings: { ...policy.settings, minCoverage: 80 },
  };

  const put = {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };

  assert.equal((await fetch(endpoint, put)).status, 200);
  assert.equal((await fetch(endpoint, put)).status, 409);
  assert.equal((await fetch(endpoint, { ...put, body: "{}" })).status, 400);
  assert.match(await (await fetch(url + "/settings")).text(), /Language packs/);
  assert.equal(
    (await call(clients[1], "get_project_settings", { project: ids[1] }))
      .settings.minCoverage,
    0,
  );

  const change = {
    project: ids[0],
    language: "swift",
    enabled: true,
    linter: true,
    revision: (await (await fetch(endpoint)).json()).revision,
  };

  const updated = await call(clients[0], "set_project_language", change);
  assert.deepEqual((await (await fetch(endpoint)).json()).settings.linters, [
    "swift",
  ]);
  await assert.rejects(
    call(clients[0], "set_project_language", { ...change, enabled: false }),
    /Core languages/,
  );
  await assert.rejects(
    call(clients[0], "set_project_language", {
      ...change,
      language: "unknown",
    }),
    /Unknown language/,
  );
  await assert.rejects(
    call(clients[0], "set_project_language", { ...change, language: "tsx" }),
    /supported linter/,
  );
  await assert.rejects(
    call(clients[0], "set_project_language", { ...change, linter: false }),
    /Reload/,
  );
  await call(clients[0], "set_project_language", {
    ...change,
    revision: updated.revision,
    linter: false,
  });

  const scans = await Promise.all(
    ids.map((id, i) =>
      call(clients[i], "get_repository_report", { project: id }),
    ),
  );

  assert.equal(scans[0].items[0].symbol, "alpha");
  assert.equal(scans[1].items[0].symbol, "beta");
  const args = { project: ids[0], snapshot: scans[1].snapshot.id };
  await assert.rejects(
    call(clients[0], "review_changes", args),
    /Unknown task snapshot/,
  );
  await assert.rejects(call(clients[0], "get_repository_report", {}));
  assert.deepEqual(
    await call(clients[0], "list_projects", {}),
    new Projects(dir).list(),
  );

  for (const [i, id] of ids.entries()) {
    const page = await fetch(url + "/report/" + id);
    assert.equal(page.status, 200);
    const { document } = new JSDOM(await page.text()).window;
    const report = JSON.parse(document.getElementById("data")!.textContent!);
    assert.equal(report.functions[0].symbol, scans[i].items[0].symbol);
  }

  const root = projects.list()[0].root;
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "initial",
  );
  assert.equal(
    (await projectReport(projects.desk(ids[0]))).review?.ref,
    "HEAD",
  );
  assert.match(
    (await projectReport(projects.desk(ids[0]), scans[0].snapshot.id)).review!
      .ref,
    /task snapshot/,
  );
  assert.equal(
    (
      await fetch(url + "/projects", {
        headers: { origin: "https://example.com" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(url + "/report/missing")).status, 400);
  assert.equal((await fetch(url + "/mcp")).status, 405);
  assert.equal((await fetch(url + "/health")).status, 200);
  assert.match(await (await fetch(url)).text(), /Selected project health/);
  assert.throws(() => projects.register("."), /absolute/);
  // A new configuration should take effect without restarting other projects.
  const old = projects.desk(ids[0]);
  writeFileSync(join(root, ".crap.json"), '{"suite":"integration"}');
  const fresh = projects.desk(ids[0]);
  await fresh.current();
  assert.notEqual(fresh, old);
});

test("machine security settings persist and the dashboard compares the same saved findings as MCP", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sec-machine-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "checkout");
  mkdirSync(root);
  git(root, "init");
  const projects = new Projects(dir);
  const { id } = projects.register(root);
  const server = machineApp(projects).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = z.object({ port: z.number() }).parse(server.address());
  const url = "http://127.0.0.1:" + port;
  const endpoint = url + "/projects/" + id + "/settings";
  const policy = await (await fetch(endpoint)).json();

  const save = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: policy.revision,
      settings: {
        ...policy.settings,
        securityRules: ["dynamic-eval"],
        minSecurityScore: 80,
        accessibilityRules: ["text-contrast", "document-language"],
      },
    }),
  });

  assert.equal(save.status, 200);
  const client = new Client({ name: "security", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  t.after(() => client.close());
  writeFileSync(join(root, "code.ts"), "eval(userInput)");

  const result = await client.callTool({
    name: "scan_application_security",
    arguments: { project: id },
  });

  const data = JSON.parse(
    z.object({ text: z.string() }).parse(result.content[0]).text,
  );

  writeFileSync(
    join(root, "ui.html"),
    '<html lang="en"><p style="color:#777;background:white">Save</p></html>',
  );

  const first = await client.callTool({
    name: "scan_application_accessibility",
    arguments: { project: id },
  });

  const access = JSON.parse(
    z.object({ text: z.string() }).parse(first.content[0]).text,
  );

  assert.equal(access.score, 50);
  writeFileSync(
    join(root, "ui.html"),
    '<html lang="en"><p style="color:black;background:white">Save</p></html>',
  );
  assert.equal(data.score, 75);
  writeFileSync(join(root, "code.ts"), "JSON.parse(userInput)");

  const response = await fetch(
    url +
      "/report/" +
      id +
      "?accessibilitySnapshot=" +
      access.snapshot +
      "&securitySnapshot=" +
      data.snapshot,
  );

  assert.equal(response.status, 200);
  const doc = new JSDOM(await response.text()).window.document;
  const report = JSON.parse(doc.getElementById("data")!.textContent!);
  renderReport(doc, report);
  assert.match(doc.getElementById("security-score")!.textContent!, /100\/100/);
  assert.match(
    doc.getElementById("security-change")!.textContent!,
    /75 → 100.*1 resolved/,
  );
  assert.equal(report.security.rules.length, 1);
  assert.match(
    doc.getElementById("access-change")!.textContent!,
    /50 → 100.*1 resolved/,
  );
  assert.match(
    doc.getElementById("colorblind-score")!.textContent!,
    /0\/100 → 100\/100/,
  );
  assert.match(doc.getElementById("access-colors")!.textContent!, /21.000:1/);

  assert.match(doc.getElementById("baseline-colors")!.textContent!, /4.478:1/);

  const pair = await client.callTool({
    name: "analyze_accessibility_color_pair",
    arguments: { project: id, foreground: "#f00", background: "#000" },
  });

  const analysis = JSON.parse(
    z.object({ text: z.string() }).parse(pair.content[0]).text,
  );

  assert.equal(analysis.passes, true);
  assert.equal(analysis.colorblindScore, 0);
});

test("expanded reports retain matched lines across edits and render source as inert text", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "finding-details-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "project");
  mkdirSync(root);
  git(root, "init");
  const projects = new Projects(dir);
  const { id } = projects.register(root);
  const server = machineApp(projects).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const url =
    "http://127.0.0.1:" +
    z.object({ port: z.number() }).parse(server.address()).port;

  writeFileSync(
    join(root, "example.ts"),
    'eval(\n  "</script><img src=x>"\n);',
  );
  writeFileSync(
    join(root, "page.html"),
    '<html lang="en"><body>\n<button\n aria-label="">\n</button><p style="color:red;background:black">Delete</p></body></html>',
  );
  const client = new Client({ name: "finding-details", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  t.after(() => client.close());

  const scan = async (name: string) => {
    const result = await client.callTool({ name, arguments: { project: id } });

    return JSON.parse(
      z.object({ text: z.string() }).parse(result.content[0]).text,
    );
  };

  const security = await scan("scan_application_security");
  const f = security.findings.items[0];
  assert.equal(f.detail.line, 1);
  assert.equal(f.detail.end, 3);
  assert.match(f.detail.why, /eval/);
  assert.match(f.detail.scoring, /25/);
  assert.match(f.detail.impact, /privileges/);
  const access = await scan("scan_application_accessibility");
  assert.ok(access.passedChecks.items.length > 0);

  const observation = access.findings.items.find(
    (v: { rule: string }) => v.rule === "button-name",
  );

  assert.equal(observation.end, 3);
  assert.match(observation.detail.check, /accessibility tree/);

  const red = access.colors.items.find(
    (v: { element: string }) => v.element === "p",
  );

  assert.deepEqual(red.failedProfiles, ["protanopia"]);
  assert.match(red.detail.why, /Ordinary contrast 5.252:1 \(pass\)/);
  writeFileSync(join(root, "example.ts"), "JSON.parse(body);");

  const result = await client.callTool({
    name: "review_application_security",
    arguments: { project: id, snapshot: security.snapshot, format: "chat" },
  });

  const path = z
    .object({ text: z.string() })
    .parse(result.content[0])
    .text.match(/Detailed report: (.+)/)![1];

  const doc = new JSDOM(readFileSync(path, "utf8")).window.document;
  renderReport(doc, JSON.parse(doc.getElementById("data")!.textContent!));

  const detail = doc.querySelector<HTMLDetailsElement>(
    "#security-deltas details",
  )!;

  assert.equal(detail.open, false);
  detail.querySelector("summary")!.click();
  assert.equal(detail.open, true);
  assert.match(detail.textContent!, /example.ts:1–3/);
  assert.match(detail.textContent!, /Baseline snapshot/);
  assert.match(
    detail.querySelector("pre")!.textContent!,
    /2\s+"<\/script><img src=x>"/,
  );
  assert.equal(doc.querySelector("img"), null);
  detail.querySelector("summary")!.click();
  assert.equal(detail.open, false);
});
