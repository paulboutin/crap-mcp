import { prepareLanguage } from "./syntax.ts";
import { adapter, languages } from "./languages.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { digest, readJson, writeJson, type Repo } from "./files.ts";

export const lintTemplate = z
  .object({
    rules: z.record(z.string(), z.string()),
    ignorePatterns: z.array(z.string()),
  })
  .parse(
    JSON.parse(
      readFileSync(new URL("../.oxlintrc.json", import.meta.url), "utf8"),
    ),
  );

const defaults = Object.keys(lintTemplate.rules);

export const catalog = [
  ...defaults,
  "eslint/eqeqeq",
  "eslint/no-console",
  "eslint/no-alert",
];

const ruleList = z
  .array(z.enum(catalog))
  .max(catalog.length)
  .refine(
    (names) => new Set(names).size === names.length,
    "Duplicate lint rules",
  );

export const targets = z
  .object({
    maxCrap: z.number().positive().max(1000000),
    minCoverage: z.number().min(0).max(100),
    rules: ruleList,
    packs: z
      .array(z.enum(languages.flatMap((l) => (l.core ? [] : [l.id]))))
      .default([]),
    linters: z
      .array(z.enum(languages.flatMap((l) => (l.linter ? [l.id] : []))))
      .default([]),
  })
  .strict();

export type Targets = z.infer<typeof targets>;

const change = z.object({
  at: z.string(),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  maxCrap: z.number(),
  minCoverage: z.number(),
});

const stored = z.object({ settings: targets, changes: z.array(change) });

export const edit = z
  .object({ revision: z.string(), settings: targets })
  .strict();

export function qualityPolicy(repo: Repo) {
  const state = readJson(join(repo.local, "quality-policy.json"), stored) ?? {
    settings: {
      maxCrap: 30,
      minCoverage: 0,
      rules: defaults,
      packs: [],
      linters: [],
    },
    changes: [],
  };

  return {
    ...state,
    revision: digest(JSON.stringify(state)),
    catalog,
    languages: languages.map(({ id, core, extensions, bytes, linter }) => ({
      id,
      core,
      extensions,
      bytes,
      linter: linter?.name,
    })),
  };
}

export function updatePolicy(repo: Repo, input: z.infer<typeof edit>) {
  const current = qualityPolicy(repo);

  if (current.revision !== input.revision)
    throw Error("Settings changed. Reload before saving.");
  const settings = input.settings;

  if (JSON.stringify(settings) === JSON.stringify(current.settings))
    return current;

  const before = enabled(current.settings);
  const after = enabled(settings);
  const added = after.filter((name) => !before.includes(name));
  const removed = before.filter((name) => !after.includes(name));

  const entry = {
    at: new Date().toISOString(),
    added,
    removed,
    maxCrap: settings.maxCrap,
    minCoverage: settings.minCoverage,
  };

  writeJson(join(repo.local, "quality-policy.json"), {
    settings,
    changes: [entry, ...current.changes],
  });

  return qualityPolicy(repo);
}

function enabled(settings: Targets) {
  return [
    ...settings.rules,
    ...settings.packs.map((id) => "pack/" + id),
    ...settings.linters.map((id) => "linter/" + id),
  ];
}

export async function applyPolicy(repo: Repo, input: z.infer<typeof edit>) {
  if (qualityPolicy(repo).revision !== input.revision)
    throw Error("Settings changed. Reload before saving.");
  await Promise.all(input.settings.packs.map(prepareLanguage));

  return updatePolicy(repo, input);
}

export const languageChange = z.object({
  project: z.string(),
  language: z.string(),
  enabled: z.boolean(),
  revision: z.string(),
  linter: z.boolean().optional(),
});

function toggle(ids: string[], id: string, on: boolean) {
  const set = new Set(ids);

  if (on) set.add(id);
  else set.delete(id);

  return [...set];
}

export function setLanguage(repo: Repo, q: z.infer<typeof languageChange>) {
  const pack = adapter(q.language);

  if (pack.core && !q.enabled)
    throw Error("Core languages are always enabled.");

  if (q.linter && (!pack.linter || !q.enabled))
    throw Error("Enable a language with a supported linter first.");
  const { settings } = qualityPolicy(repo);

  if (!pack.core) settings.packs = toggle(settings.packs, pack.id, q.enabled);

  if (q.linter !== undefined || !q.enabled)
    settings.linters = toggle(settings.linters, pack.id, q.linter === true);

  return applyPolicy(repo, { revision: q.revision, settings });
}
