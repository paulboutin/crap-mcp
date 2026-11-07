import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const [mode, value, ...rest] = process.argv.slice(2);

if (mode && (!["--base", "--snapshot"].includes(mode) || !value || rest.length))
  throw Error("Usage: npm run summary -- [--base REF | --snapshot ID]");

const args =
  mode === "--snapshot"
    ? { snapshot: value }
    : { base: value ?? process.env.CRAP_BASE ?? "HEAD" };

const client = new Client({ name: "session-summary", version: "1" });

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../dist/server.js", import.meta.url)),
        process.cwd(),
      ],
    }),
  );

  const result = await client.callTool({
    name: "review_changes",
    arguments: { ...args, format: "chat" },
  });

  if (result.isError) throw Error(result.content[0].text);
  console.log(result.content[0].text);
} finally {
  await client.close();
}
