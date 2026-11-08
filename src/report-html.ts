import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import type { Report, SourceReport } from "./report-view.ts";

function asset(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

export function reportHtml(
  report: Report | SourceReport | import("./check-report.ts").CheckReport,
) {
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");

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
