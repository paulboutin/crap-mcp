import {
  colorSummary,
  colorExplanation,
  sample,
  measurePair,
  type Paint,
} from "./color-contrast.ts";
import { sourceExcerpt } from "./finding-detail.ts";
import { htmlPaint } from "./accessibility-paint.ts";
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
import { qualityPolicy } from "./quality-policy.ts";
import { visitSources } from "./source-visit.ts";
import { inspectAccessibility } from "./accessibility-markup.ts";
import {
  accessibilityCatalog,
  accessibilityExplanation,
  accessibilityIds,
  accessibilityRule,
  observation,
  assessedElement,
  passedExplanation,
  type Evaluate,
} from "./accessibility-rules.ts";

const version = "accessibility-1";

const evidence = z.object({
  id: z.string(),
  version: z.literal(version),
  policy: z.string(),
  rules: z.array(accessibilityRule),
  colors: z.array(sample),
  assessed: z.number(),
  passed: z.number(),
  passedChecks: z.array(assessedElement).optional(),
  findings: z.array(observation),
  pending: z.array(observation),
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
});

type Evidence = z.infer<typeof evidence>;

function active(repo: Repo) {
  const { settings } = qualityPolicy(repo);

  return {
    rules: [...(settings.accessibilityRules ?? accessibilityIds)].sort(),
    palette: settings.accessibilityPalette ?? [],
  };
}

function candidate(repo: Repo, file: string) {
  return (
    inScope(repo, file) &&
    /\.(?:html?|tsx|jsx|[cm]?js|swift|vue|svelte|storyboard|xib|astro)$/i.test(
      file,
    )
  );
}

function inspect(
  s: Evidence,
  file: string,
  source: string,
  sheets: Map<string, string>,
) {
  const lines = source.split(/\r?\n/);
  const duplicates = new Map<string, number>();
  const passes: NonNullable<Evidence["passedChecks"]> = [];
  const findings: Evidence["findings"] = [];
  const pending: Evidence["pending"] = [];

  const record: Evaluate = (rule, verdict, el) => {
    if (!s.rules.includes(rule)) return;

    const location = {
      file,
      line: el.line,
      end: el.end ?? el.line,
      excerpt: sourceExcerpt(lines, el.line, el.end ?? el.line),
      evidence: el.evidence,
      rule,
    };

    if (verdict === "pass") {
      passes.push(location);

      return;
    }

    const key = digest(
      JSON.stringify([
        file,
        rule,
        el.source,
        el.tag === "button" ? el.text : null,
      ]),
    );

    const count = (duplicates.get(key) ?? 0) + 1;
    duplicates.set(key, count);
    const list = verdict === "fail" ? findings : pending;
    list.push({
      id: key + ":" + count,
      ...location,
      status: verdict,
    });
  };

  const colors: Evidence["colors"] = [];

  const paint: Paint = (line, element, pair, why, end = line) => {
    colors.push({
      file,
      line,
      end,
      element,
      pair,
      reason: why,
      excerpt: sourceExcerpt(lines, line, end),
    });

    const outcome = pair
      ? pair.ratio >= pair.threshold
        ? "pass"
        : "fail"
      : "review";

    record("text-contrast", outcome, {
      line,
      tag: element,
      end,
      evidence: pair
        ? pair.foreground +
          " on " +
          pair.background +
          " measured " +
          pair.ratio.toFixed(3) +
          ":1 against a target of " +
          pair.threshold +
          ":1."
        : why,
      source: JSON.stringify([
        element,
        pair?.foreground,
        pair?.background,
        pair?.threshold,
      ]),
      text: "",
      attrs: new Map(),
      spread: false,
    });
  };

  const checkColor = s.rules.includes("text-contrast");
  inspectAccessibility(file, source, record, checkColor ? paint : undefined);

  if (checkColor && /\.html?$/i.test(file))
    htmlPaint(file, source, sheets, paint);

  for (const color of colors) s.colors.push(color);
  s.passed += passes.length;

  for (const item of passes) s.passedChecks!.push(item);

  for (const item of findings) s.findings.push(item);

  for (const item of pending) s.pending.push(item);
  s.assessed++;
}

function stylesheets(repo: Repo, commit: string | null) {
  const sheets = new Map<string, string>();
  visitSources(
    repo,
    commit,
    (r, file) => inScope(r, file) && file.endsWith(".css"),
    (file, read) => {
      try {
        sheets.set(file, read());
      } catch {
        /* Linked files without safe readable source are reported as pending. */
      }
    },
  );

  return sheets;
}

export function accessibilityScan(repo: Repo, ref?: string) {
  checkConfig(repo);
  const start = active(repo);
  const { rules, palette } = start;

  const policy = digest(
    JSON.stringify([version, rules, repo.config.exclude, repo.omitDirectories]),
  );

  const s: Evidence = {
    id: "",
    version,
    policy,
    rules,
    assessed: 0,
    colors: [],
    passed: 0,
    passedChecks: [],
    findings: [],
    pending: [],
    skipped: [],
  };

  const hashes: string[] = [];
  const commit = ref ? revision(repo.root, ref) : null;

  const sheets = rules.includes("text-contrast")
    ? stylesheets(repo, commit)
    : new Map<string, string>();

  visitSources(repo, commit, candidate, (file, read) => {
    try {
      const source = read();
      hashes.push(file, digest(source));
      inspect(s, file, source, sheets);
    } catch (error) {
      s.skipped.push({ file, reason: String(error) });
    }
  });

  for (const p of palette)
    s.colors.push({
      file: "Project palette",
      line: 0,
      element: p.label,
      pair: measurePair(p.first, p.second, 3),
    });
  checkConfig(repo);

  if (JSON.stringify(active(repo)) !== JSON.stringify(start))
    throw Error("Accessibility rules changed during scan. Retry.");
  s.id = digest(JSON.stringify([s, hashes]));
  writeJson(join(repo.local, "accessibility", s.id + ".json"), s);

  return s;
}

