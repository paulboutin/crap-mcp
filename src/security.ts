import { visitSources } from "./source-visit.ts";
import { join } from "node:path";
import { z } from "zod";
import {
  checkConfig,
  digest,
  inScope,
  readJson,
  revision,
  writeJson,
  type Repo,
} from "./files.ts";
import { languageFor } from "./languages.ts";
import { qualityPolicy } from "./quality-policy.ts";
import {
  inspectSecurity,
  securityCatalog,
  securityExplanation,
  securityFinding,
  securityIds,
  ruleId,
} from "./security-rules.ts";

const version = "appsec-1";

const evidence = z.object({
  id: z.string(),
  policy: z.string(),
  version: z.literal(version),
  rules: z.array(ruleId),
  assessed: z.number(),
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
  findings: z.array(securityFinding),
});

type Evidence = z.infer<typeof evidence>;

const webExtensions = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

const otherSource =
  /\.(?:py|go|rs|php|java|kt|kts|rb|c|h|cpp|cs|m|mm|dart|vue|svelte)$/i;

function grammar(file: string) {
  if (file.endsWith(".swift")) return "swift";

  if (webExtensions.test(file))
    return /[jt]sx$/i.test(file) ? "tsx" : "typescript";

  return null;
}

function candidate(repo: Repo, file: string) {
  if (!inScope(repo, file) || /\.d\.[cm]?ts$/.test(file)) return false;

  return Boolean(grammar(file) || languageFor(file) || otherSource.test(file));
}

function collect(
  s: Evidence,
  file: string,
  read: () => string,
  hashes: string[],
) {
  const parser = grammar(file);
  const scope = parser === "swift" ? "swift" : "web";

  const applicable = s.rules.filter((rule) =>
    ["both", scope].includes(securityCatalog[rule].scope),
  );

  try {
    if (!parser) throw Error("No security rules for this language");

    if (!applicable.length) throw Error("No applicable rules enabled");
    const source = read();
    hashes.push(file, digest(source));

    for (const f of inspectSecurity(file, parser, source, applicable))
      s.findings.push(f);
    s.assessed++;
  } catch (error) {
    s.skipped.push({ file, reason: String(error) });
  }
}

function activeRules(repo: Repo) {
  return [
    ...(qualityPolicy(repo).settings.securityRules ?? securityIds),
  ].sort();
}

export function securityScan(repo: Repo, ref?: string) {
  checkConfig(repo);

  const rules = activeRules(repo);

  const policy = digest(
    JSON.stringify([version, rules, repo.config.exclude, repo.omitDirectories]),
  );

  const s: Evidence = {
    id: "",
    policy,
    version,
    rules,
    assessed: 0,
    skipped: [],
    findings: [],
  };

  const hashes: string[] = [];
  const commit = ref ? revision(repo.root, ref) : null;

  const cache =
    commit &&
    join(repo.local, "security", "base-details-" + commit + "-" + policy + ".json");

  if (cache) {
    const known = readJson(cache, evidence);

    if (known) return known;
  }

  visitSources(repo, commit, candidate, (file, read) =>
    collect(s, file, read, hashes),
  );

  checkConfig(repo);

  if (JSON.stringify(activeRules(repo)) !== JSON.stringify(rules))
    throw Error("Security rules changed during scan; retry");

  s.id = digest(JSON.stringify([s, hashes]));
  writeJson(join(repo.local, "security", s.id + ".json"), s);

  if (cache && !s.skipped.length) writeJson(cache, s);

  return s;
}

export function securityBaseline(repo: Repo, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid security snapshot ID");
  const s = readJson(join(repo.local, "security", id + ".json"), evidence);

  if (s?.id !== id) throw Error("Unknown security snapshot for this checkout");

  return s;
}

function score(s: Evidence) {
  if (!s.rules.length || !s.assessed || s.skipped.length) return null;

  const penalty = s.findings.reduce(
    (sum, f) => sum + (securityCatalog[f.rule].severity === "high" ? 25 : 10),
    0,
  );

  return Math.max(0, 100 - penalty);
}

function changes(now: Evidence, before?: Evidence) {
  if (!before) return null;

  if (before.policy !== now.policy)
    throw Error(
      "Security policy differs from starting snapshot; take a new baseline",
    );
  const left = new Set(before.findings.map((f) => f.id));
  const right = new Set(now.findings.map((f) => f.id));
  const comparable = score(before) !== null && score(now) !== null;

  return {
    snapshot: before.id,
    score: score(before),
    comparable,
    introduced: comparable
      ? now.findings.filter((f) => !left.has(f.id)).map(securityExplanation)
      : [],
    resolved: comparable
      ? before.findings.filter((f) => !right.has(f.id)).map(securityExplanation)
      : [],
  };
}

export function securityReport(now: Evidence, before?: Evidence) {
  const value = score(now);
  const comparison = changes(now, before);

  const unrated = !now.rules.length
    ? "No enabled rules"
    : now.skipped.length
      ? "Incomplete source scan"
      : "No assessable source files";

  const headline = value === null ? "Unrated" : value + "/100";

  const detail =
    now.assessed +
    " files assessed · " +
    now.skipped.length +
    " unassessed · " +
    now.findings.length +
    " findings";

  const comparisonText = comparison?.comparable
    ? comparison.score +
      " → " +
      value +
      " · " +
      comparison.introduced.length +
      " introduced · " +
      comparison.resolved.length +
      " resolved"
    : "No comparable baseline";

  return {
    snapshot: now.id,
    version,
    rules: now.rules,
    score: value,
    headline,
    detail: value === null ? unrated + " · " + detail : detail,
    comparisonText,
    comparison,
    assessed: now.assessed,
    skipped: now.skipped,
    findings: now.findings.map(securityExplanation),
    catalog: securityCatalog,
  };
}

export function dashboardSecurity(
  repo: Repo,
  id?: string,
  ref?: string | null,
) {
  const now = securityScan(repo);

  const before = id
    ? securityBaseline(repo, id)
    : ref
      ? securityScan(repo, ref)
      : undefined;

  if (before && before.policy !== now.policy)
    return {
      ...securityReport(now),
      comparisonText:
        "Security policy changed. Take a new baseline to compare.",
    };

  return securityReport(now, before);
}

function checkEvidence(s: Evidence, target?: number | null) {
  const value = score(s);

  return {
    error: null,
    snapshot: s.id,
    policy: s.policy,
    score: value,
    assessed: s.assessed,
    skipped: s.skipped.length,
    findings: s.findings.length,
    target: target ?? null,
    status:
      target == null
        ? "report only"
        : value === null
          ? "incomplete"
          : value < target
            ? "failed"
            : "passed",
  };
}

// Preserve the designated suite result even when a concurrent edit invalidates the security scan.
export function securityCheck(repo: Repo, target?: number | null) {
  try {
    return checkEvidence(securityScan(repo), target);
  } catch (error) {
    return {
      error: String(error),
      snapshot: null,
      policy: null,
      score: null,
      assessed: null,
      skipped: null,
      findings: null,
      target: target ?? null,
      status: target == null ? "report only" : "incomplete",
    };
  }
}

export type SecurityReport = ReturnType<typeof securityReport>;
