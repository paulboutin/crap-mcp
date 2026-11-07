import { prepareLanguage } from "./syntax.ts";
import { adapter, languages } from "./languages.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  teamFile,
  teamPath,
  directories,
  digest,
  readJson,
  writeJson,
  type Repo,
} from "./files.ts";

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
    omitDirectories: directories.default([]),
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
  reason: z.string().optional(),
});

const text = z.string().trim().min(1).max(2000);

export const observation = z.object({
  before: z.string(),
  after: z.string(),
  finding: text,
  conclusion: text,
  nextRule: text,
});

const lesson = observation.extend({
  evidence: z.array(z.string()),
  beforeSnapshot: z.string().nullable().optional(),
  afterSnapshot: z.string().nullable().optional(),
  beforeCommit: z.string().nullable(),
  afterCommit: z.string().nullable(),
});

const captured = z.object({
  snapshot: z.string(),
  at: z.string(),
  complete: z.boolean(),
  findings: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      symbol: z.string(),
      reason: z.string(),
    }),
  ),
});

const stored = z.object({
  settings: targets,
  changes: z.array(change),
  lessons: z.array(lesson).default([]),
  capture: captured.nullable().default(null),
});

type State = z.infer<typeof stored>;

const manifest = stored.extend({ version: z.literal(1) }).strict();

function saveState(repo: Repo, state: State, shared: boolean) {
  const parsed = stored.parse(state);

  if (shared)
    writeJson(join(repo.root, teamFile), { version: 1, ...parsed }, true);
  else writeJson(join(repo.local, "quality-policy.json"), parsed);
}

export const edit = z
  .object({ revision: z.string(), settings: targets, reason: text.optional() })
  .strict();

export function qualityPolicy(repo: Repo) {
  const path = teamPath(repo.root);

  const state = (path
    ? readJson(path, manifest)
    : readJson(join(repo.local, "quality-policy.json"), stored)) ?? {
    lessons: [],
    capture: null,
    settings: {
      maxCrap: 30,
      minCoverage: 0,
      rules: defaults,
      omitDirectories: [],
      packs: [],
      linters: [],
    },
    changes: [],
  };

  return {
    ...state,
    shared: Boolean(path),
    revision: digest(JSON.stringify(state)),
    catalog,
    analysisExclusions: repo.config.exclude,
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
    reason: input.reason,
    at: new Date().toISOString(),
    added,
    removed,
    maxCrap: settings.maxCrap,
    minCoverage: settings.minCoverage,
  };

  saveState(
    repo,
    {
      ...current,
      settings,
      changes: [entry, ...current.changes],
    },
    current.shared,
  );

  return qualityPolicy(repo);
}

function enabled(settings: Targets) {
  return [
    ...settings.rules,
    ...settings.omitDirectories.map((path) => "omit/" + path),
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

export function saveCapture(
  repo: Repo,
  revision: string,
  capture: State["capture"],
) {
  const state = qualityPolicy(repo);

  if (state.revision !== revision)
    throw Error("Settings changed. Reload before sharing.");
  saveState(repo, { ...state, capture }, true);

  return qualityPolicy(repo).revision;
}

export function saveLesson(
  repo: Repo,
  revision: string,
  input: z.infer<typeof lesson>,
) {
  const state = qualityPolicy(repo);

  if (state.revision !== revision)
    throw Error("Settings changed. Reload before recording.");

  const lessons = state.lessons.filter(
    (item) =>
      !(
        item.before === input.before &&
        item.after === input.after &&
        item.finding === input.finding
      ),
  );

  saveState(repo, { ...state, lessons: [input, ...lessons] }, state.shared);
}
