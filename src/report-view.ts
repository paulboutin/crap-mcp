// Shipped as a standalone ES module in the offline report. Keep imports type-only.
import type { Health, Finding } from "./findings.ts";
import type { Delta } from "./review.ts";
import type { Snapshot } from "./scan.ts";

import type { FindingDetail } from "./finding-detail.ts";

type Contribution = ReturnType<
  typeof import("./session.ts").sessionContribution
>;

type PatternReport = import("./pattern-evidence.ts").PatternReport;

type Pattern = PatternReport["findings"][number];

type Row = Health & {
  patterns?: Pattern[];
  findings: Finding[];
  detail?: FindingDetail;
};

interface Review {
  summary?: ReturnType<typeof import("./session.ts").sessionSummary>;
  ref: string;
  commit: string;
  affected: number;
  contributions?: Contribution[];
  unassessed: string[];
  deltas: Delta[];
}

export interface Report {
  patterns?: PatternReport;
  recorded?: boolean;
  auditNotes?: string[];
  evidence?: ReturnType<typeof import("./project-learning.ts").projectEvidence>;
  accessibility?: import("./accessibility.ts").AccessibilityReport;
  security?: import("./security.ts").SecurityReport;
  repository: string;
  functions: Row[];
  snapshot: Omit<Snapshot, "rows" | "churn"> & { functions: number };
  review: Review | null;
}

function byId(doc: Document, id: string) {
  const element = doc.getElementById(id);

  if (!element) throw Error("Missing report element: " + id);

  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text: string,
) {
  const el = doc.createElement(tag);
  el.textContent = text;

  return el;
}

function details(doc: Document, title: string) {
  const group = doc.createElement("details");
  group.append(element(doc, "summary", title));

  return group;
}

function where(d: FindingDetail) {
  if (!d.line) return d.file;

  return d.file + ":" + d.line + (d.end && d.end !== d.line ? "–" + d.end : "");
}

function field(doc: Document, list: HTMLElement, label: string, value: string) {
  list.append(element(doc, "dt", label), element(doc, "dd", value));
}

function findingDetails(
  doc: Document,
  title: string,
  d: FindingDetail,
  evidence?: string,
) {
  const group = details(doc, title);
  group.className = "finding";
  const list = doc.createElement("dl");
  field(doc, list, "Location", where(d));

  if (evidence) field(doc, list, "Evidence", evidence);
  field(doc, list, "Why it appears", d.why);
  field(doc, list, "Potential impact", d.impact);
  field(doc, list, "Effect on the score", d.scoring);
  field(doc, list, "How to address it", d.action);
  field(doc, list, "How to verify", d.check);
  group.append(list);

  if (d.excerpt) group.append(element(doc, "pre", d.excerpt));
  else if (d.line)
    group.append(
      element(doc, "small", "This snapshot has line references only."),
    );

  return group;
}

function listEntry(doc: Document, list: HTMLElement, entry: HTMLElement) {
  const item = doc.createElement("li");
  item.append(entry);
  list.append(item);
}

function summary(doc: Document, r: Report) {
  const s = r.snapshot,
    measured = r.functions.filter((h) => h.score !== null).length;

  const labels = {
    repo: r.repository,
    meta:
      "Scanned " +
      new Date(s.at).toLocaleString() +
      " · " +
      (s.commit?.slice(0, 8) ?? "uncommitted") +
      " · " +
      s.suite,
    assessed: r.functions.length,
    filecount: s.files + " source files assessed",
    hot: r.functions.filter(isHot).length,
    unscored: r.functions.length - measured,
    "critical-count":
      r.functions.filter((h) => (h.score ?? 0) > 60).length + " above 60",
    "structure-count":
      r.functions.filter((h) => h.complexity >= 10).length +
      " functions with complexity ≥10 · " +
      r.functions.filter((h) => h.depth >= 4).length +
      " with nesting ≥4",
    changed: r.review?.affected ?? "—",
    comparison: r.review
      ? "Compared with " + r.review.ref
      : "No baseline available",
    fraction: measured + " of " + r.functions.length + " functions scored",
    "scan-status": s.complete
      ? "Complete scan"
      : "Partial scan · " + s.skipped.length + " skipped",
  };

  for (const [key, value] of Object.entries(labels))
    byId(doc, key).textContent = String(value);
  byId(doc, "scan-status").classList.toggle("partial", !s.complete);
  const meter = doc.querySelector("progress")!;
  meter.max = Math.max(1, r.functions.length);
  meter.value = measured;
}

