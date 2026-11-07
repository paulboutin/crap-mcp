// OpenCode 1.x only offers interactive MCP setup. Preserve the user's JSONC.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, modify, applyEdits } from "jsonc-parser";

const [directory, url, mode] = process.argv.slice(2);

const files = ["config.json", "opencode.json", "opencode.jsonc"].map((name) =>
  join(directory, name),
);

const existing = files.filter(existsSync).at(-1);
const file = existing ? realpathSync(existing) : files[1];
const errors = [];
const source = existsSync(file) ? readFileSync(file, "utf8") : "{}\n";
const config = parse(source, errors, { allowTrailingComma: true });

if (errors.length || !config || Array.isArray(config))
  throw Error("Invalid OpenCode configuration: " + file);

const current = config.mcp?.crap_score;

if (current) {
  if (
    current.type !== "remote" ||
    current.url !== url ||
    current.enabled === false
  )
    throw Error("Existing OpenCode crap_score entry differs in " + file);
} else if (mode !== "--check") {
  const edits = modify(
    source,
    ["mcp", "crap_score"],
    { type: "remote", url, enabled: true },
    { formattingOptions: { insertSpaces: true, tabSize: 2 } },
  );

  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID();
  writeFileSync(tmp, applyEdits(source, edits), { mode: 0o600 });
  renameSync(tmp, file);
}
