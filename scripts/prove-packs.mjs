import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const dir = mkdtempSync(join(tmpdir(), "crap-packs-"));

process.env.CRAP_DATA_DIR = dir;

const custom = join(dir, "languages");

mkdirSync(custom);

const base = JSON.parse(
  readFileSync(
    new URL("../languages/typescript.json", import.meta.url),
    "utf8",
  ),
);

const { fileURLToPath } = await import("node:url");

function installCustomPack() {
  writeFileSync(
    join(custom, "custom.json"),
    JSON.stringify({
      ...base,
      id: "local-test",
      extensions: [".localtest"],
      core: false,
      wasm: fileURLToPath(
        new URL("../languages/" + base.wasm, import.meta.url),
      ),
      linter: {
        name: "Fixture analyzer",
        command: [process.execPath, "--version"],
      },
    }),
  );
}

const { machineApp } = await import("../dist/machine-app.js");
const { Projects } = await import("../dist/projects.js");
const { git } = await import("../dist/files.js");
const projects = new Projects(dir);
const server = machineApp(projects).listen(0, "127.0.0.1");

await once(server, "listening");

const url = "http://127.0.0.1:" + server.address().port;
const client = new Client({ name: "language-proof", version: "1" });

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, result.content[0].text);

  return JSON.parse(result.content[0].text);
}

try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );

  const files = [
    [
      "local-test",
      "work.localtest",
      "function work(x:boolean) { if(x && x) return 1; return 0; }",
    ],
    ["python", "work.py", "def work(x):\n if x and x > 0:\n  return x\n"],
    [
      "go",
      "work.go",
      "package work\nfunc Work(x bool) bool { if x && x {return x};return false }",
    ],
    ["rust", "work.rs", "fn work(x:bool)->bool{if x && x {return x;} false}"],
  ];

  for (const [language, file, source] of files) {
    const root = join(dir, language);
    mkdirSync(root);
    git(root, "init", "-b", "main");
    writeFileSync(join(root, file), source);
    const { id: project } = await call("register_project", { path: root });
    const endpoint = url + "/projects/" + project + "/settings";

    if (language === "local-test") {
      const initial = await (await fetch(endpoint)).json();
      assert.ok(!initial.languages.some((entry) => entry.id === language));
      installCustomPack();
      const refreshed = await (await fetch(endpoint)).json();
      assert.equal(
        refreshed.languages.find((entry) => entry.id === language)?.linter,
        "Fixture analyzer",
      );
      assert.deepEqual(refreshed.settings.linters, []);

      const saved = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: refreshed.revision,
          settings: { ...refreshed.settings, linters: [language] },
        }),
      });

      assert.ok(saved.ok, await saved.text());
      assert.deepEqual(
        (await call("get_project_settings", { project })).settings.linters,
        [language],
      );
    }

    const before = await call("get_project_settings", { project });
    assert.equal((await call("get_repository_report", { project })).total, 0);

    const state = await call("set_project_language", {
      project,
      revision: before.revision,
      language,
      enabled: true,
    });

    assert.deepEqual((await (await fetch(endpoint)).json()).settings.packs, [
      language,
    ]);
    const result = await call("get_repository_report", { project });
    assert.equal(result.items[0].complexity, 3);
    assert.equal(result.items[0].score, null);

    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: state.revision,
        settings: { ...state.settings, packs: [] },
      }),
    });

    assert.ok(response.ok);
    assert.equal((await call("get_repository_report", { project })).total, 0);
    console.log(
      language +
        ": agent enabled, dashboard confirmed, complexity 3, dashboard disabled",
    );
  }

  assert.ok(existsSync(join(dir, "grammars")));
  assert.equal(readdirSync(join(dir, "grammars")).length, 3);
} finally {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
