import assert from "node:assert/strict";
import { z } from "zod";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
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
    args: Record<string, string>,
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
