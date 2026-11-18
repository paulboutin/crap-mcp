import { mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  digest,
  maybeRevision,
  readJson,
  writeJson,
  type Repo,
} from "./files.ts";
import { hash } from "./operational-schema.ts";
import {
  operationalReport,
  operationalSnapshot,
  type OperationalSnapshot,
} from "./operational-store.ts";

const entry = z
  .object({
    id: hash,
    at: z.iso.datetime(),
    snapshot: hash,
    scope: hash,
    stage: z.enum(["worktree", "integrated"]),
    previous: hash.nullable(),
    reason: z.string().trim().min(1).max(2000),
    integrationCommit: z.string().nullable(),
  })
  .strict();

const history = z
  .object({ version: z.literal(1), entries: z.array(entry) })
  .strict();

export const baselineSelection = z
  .object({
    snapshot: hash,
    revision: hash,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

function baselineHistory(repo: Repo) {
  const state = readJson(
    join(repo.local, "operational", "baselines.json"),
    history,
  ) ?? { version: 1 as const, entries: [] };

  return { ...state, revision: digest(JSON.stringify(state)) };
}

export function operationalBaselines(repo: Repo, offset = 0, limit = 20) {
  const state = baselineHistory(repo);

  return {
    revision: state.revision,
    total: state.entries.length,
    entries: state.entries.slice(offset, offset + limit).map((item) => {
      const s = operationalSnapshot(repo, item.snapshot);

      return {
        ...item,
        evidence: s.evidence,
        policyHash: s.evidence.policyHash,
      };
    }),
    nextOffset: offset + limit < state.entries.length ? offset + limit : null,
  };
}

function baselineScope(s: OperationalSnapshot) {
  const e = s.evidence;

  return digest(
    JSON.stringify([
      e.repository,
      e.workload,
      e.environment,
      e.mode,
      e.provenance?.suite,
    ]),
  );
}

function integrationCommit(repo: Repo, s: OperationalSnapshot) {
  if (s.evidence.provenance?.stage !== "integrated") return null;
  const commit = maybeRevision(repo.root, repo.config.integrationBranch);

  if (!commit || s.evidence.sourceCommit !== commit)
    throw Error(
      "An integrated baseline must measure the exact current integration revision; ancestry is insufficient. Fetch/update the integration reference and rerun the workload.",
    );

  return commit;
}

function selectBaseline(repo: Repo, input: z.infer<typeof baselineSelection>) {
  const q = baselineSelection.parse(input),
    state = baselineHistory(repo);

  if (state.revision !== q.revision)
    throw Error("Operational baselines changed. Reload before selecting.");

  const snapshot = operationalSnapshot(repo, q.snapshot),
    provenance = snapshot.evidence.provenance;

  if (!provenance)
    throw Error(
      "Legacy evidence stays readable but needs suite/build/routing provenance for baseline selection. Import a newly tagged observation; do not rewrite the old snapshot.",
    );
  const report = operationalReport(repo, q.snapshot);

  if (report.problems.length)
    throw Error("Current policy differs from this baseline candidate");
  const scope = baselineScope(snapshot);

  const previous =
    state.entries.find(
      (item) => item.scope === scope && item.stage === provenance.stage,
    )?.id ?? null;

  const body = {
    at: new Date().toISOString(),
    snapshot: q.snapshot,
    scope,
    stage: provenance.stage,
    previous,
    reason: q.reason,
    integrationCommit: integrationCommit(repo, snapshot),
  };

  const event = { id: digest(JSON.stringify(body)), ...body };
  writeJson(join(repo.local, "operational", "baselines.json"), {
    version: 1,
    entries: [event, ...state.entries],
  });

  return {
    entry: event,
    revision: baselineHistory(repo).revision,
    scorecard: report,
  };
}

export function selectOperationalBaseline(
  repo: Repo,
  input: z.infer<typeof baselineSelection>,
) {
  const dir = join(repo.local, "operational");
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "baseline-selection.lock");

  try {
    mkdirSync(lock);
  } catch {
    throw Error(
      "Baseline selection is locked. Retry after the other writer finishes; a crashed writer's empty lock directory needs removal before recovery.",
    );
  }

  try {
    return selectBaseline(repo, input);
  } finally {
    rmdirSync(lock);
  }
}
