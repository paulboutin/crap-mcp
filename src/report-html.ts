import { type Repo, writeJson } from "./files.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  lstatSync,
  readFileSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { Report, SourceReport } from "./report-view.ts";

function asset(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

export function reportHtml(
  report: Report | SourceReport | import("./check-report.ts").CheckReport,
) {
  return reportDocument(JSON.stringify(report));
}

export function reportDocument(json: string) {
  const data = json.replaceAll("<", "\\u003c");

  return asset("../dashboard/template.html")
    .replace("REPORT_LICENSE", () => asset("../LICENSE"))
    .replace(
      '<link rel="stylesheet" href="style.css" />',
      () => "<style>" + asset("../dashboard/style.css") + "</style>",
    )
    .replace("/* REPORT_JS */", () => asset("../dist/report-view.js"))
    .replace("REPORT_PAYLOAD", () => data);
}

export function saveFindingReport(
  directory: string,
  key: string,
  report: Report | SourceReport,
) {
  const folder = join(directory, "reports");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, key + ".html");
  const temporary = path + "." + randomUUID();
  writeFileSync(temporary, reportHtml(report), { mode: 0o600 });
  renameSync(temporary, path);

  return path;
}

export function recordedReportPath(directory: string) {
  return join(directory, "dashboard-report.json");
}

export function saveRecordedReport(directory: string, report: Report) {
  writeJson(recordedReportPath(directory), { ...report, recorded: true });
}

export function recordedSource(repo: Repo) {
  const json = recordedReportPath(repo.local);

  if (lstatSync(json, { throwIfNoEntry: false })?.isFile()) return json;
  const dir = join(repo.root, ".crap-local");

  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory())
    return undefined;
  const html = join(dir, "dashboard.html");

  return lstatSync(html, { throwIfNoEntry: false })?.isFile()
    ? html
    : undefined;
}

// Older generators wrote an offline HTML file. Only consume its inert JSON payload.
export function archivedReportData(html: string) {
  const match =
    /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(
      html,
    );

  if (!match) throw Error("This file has no recorded dashboard data.");
  const report = JSON.parse(match[1]);

  if (!report.snapshot?.id || !Array.isArray(report.functions))
    throw Error("Expected a recorded repository report.");

  return JSON.stringify({ ...report, recorded: true });
}