function evidence(doc: Document, r: Report) {
  const s = r.snapshot,
    facts = byId(doc, "facts");

  for (const [label, value] of [
    ["Designated suite", s.suite],
    ["Coverage run", s.run ?? "None recorded"],
    ["Snapshot", s.id.slice(0, 16)],
  ]) {
    facts.append(element(doc, "dt", label), element(doc, "dd", value));
  }

  byId(doc, "skipcount").textContent = s.skipped.length + " skipped files";

  for (const item of s.skipped)
    byId(doc, "skips").append(
      element(doc, "li", item.file + ": " + item.reason),
    );
}

function deltaDetail(doc: Document, row: Delta) {
  const change = details(
    doc,
    row.symbol + " · " + (row.after ?? row.before)!.rule,
  );

  if (row.before)
    change.append(
      findingDetails(
        doc,
        "Baseline · " + where(row.before.detail),
        row.before.detail,
      ),
    );

  if (row.after)
    change.append(
      findingDetails(
        doc,
        "Current · " + where(row.after.detail),
        row.after.detail,
      ),
    );

  return change;
}

function patch(doc: Document, review: Review | null) {
  if (!review) {
    byId(doc, "diffmeta").textContent = "No starting revision is available.";

    return;
  }

  byId(doc, "diffmeta").textContent =
    review.affected +
    " affected functions · " +
    review.unassessed.length +
    " unassessed files · " +
    review.commit.slice(0, 8);
  const groups = new Map<string, Delta[]>();

  for (const delta of review.deltas) {
    const rows = groups.get(delta.status) ?? [];
    rows.push(delta);
    groups.set(delta.status, rows);
  }

  if (!groups.size)
    byId(doc, "deltas").textContent = "No finding changes reported.";

  for (const [status, rows] of groups) {
    const group = details(doc, rows.length + " " + status),
      list = doc.createElement("ul");

    for (const row of rows) {
      listEntry(doc, list, deltaDetail(doc, row));
    }

    group.append(list);
    byId(doc, "deltas").append(group);
  }
}

function isHot(h: Row) {
  return h.risk === "high" || h.risk === "critical";
}

function include(h: Row, filter: string) {
  switch (filter) {
    case "patterns":
      return Boolean(h.patterns?.length);
    case "risk":
      return isHot(h);
    case "structure":
      return h.findings.some(
        (f) => f.rule === "complexity" || f.rule === "nesting",
      );
    case "unscored":
      return h.score === null;
    default:
      return true;
  }
}

function describe(doc: Document, h: Row) {
  const group = details(doc, h.symbol);

  if (h.patterns?.length) {
    group.append(
      element(
        doc,
        "p",
        h.patterns.length +
          " language-rule findings. Search this function in Code patterns for the full list.",
      ),
    );

    for (const item of h.patterns.slice(0, 5))
      group.append(patternEntry(doc, item));
  }

  group.append(
    element(
      doc,
      "p",
      "Coverage: " + h.coverage.status + ". Nesting depth: " + h.depth + ".",
    ),
  );

  if (h.coverage.basis === "function-entry")
    group.append(
      element(
        doc,
        "p",
        "One-line callback: measured from its own LCOV function entry count.",
      ),
    );

  if (h.coverage.uncovered.length)
    group.append(
      element(doc, "p", "Uncovered lines: " + h.coverage.uncovered.join(", ")),
    );

  if (h.detail)
    group.append(findingDetails(doc, "How this function scored", h.detail));

  for (const f of h.findings)
    group.append(findingDetails(doc, f.rule + " · " + f.value, f.detail));

  return group;
}

