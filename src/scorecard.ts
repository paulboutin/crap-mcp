import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CheckRun } from "./check-history.ts";
import type { sessionSummary } from "./session.ts";

type Summary = ReturnType<typeof sessionSummary>;

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function grade(summary: Summary) {
  if (summary.rating.startsWith("Not applicable"))
    return ["N/A", "No surviving changed functions"];

  if (summary.rating.startsWith("Unrated"))
    return ["Unrated", summary.rating.split(" · ")[1]];
  const [value, qualifier] = summary.rating.split(" (");

  return [value, qualifier ? "Provisional session health" : "Session health"];
}

export function trialStatus(
  run: CheckRun | undefined,
  kind: "qa" | "benchmark",
) {
  const items = run?.trials?.filter((t) => t.kind === kind) ?? [];

  if (!items.length) return "Unmeasured";

  return (
    items.filter((t) => t.status === "passed").length +
    "/" +
    items.length +
    " passed"
  );
}

function metric(x: number, label: string, value: string) {
  return `<text x="${x}" y="182" fill="#47605c" font-size="15">${label}</text>
    <text x="${x}" y="213" fill="#153731" font-size="22" font-weight="bold">${escape(value)}</text>`;
}

export async function scorecard(
  directory: string,
  baseline: string,
  current: string,
  summary: Summary,
  run?: CheckRun,
) {
  const [value, label] = grade(summary);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="250" viewBox="0 0 680 250">
    <rect width="680" height="250" rx="16" fill="#f4f7f3"/>
    <path d="M16 0h648q16 0 16 16v124H0V16Q0 0 16 0" fill="#143c37"/>
    <g font-family="sans-serif">
    <text x="28" y="37" fill="#b7ded0" font-size="18">Code session review</text>
    <text x="28" y="104" fill="#fff" font-weight="bold" font-size="49">${escape(value)}</text>
    <text x="652" y="102" fill="#d2eae0" text-anchor="end" font-size="17">${escape(label)}</text>
    ${metric(28, "Changed functions scored", summary.measured + "/" + summary.total)}
    ${metric(276, "QA replays", trialStatus(run, "qa"))}
    ${metric(478, "Benchmarks", trialStatus(run, "benchmark"))}
    </g></svg>`;

  return saveCard(directory, baseline + "-" + current, svg);
}

export async function saveCard(directory: string, key: string, svg: string) {
  const { Resvg } = await import("@resvg/resvg-js");

  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1020 } })
    .render()
    .asPng();

  const folder = join(directory, "scorecards");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, key + ".png");
  const temporary = path + "." + randomUUID();
  writeFileSync(temporary, png, { mode: 0o600 });
  renameSync(temporary, path);

  return {
    path,
    image: {
      type: "image" as const,
      mimeType: "image/png",
      data: png.toString("base64"),
    },
  };
}
