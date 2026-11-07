import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { adapter, languageFor } from "./languages.ts";
import { z } from "zod";

export const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

export function git(root: string, ...args: string[]) {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function revision(root: string, ref: string) {
  return git(
    root,
    "rev-parse",
    "--verify",
    "--end-of-options",
    ref + "^{commit}",
  ).trim();
}

export function maybeRevision(root: string, ref: string) {
  try {
    return revision(root, ref);
  } catch {
    return null;
  }
}

export const maxSourceBytes = 16 * 1024 * 1024;

export function safeFile(root: string, file: string) {
  const full = resolve(root, file),
    local = relative(root, full);

  if (
    !local ||
    local === ".." ||
    local.startsWith(".." + sep) ||
    isAbsolute(local) ||
    realpathSync(full) !== full
  )
    throw Error(
      "Expected a regular file inside the repository (no symlinks): " + file,
    );
  const stat = statSync(full);

  if (!stat.isFile() || stat.size > maxSourceBytes)
    throw Error("Not a regular source file below 16 MiB: " + file);

  return full;
}

export const configSchema = z
  .object({
    suite: z.string().min(1).default("unit"),
    checks: z.array(z.array(z.string().min(1)).min(1)).optional(),
    report: z.string().min(1).optional(),
    command: z.array(z.string().min(1)).min(1).optional(),
    integrationBranch: z.string().min(1).default("main"),
    exclude: z.array(z.string().min(1)).default([]),
    criticalPaths: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

export function repository(path: string) {
  const root = realpathSync(git(path, "rev-parse", "--show-toplevel").trim());

  const common = git(
    root,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ).trim();

  const config = loadConfig(root);

  const local = resolve(
    git(root, "rev-parse", "--absolute-git-dir").trim(),
    "crap-mcp-local-v2",
  );

  const { packs, omitDirectories } = projectScope(local);

  return {
    root,
    config,
    local,
    packs,
    omitDirectories,
    store: resolve(common, "crap-mcp-v2"),
  };
}

// Directory names are relative to the checkout. A trailing slash is optional.
const directory = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\.\//, "").replace(/\/$/, ""))
  .pipe(
    z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (path) =>
          !/^[A-Za-z]:|[\\*?[\]{}\p{Cc}]/u.test(path) &&
          path
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== ".."),
        "Use a repository-relative directory path",
      ),
  );

export const directories = z
  .array(directory)
  .max(200)
  .transform((paths) => [...new Set(paths)].sort());

const scopeSchema = z.object({
  packs: z.array(z.string()).default([]),
  omitDirectories: directories.default([]),
});

function projectScope(local: string) {
  return (
    readJson(
      join(local, "quality-policy.json"),
      z.object({ settings: scopeSchema }),
    )?.settings ?? scopeSchema.parse({})
  );
}

export function omitted(repo: Repo, file: string) {
  return repo.omitDirectories.some((directory) =>
    file.startsWith(directory + "/"),
  );
}

export function policy(repo: Repo) {
  return digest(
    JSON.stringify([
      repo.config.suite,
      repo.config.command,
      repo.config.exclude,
      ...repo.omitDirectories.map((path) => "omit:" + path),
      ...repo.packs.map((id) => adapter(id).version),
    ]),
  );
}

export function checkConfig(repo: Repo) {
  const { packs, omitDirectories } = projectScope(repo.local);

  if (
    JSON.stringify([packs, omitDirectories]) !==
    JSON.stringify([repo.packs, repo.omitDirectories])
  )
    throw Error("Project scope changed; refresh the project");

  if (JSON.stringify(loadConfig(repo.root)) !== JSON.stringify(repo.config))
    throw Error("Repository configuration changed; restart the MCP process");
}

function loadConfig(root: string) {
  try {
    return configSchema.parse(
      JSON.parse(readFileSync(safeFile(root, ".crap.json"), "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && isMissing(error))
      return configSchema.parse({});
    throw error;
  }
}

export function isMissing(error: Error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export type Repo = ReturnType<typeof repository>;

export function nul(output: string) {
  return output.split("\0").filter(Boolean);
}

export function workFiles(repo: Repo) {
  return [
    ...new Set(
      nul(
        git(
          repo.root,
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ),
      ),
    ),
  ].sort();
}

export function supported(file: string, packs: string[] = []) {
  const lang = languageFor(file);

  return !!lang && (lang.core || packs.includes(lang.id));
}

export function eligible(repo: Repo, file: string) {
  return (
    supported(file, repo.packs) &&
    !omitted(repo, file) &&
    !file
      .split("/")
      .some((part) =>
        [
          "node_modules",
          "dist",
          ".build",
          "coverage",
          ".git",
          ".venv",
          "__pycache__",
          "target",
          "vendor",
        ].includes(part),
      ) &&
    !repo.config.exclude.some((prefix) => file.startsWith(prefix))
  );
}

export function writeJson<T>(file: string, value: T) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}

export function readJson<T>(file: string, schema: z.ZodType<T>) {
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && isMissing(error)) return undefined;
    throw error;
  }
}