export function accessibilityBaseline(repo: Repo, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id))
    throw Error("Invalid accessibility snapshot ID");
  const s = readJson(join(repo.local, "accessibility", id + ".json"), evidence);

  if (s?.id !== id)
    throw Error("Unknown accessibility snapshot for this checkout");

  return s;
}

function score(s: Evidence) {
  const evaluated = s.passed + s.findings.length;

  return evaluated && !s.skipped.length
    ? Math.floor((100 * s.passed) / evaluated)
    : null;
}

function unmatched(from: Evidence, to: Evidence) {
  const existing = new Set(to.findings.map((f) => f.id));

  const uncertain = new Set(
    to.pending.map((f) => JSON.stringify([f.file, f.rule])),
  );

  const missing = from.findings.filter((f) => !existing.has(f.id));

  const confirmed = missing.filter(
    (f) => !uncertain.has(JSON.stringify([f.file, f.rule])),
  );

  return { confirmed, unverified: missing.length - confirmed.length };
}

function changes(now: Evidence, before?: Evidence) {
  if (!before) return null;

  if (before.policy !== now.policy)
    throw Error("Accessibility policy differs from starting snapshot");
  const comparable = score(before) !== null && score(now) !== null;

  const added = unmatched(now, before),
    removed = unmatched(before, now);

  return {
    snapshot: before.id,
    score: score(before),
    colorblindScore: colorSummary(before.colors, before.skipped.length).score,
    baselineColors: before.colors.map(colorExplanation),
    comparable,
    unverified: added.unverified + removed.unverified,
    introduced: comparable ? added.confirmed.map(accessibilityExplanation) : [],
    resolved: comparable ? removed.confirmed.map(accessibilityExplanation) : [],
  };
}

function reason(s: Evidence) {
  if (!s.rules.length) return "No enabled checks";

  if (s.skipped.length) return "Incomplete file scan";

  return "No applicable checks with a known result";
}

export function accessibilityReport(now: Evidence, before?: Evidence) {
  const value = score(now);
  const comparison = changes(now, before);
  const headline = value === null ? "Unrated" : value + "/100";

  const detail =
    now.passed +
    " passed · " +
    now.findings.length +
    " failed · " +
    now.pending.length +
    " need review";

  const scope =
    now.assessed + " files scanned · " + now.skipped.length + " skipped";

  const comparisonText = comparison?.comparable
    ? comparison.score +
      " → " +
      value +
      " · " +
      comparison.introduced.length +
      " introduced · " +
      comparison.resolved.length +
      " resolved" +
      (comparison.unverified
        ? " · " + comparison.unverified + " changes need verification"
        : "")
    : "No comparable baseline";

  return {
    snapshot: now.id,
    version,
    rules: now.rules,
    score: value,
    headline,
    colorblind: colorSummary(now.colors, now.skipped.length),
    colors: now.colors.map(colorExplanation),
    scope,
    detail,
    reason: value === null ? reason(now) : null,
    comparisonText,
    comparison,
    assessed: now.assessed,
    passed: now.passed,
    passedChecks: (now.passedChecks ?? []).map(passedExplanation),
    pending: now.pending.map(accessibilityExplanation),
    skipped: now.skipped,
    findings: now.findings.map(accessibilityExplanation),
    catalog: accessibilityCatalog,
  };
}

export type AccessibilityReport = ReturnType<typeof accessibilityReport>;

export function dashboardAccessibility(
  repo: Repo,
  id?: string,
  ref?: string | null,
) {
  const now = accessibilityScan(repo);

  const before = id
    ? accessibilityBaseline(repo, id)
    : ref
      ? accessibilityScan(repo, ref)
      : undefined;

  if (before && before.policy !== now.policy)
    return {
      ...accessibilityReport(now),
      comparisonText: "Accessibility policy changed. Capture a new baseline.",
    };

  return accessibilityReport(now, before);
}

function gate(value: number | null, pending: number, target?: number | null) {
  if (target == null) return "report only";

  if (value === null) return "incomplete";

  if (value < target) return "failed";

  return pending ? "incomplete" : "passed";
}

export function accessibilityCheck(
  repo: Repo,
  target?: number | null,
  colorTarget?: number | null,
) {
  try {
    const s = accessibilityScan(repo),
      value = score(s);

    const colorblind = colorSummary(s.colors, s.skipped.length);

    return {
      snapshot: s.id,
      policy: s.policy,
      score: value,
      colorblind,
      colorblindTarget: colorTarget ?? null,
      colorblindStatus: gate(colorblind.score, colorblind.pending, colorTarget),
      assessed: s.assessed,
      passed: s.passed,
      failed: s.findings.length,
      pending: s.pending.length,
      skipped: s.skipped.length,
      target: target ?? null,
      status: gate(value, s.pending.length, target),
      error: null,
    };
  } catch (error) {
    return {
      snapshot: null,
      colorblindTarget: colorTarget ?? null,
      colorblindStatus: gate(null, 0, colorTarget),
      score: null,
      target: target ?? null,
      status: gate(null, 0, target),
      error: String(error),
    };
  }
}
