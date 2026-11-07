// Shipped as a standalone ES module in the offline report. Keep imports type-only.
import type { Health, Finding } from "./findings.ts";
import type { Delta } from "./review.ts";
import type { Snapshot } from "./scan.ts";

type Row = Health & { findings: Finding[] };

interface Review {
  summary?: ReturnType<typeof import("./session.ts").sessionSummary>;
  ref: string;
  commit: string;
  affected: number;
  unassessed: string[];
  deltas: Delta[];
}

export interface Report {
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

function summary(doc: Document, r: Report) {
  const s = r.snapshot,
    measured = r.functions.filter((h) => h.score !== null).length;

  const labels = {
    repo: r.repository,
    meta:
      "Scanned " +
      new Date(s.at).toLocaleString() +
      " · " +
      (s.commit?.slice(0, 8) ?? "uncommitted"),
    assessed: r.functions.length,
    filecount: s.files + " source files assessed",
    hot: r.functions.filter(isHot).length,
    unscored: r.functions.length - measured,
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

    for (const row of rows)
      list.append(
        element(
          doc,
          "li",
          row.file +
            " · " +
            row.symbol +
            " · " +
            (row.after ?? row.before)?.rule,
        ),
      );
    group.append(list);
    byId(doc, "deltas").append(group);
  }
}

function isHot(h: Row) {
  return h.risk === "high" || h.risk === "critical";
}

function include(h: Row, filter: string) {
  switch (filter) {
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

  for (const f of h.findings)
    group.append(element(doc, "p", f.reason + " " + f.action + " " + f.check));

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
      : h.coverage.percent.toFixed(0) + "%";

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

  const search = doc.querySelector("input")!,
    filter = doc.querySelector("select")!;

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

function scorePanel(doc: Document, r: Report) {
  const summary = r.review?.summary;
  byId(doc, "session-score").textContent =
    summary?.rating ?? "No session comparison";
  byId(doc, "score-scope").textContent = summary
    ? summary.measured +
      "/" +
      summary.total +
      " remaining affected functions scored against " +
      r.review!.ref
    : "Select a starting commit or task snapshot.";

  const values = r.functions
    .flatMap((h) => (h.score === null ? [] : [h.score]))
    .sort((a, b) => a - b);

  const mid = Math.floor(values.length / 2);

  const median =
    (values[mid] + values[Math.floor((values.length - 1) / 2)]) / 2;

  byId(doc, "raw-scores").textContent = values.length
    ? "Repository CRAP · median " +
      median.toFixed(2) +
      " · highest " +
      values[values.length - 1].toFixed(2) +
      " · high above 30 · lower is better"
    : "No measured repository CRAP scores.";

  for (const line of summary?.examples ?? [])
    byId(doc, "score-examples").append(element(doc, "li", "CRAP " + line));
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

export function renderReport(doc: Document, r: Report) {
  scorePanel(doc, r);
  gaps(doc, r.functions);
  summary(doc, r);
  evidence(doc, r);
  patch(doc, r.review);
  explorer(doc, r.functions);
}
