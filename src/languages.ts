import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";

const names = z.array(z.string().min(1));

const manifest = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    wasm: z.string().min(1),
    bytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    core: z.boolean().default(false),
    linter: z.object({ name: z.string(), command: names.min(1) }).optional(),
    extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/)).min(1),
    functions: names,
    containers: names,
    controls: names,
    decisions: names,
    nesting: names,
  })
  .strict();

const dataDir =
  process.env.CRAP_DATA_DIR ?? join(homedir(), ".local/share/crap-mcp");

export function loadLanguages(directory: string) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const bytes = readFileSync(join(directory, file), "utf8");
      const spec = manifest.parse(JSON.parse(bytes));
      const remote = spec.wasm.startsWith("https://");

      const path = remote
        ? join(dataDir, "grammars", spec.sha256 + ".wasm")
        : resolve(directory, spec.wasm);

      return {
        ...spec,
        path,
        remote,
        version: createHash("sha256").update(bytes).digest("hex"),
      };
    });
}

export const languages = [
  ...loadLanguages(fileURLToPath(new URL("../languages", import.meta.url))),
  ...loadLanguages(process.env.CRAP_LANGUAGE_DIR ?? join(dataDir, "languages")),
];

export type Adapter = (typeof languages)[number];

const extensions = new Map<string, Adapter>();
const ids = new Map<string, Adapter>();

for (const language of languages) {
  if (ids.has(language.id)) throw Error("Duplicate language ID " + language.id);
  ids.set(language.id, language);

  for (const ext of language.extensions) {
    if (extensions.has(ext)) throw Error("Conflicting adapters for " + ext);
    extensions.set(ext, language);
  }
}

export function adapter(id: string) {
  const result = ids.get(id);

  if (!result) throw Error("Unknown language pack: " + id);

  return result;
}

export function languageFor(file: string) {
  if (/\.d\.[cm]?ts$/.test(file)) return undefined;

  return extensions.get(extname(file));
}

export function verifyGrammar(pack: Adapter, bytes: Uint8Array) {
  if (
    bytes.length !== pack.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== pack.sha256
  )
    throw Error("Grammar checksum mismatch for " + pack.id);
}

export async function acquireGrammar(pack: Adapter) {
  if (existsSync(pack.path) || !pack.remote) {
    const bytes = readFileSync(pack.path);
    verifyGrammar(pack, bytes);

    return bytes;
  }

  const response = await fetch(pack.wasm, {
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok || !response.body)
    throw Error("Grammar download failed: " + response.status);
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of response.body) {
    length += chunk.length;

    if (length > pack.bytes) throw Error("Grammar exceeds expected size");
    chunks.push(chunk);
  }

  const bytes = Buffer.concat(chunks);
  verifyGrammar(pack, bytes);
  mkdirSync(join(dataDir, "grammars"), { recursive: true });
  const temp = pack.path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, bytes, { mode: 0o600 });
  renameSync(temp, pack.path);

  return bytes;
}
