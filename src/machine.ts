import { once } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { machineApp } from "./machine-app.ts";
import { Projects } from "./projects.ts";

const projects = new Projects(
  process.env.CRAP_DATA_DIR ?? join(homedir(), ".local/share/crap-mcp"),
);

const port = Number(process.env.CRAP_PORT ?? 47731);

const server = machineApp(projects).listen(port, "127.0.0.1");

await once(server, "listening");

console.log("Local CRAP dashboard: http://127.0.0.1:" + port + "/");
