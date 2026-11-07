import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maybeRevision, type Repo } from "./files.ts";

// Only the explicit issue-publishing CLI creates this local opt-in database.
export function reconcile(repo: Repo, head: string) {
  if (
    !existsSync(join(repo.store, "github.autosync")) ||
    head !== maybeRevision(repo.root, repo.config.integrationBranch)
  )
    return;

  const entry = new URL(
    import.meta.url.endsWith(".ts") ? "./issue-cli.ts" : "./issue-cli.js",
    import.meta.url,
  );

  const child = spawn(process.execPath, [fileURLToPath(entry), "sync"], {
    cwd: repo.root,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 90000,
  });

  child.on("error", (error) => console.error("Issue sync:", error.message));
  child.unref();
}