function row(doc: Document, h: Row) {
  const tr = doc.createElement("tr"),
    name = doc.createElement("td"),
    risk = doc.createElement("td");

  name.append(
    describe(doc, h),
    element(doc, "small", h.file + ":" + h.start + "–" + h.end),
  );

  const coverage =
    h.coverage.percent === null
      ? h.coverage.status
      : Number(h.coverage.percent.toFixed(1)) + "%";

  const bands = {
    acceptable: "Within threshold",
    high: "High",
    critical: "Critical",
    unknown: "Unscored",
  };

  const tag = element(doc, "span", bands[h.risk ?? "unknown"]);
  tag.className = "tag " + (h.risk ?? "unknown");
  risk.append(tag);
  tr.append(
    name,
    element(doc, "td", h.complexity + " / 10"),
    element(doc, "td", coverage),
    element(doc, "td", h.score === null ? "—" : h.score.toFixed(2) + " / 30"),
    risk,
  );

  return tr;
}

function explorer(doc: Document, functions: Row[]) {
  const sorted = [...functions].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      b.complexity - a.complexity ||
      a.symbol.localeCompare(b.symbol),
  );

  const search = doc.querySelector<HTMLInputElement>("#search")!,
    filter = doc.querySelector<HTMLSelectElement>("#filter")!;

  const previous = doc.querySelector<HTMLButtonElement>("#previous")!,
    next = doc.querySelector<HTMLButtonElement>("#next")!;

  let offset = 0;

  function draw() {
    const term = search.value.toLowerCase().trim();

    const hits = sorted.filter(
      (h) =>
        include(h, filter.value) &&
        (h.symbol + " " + h.file).toLowerCase().includes(term),
    );

    const end = Math.min(offset + 10, hits.length);
    byId(doc, "rows").replaceChildren(
      ...hits.slice(offset, end).map((h) => row(doc, h)),
    );
    byId(doc, "empty").hidden = hits.length !== 0;
    byId(doc, "match").textContent = hits.length + " matching";
    byId(doc, "range").textContent = hits.length
      ? offset + 1 + "–" + end + " of " + hits.length
      : "0 results";
    previous.disabled = offset === 0;
    next.disabled = end >= hits.length;
  }

  function reset() {
    offset = 0;
    draw();
  }

  search.addEventListener("input", reset);
  filter.addEventListener("change", reset);
  previous.addEventListener("click", () => {
    offset -= 10;
    draw();
  });
  next.addEventListener("click", () => {
    offset += 10;
    draw();
  });
  draw();
}

function sessionRows(doc: Document, rows: Contribution[]) {
  const list = byId(doc, "session-functions");

  for (const r of rows) {
    const c = r.credits;

    const points = c
      ? Object.entries(c)
          .map(
            ([key, v]) =>
              key +
              " " +
              (v === null
                ? "unmeasured"
                : Number((2.5 * v).toFixed(3)) + "/2.5"),
          )
          .join(" · ")
      : "Removed function. Excluded from the session average.";

    const score = (v?: number | null) =>
      v === undefined ? "absent" : v === null ? "unrated" : v.toFixed(2);

    listEntry(
      doc,
      list,
      findingDetails(
        doc,
        r.symbol + " · " + where(r.detail),
        {
          ...r.detail,
          scoring: points,
        },
        "Function CRAP " + score(r.before) + " → " + score(r.after),
      ),
    );
  }
}

function auditContext(doc: Document, r: Report) {
  if (r.recorded) {
    doc.querySelector("h1")!.textContent = "Recorded repository report";
    byId(doc, "session-score").closest("section")!.hidden = !r.review?.summary;
  }

  const notes = byId(doc, "audit-notes");

  for (const note of r.auditNotes ?? []) notes.append(element(doc, "li", note));
  notes.hidden = !notes.childElementCount;
}

