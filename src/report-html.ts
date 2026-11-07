import { readFileSync } from "node:fs";
import type { Report } from "./report-view.ts";

function asset(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

export function reportHtml(report: Report) {
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");

  return asset("../dashboard/template.html")
    .replace("REPORT_LICENSE", () => asset("../LICENSE"))
    .replace("/* REPORT_CSS */", () => asset("../dashboard/style.css"))
    .replace("/* REPORT_JS */", () => asset("../dist/report-view.js"))
    .replace("REPORT_PAYLOAD", () => data);
}