function scorePanel(doc: Document, r: Report) {
  const summary = r.review?.summary;
  const contributions = r.review?.contributions ?? [];
  byId(doc, "session-breakdown").hidden = !contributions.length;
  sessionRows(doc, contributions);
  byId(doc, "session-score").textContent =
    summary?.rating ?? "No session comparison";
  byId(doc, "score-scope").textContent = summary
    ? summary.measured +
      "/" +
      summary.total +
      " remaining affected functions scored against " +
      r.review!.ref
    : "Select a starting commit or task snapshot.";

  for (const line of summary?.examples ?? [])
    byId(doc, "score-examples").append(element(doc, "li", "CRAP " + line));
}

function repositoryScores(doc: Document, functions: Row[]) {
  const scored = functions
    .flatMap((h) => (h.score === null ? [] : [{ row: h, score: h.score }]))
    .sort((a, b) => a.score - b.score);

  const peak = scored.at(-1);
  const label = byId(doc, "raw-scores");

  if (!peak) {
    label.textContent = "No measured repository CRAP scores.";

    return;
  }

  const median =
    (scored[Math.floor(scored.length / 2)].score +
      scored[Math.floor((scored.length - 1) / 2)].score) /
    2;

  label.textContent =
    "Repository CRAP · median " +
    median.toFixed(2) +
    " · highest " +
    peak.score.toFixed(2) +
    " · " +
    peak.row.symbol +
    " (" +
    peak.row.file +
    ":" +
    peak.row.start +
    ")";
}

function gaps(doc: Document, rows: Row[]) {
  const reasons = new Map<string, number>();

  for (const h of rows) {
    if (h.score !== null) continue;
    const key = h.coverage.reason ?? h.coverage.status;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  const labels = new Map([
    ["shared-line", "callbacks without an isolated execution count"],
    ["no-lines", "functions without attributable line records"],
    ["stale", "functions awaiting a matching run"],
    ["missing", "functions missing report data"],
    ["wrong-suite", "functions measured by a different suite"],
  ]);

  byId(doc, "gaps").textContent = [...reasons]
    .map(([key, n]) => n + " " + (labels.get(key) ?? key))
    .join("; ");
}

function projectHistory(doc: Document, r: Report) {
  const data = r.evidence;

  if (!data) return;
  const panel = byId(doc, "project-history");
  panel.hidden = false;

  const add = (id: string, line: string) =>
    byId(doc, id).append(element(doc, "li", line));

  for (const line of data.checks) add("check-comparison", line);

  if (!data.checks.length)
    add("check-comparison", "No local project checks recorded.");

  for (const change of data.changes)
    add(
      "rule-history",
      [
        change.at.slice(0, 10),
        ...change.added.map((rule) => "Enabled " + rule),
        ...change.removed.map((rule) => "Disabled " + rule),
        "Maximum CRAP " + change.maxCrap,
        "minimum coverage " + change.minCoverage + "%",
        change.reason,
      ]
        .filter(Boolean)
        .join(" · "),
    );

  for (const lesson of data.lessons) {
    const group = details(doc, lesson.finding + " · " + lesson.conclusion);
    group.append(
      element(doc, "p", "Rule follow-up: " + lesson.nextRule),
      element(doc, "p", lesson.before + " → " + lesson.after),
      element(doc, "p", lesson.evidence.join(" · ")),
    );
    byId(doc, "lessons").append(group);
  }

  if (data.capture) {
    const group = details(
      doc,
      "Shared findings · " +
        data.capture.findings.length +
        " at " +
        data.capture.at +
        (data.capture.complete ? "" : " · partial scan"),
    );

    for (const item of data.capture.findings)
      group.append(
        element(
          doc,
          "p",
          item.file + " · " + item.symbol + " · " + item.reason,
        ),
      );
    panel.append(group);
  }
}

function sourceChange(
  doc: Document,
  list: HTMLElement,
  group: string,
  title: string,
  d: FindingDetail,
  context: string,
) {
  listEntry(
    doc,
    list,
    findingDetails(
      doc,
      group + " · " + title + " · " + where(d),
      d,
      (group === "resolved" ? "Baseline snapshot" : "Current snapshot") +
        " · " +
        context,
    ),
  );
}

function securityChanges(doc: Document, scan: NonNullable<Report["security"]>) {
  const comparison = scan.comparison;

  if (!comparison?.comparable) return;

  for (const group of ["introduced", "resolved"] as const) {
    for (const f of comparison[group]) {
      const rule = scan.catalog[f.rule];
      sourceChange(
        doc,
        byId(doc, "security-deltas"),
        group,
        rule.title,
        f.detail,
        rule.category + " · " + rule.cwe,
      );
    }
  }
}

function securityPanel(doc: Document, r: Pick<Report, "security">) {
  const scan = r.security;

  if (!scan) return;
  byId(doc, "security-score").textContent =
    "Source security · " + scan.headline;
  byId(doc, "security-detail").textContent =
    scan.detail + " · " + scan.rules.length + " enabled source checks";
  byId(doc, "security-change").textContent = scan.comparisonText;
  securityChanges(doc, scan);

  for (const id of scan.rules) {
    const rule = scan.catalog[id];
    byId(doc, "security-rules").append(
      element(
        doc,
        "li",
        rule.title + " · " + rule.category + " · " + rule.severity,
      ),
    );
  }

  const list = byId(doc, "security-findings");

  for (const finding of scan.findings) {
    const rule = scan.catalog[finding.rule];
    listEntry(
      doc,
      list,
      findingDetails(
        doc,
        rule.severity + " · " + rule.title + " · " + where(finding.detail),
        finding.detail,
        rule.category + " · " + rule.cwe + " · " + finding.id,
      ),
    );
  }

  for (const gap of scan.skipped)
    list.append(element(doc, "li", gap.file + ": " + gap.reason));

  if (!list.childElementCount)
    list.append(element(doc, "li", "No enabled patterns matched."));
}

function colorPanel(doc: Document, scan: NonNullable<Report["accessibility"]>) {
  const c = scan.colorblind;
  const value = c.score === null ? "Unrated" : c.score + "/100";
  const prior = scan.comparison?.colorblindScore;
  byId(doc, "colorblind-score").textContent =
    "Colorblind score · " +
    (prior == null ? "" : prior + "/100 → ") +
    value +
    " · " +
    c.passed +
    "/" +
    c.measured +
    " measured pairs pass all three simulations · " +
    c.pending +
    " need review";

  colorSamples(doc, "access-colors", scan.colors);
  const baseline = scan.comparison?.baselineColors ?? [];
  byId(doc, "baseline-pairs").hidden = !baseline.length;
  colorSamples(doc, "baseline-colors", baseline);
}

function colorSamples(
  doc: Document,
  id: string,
  colors: NonNullable<Report["accessibility"]>["colors"],
) {
  const samples = [...colors].sort(
    (a, b) =>
      Number(Boolean(b.failedProfiles.length)) -
      Number(Boolean(a.failedProfiles.length)),
  );

  for (const sample of samples) {
    listEntry(
      doc,
      byId(doc, id),
      findingDetails(
        doc,
        sample.status + " · " + sample.element + " · " + where(sample.detail),
        sample.detail,
      ),
    );
  }
}

function accessibilityPanel(doc: Document, r: Pick<Report, "accessibility">) {
  const scan = r.accessibility;

  if (!scan) return;
  colorPanel(doc, scan);
  byId(doc, "access-score").textContent = "Accessibility · " + scan.headline;
  byId(doc, "access-detail").textContent = [
    scan.reason,
    scan.detail,
    scan.scope,
  ]
    .filter(Boolean)
    .join(" · ");
  byId(doc, "access-change").textContent = scan.comparisonText;

  for (const id of scan.rules) {
    const rule = scan.catalog[id];
    byId(doc, "access-rules").append(
      element(
        doc,
        "li",
        rule.title + " · " + rule.category + " · " + rule.section508,
      ),
    );
  }

  const passes = byId(doc, "access-passes");

  for (const f of scan.passedChecks) {
    const rule = scan.catalog[f.rule];
    listEntry(
      doc,
      passes,
      findingDetails(
        doc,
        rule.title + " · " + where(f.detail),
        f.detail,
        rule.category + " · " + rule.section508,
      ),
    );
  }

  if (scan.passed > scan.passedChecks.length)
    passes.textContent = "This snapshot retained the pass count only.";
  const list = byId(doc, "access-findings");

  for (const f of [...scan.findings, ...scan.pending]) {
    const rule = scan.catalog[f.rule];
    listEntry(
      doc,
      list,
      findingDetails(
        doc,
        f.status + " · " + rule.title + " · " + where(f.detail),
        f.detail,
        rule.category + " · " + rule.section508 + " · " + f.id,
      ),
    );
  }

  for (const gap of scan.skipped)
    list.append(element(doc, "li", gap.file + ": " + gap.reason));

  if (!list.childElementCount)
    list.append(
      element(doc, "li", "No recorded findings or pending source checks."),
    );

  if (scan.comparison?.comparable)
    renderAccessibilityChanges(doc, scan.comparison, scan.catalog);
}

function renderAccessibilityChanges(
  doc: Document,
  comparison: NonNullable<NonNullable<Report["accessibility"]>["comparison"]>,
  catalog: NonNullable<Report["accessibility"]>["catalog"],
) {
  for (const group of ["introduced", "resolved"] as const)
    for (const f of comparison[group])
      sourceChange(
        doc,
        byId(doc, "access-deltas"),
        group,
        catalog[f.rule].title,
        f.detail,
        catalog[f.rule].category,
      );
}

type RecordedCheck = import("./check-report.ts").CheckReport;

function checkTargets(doc: Document, r: RecordedCheck, rows: Row[]) {
  const panel = byId(doc, "check-targets");
  panel.hidden = false;
  const targets = r.thresholds;

  if (!targets) {
    byId(doc, "target-count").textContent =
      "This check predates saved threshold values.";

    return;
  }

  const list = byId(doc, "target-findings");

  for (const h of rows) {
    const why = [];

    if (h.score !== null && h.score > targets.maxCrap)
      why.push(
        "CRAP " +
          h.score.toFixed(2) +
          " exceeded the configured maximum of " +
          targets.maxCrap +
          ".",
      );

    if (h.coverage.percent !== null && h.coverage.percent < targets.minCoverage)
      why.push(
        "Coverage " +
          h.coverage.percent.toFixed(1) +
          "% was below the configured minimum of " +
          targets.minCoverage +
          "%.",
      );

    if (why.length && h.detail)
      listEntry(
        doc,
        list,
        findingDetails(doc, h.symbol + " · " + where(h.detail), {
          ...h.detail,
          why: why.join(" "),
          impact:
            "Changes on less-tested paths may produce regressions that the designated suite misses.",
          scoring: "This function exceeded a project check threshold.",
        }),
      );
  }

  byId(doc, "target-count").textContent =
    list.childElementCount + " functions outside the recorded thresholds.";
}

function patternEntry(doc: Document, item: Pattern) {
  const location = item.file + (item.line ? ":" + item.line : "");
  const group = details(doc, item.rule + " · " + location);
  const list = doc.createElement("dl");
  field(doc, list, "Reported by", item.tool);
  field(doc, list, "Function", item.symbol ?? "No unique enclosing function");
  field(doc, list, "Finding", item.message);
  const guide = item.impact;

  if (guide) field(doc, list, "Potential impact", guide);
  field(
    doc,
    list,
    "Suggested action",
    item.action ||
      "Inspect the flagged expression against the named rule and test the affected behavior.",
  );
  field(
    doc,
    list,
    "Verify",
    "Rerun " +
      item.tool +
      " and the relevant tests. This finding does not change the CRAP score.",
  );
  group.append(list);

  if (item.excerpt) group.append(element(doc, "pre", item.excerpt));

  return group;
}

function patternPanel(
  doc: Document,
  data: PatternReport | undefined,
  rows: Row[],
) {
  if (!data) return;
  byId(doc, "pattern-summary").textContent =
    data.findings.length +
    " individual findings · " +
    data.spacing +
    " spacing findings grouped separately. No test coverage is required.";

  for (const note of data.notes)
    byId(doc, "pattern-scope").append(element(doc, "li", note));
  const owners = new Map(rows.map((row) => [row.id, row]));

  for (const item of data.findings) {
    const owner = owners.get(item.owner ?? "");

    if (owner) (owner.patterns ??= []).push(item);
  }

  if (data.findings.length) patternBrowser(doc, data.findings);
}

function patternBrowser(doc: Document, items: Pattern[]) {
  byId(doc, "pattern-browser").hidden = false;
  const search = doc.querySelector<HTMLInputElement>("#pattern-search")!;
  const prev = doc.querySelector<HTMLButtonElement>("#pattern-prev")!;
  const next = doc.querySelector<HTMLButtonElement>("#pattern-next")!;
  let offset = 0;
  let hits = items;

  function draw() {
    const end = Math.min(offset + 10, hits.length);
    byId(doc, "pattern-list").replaceChildren(
      ...hits.slice(offset, end).map((item) => patternEntry(doc, item)),
    );
    byId(doc, "pattern-range").textContent = hits.length
      ? offset + 1 + "–" + end + " of " + hits.length
      : "No matching findings";
    prev.disabled = offset === 0;
    next.disabled = end >= hits.length;
  }

  search.addEventListener("input", () => {
    const term = search.value.trim().toLowerCase();
    hits = items.filter((item) =>
      [item.tool, item.rule, item.file, item.symbol]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
    offset = 0;
    draw();
  });
  prev.addEventListener("click", () => {
    offset -= 10;
    draw();
  });
  next.addEventListener("click", () => {
    offset += 10;
    draw();
  });
  draw();
}

function recordedCheck(doc: Document, r: RecordedCheck) {
  doc.querySelector("h1")!.textContent = "Recorded project check";
  byId(doc, "repo").textContent = r.repository;
  byId(doc, "meta").textContent = r.check + " · " + r.note;
  byId(doc, "scan-status").textContent = r.outcome;

  for (const selector of [".session", ".cards", ".strip", ".footgrid"])
    doc.querySelector(selector)?.remove();
  const rows = r.code.data;
  patternPanel(doc, r.patterns, rows ?? []);

  if (rows) {
    checkTargets(doc, r, rows);
    explorer(doc, rows);
  } else {
    byId(doc, "function-panel").textContent =
      r.code.error ?? "Function evidence unavailable.";
  }

  if (r.access.data) accessibilityPanel(doc, { accessibility: r.access.data });
  else byId(doc, "access-detail").textContent = r.access.error ?? "";

  if (r.security.data) securityPanel(doc, { security: r.security.data });
  else byId(doc, "security-detail").textContent = r.security.error ?? "";
}

export type SourceReport = Pick<Report, "security" | "accessibility"> & {
  sourceSnapshot: string;
};

function standaloneSource(doc: Document, r: SourceReport) {
  const id = r.security ? "security-score" : "access-score";
  const section = byId(doc, id).closest("section")!;

  for (const panel of doc.querySelectorAll("main > :not(.intro)")) {
    if (panel !== section) panel.remove();
  }

  doc.querySelector("h1")!.textContent = r.security
    ? "Application security findings"
    : "Accessibility findings";
  byId(doc, "meta").textContent = "Snapshot " + r.sourceSnapshot;
  byId(doc, "scan-status").remove();
  securityPanel(doc, r);
  accessibilityPanel(doc, r);
}

export function renderReport(
  doc: Document,
  r: Report | RecordedCheck | SourceReport,
) {
  if ("sourceSnapshot" in r) return standaloneSource(doc, r);

  if ("check" in r) return recordedCheck(doc, r);
  byId(doc, "security-score").closest("section")!.hidden = !r.security;
  byId(doc, "access-score").closest("section")!.hidden = !r.accessibility;
  accessibilityPanel(doc, r);
  securityPanel(doc, r);
  projectHistory(doc, r);
  auditContext(doc, r);
  scorePanel(doc, r);
  repositoryScores(doc, r.functions);
  gaps(doc, r.functions);
  summary(doc, r);
  evidence(doc, r);
  patch(doc, r.review);
  patternPanel(doc, r.patterns, r.functions);
  explorer(doc, r.functions);
}
