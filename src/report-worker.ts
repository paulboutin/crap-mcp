import { parentPort, workerData } from "node:worker_threads";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { digest, maybeRevision, workFiles, type Repo } from "./files.ts";
import { projectReport } from "./projects.ts";
import { Desk } from "./service.ts";
import { reportHtml } from "./report-html.ts";
import { recentRuns } from "./check-history.ts";
import { qualityPolicy } from "./quality-policy.ts";
import { codeReport } from "./code-report.ts";
import { prepareLanguage } from "./syntax.ts";
import { last } from "./scan.ts";

export interface ReportRequest {
  repo: Repo;
  preview: boolean;
  snapshots: [string | undefined, string | undefined, string | undefined];
  previous?: string;
}

function stamp(path: string) {
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });

  return stat
    ? [String(stat.ino), String(stat.ctimeNs), String(stat.size)]
    : null;
}

// Include non-code sources (HTML, linked CSS, etc.) and evidence outside the checkout.
function reportInputs(repo: Repo) {
  const head = maybeRevision(repo.root, "HEAD");

  const files = workFiles(repo).map((file) => [
    file,
    stamp(join(repo.root, file)),
  ]);

  return digest(
    JSON.stringify([
      head,
      files,
      repo.config,
      qualityPolicy(repo).revision,
      recentRuns(repo),
      stamp(join(repo.local, "coverage.json")),
      head && stamp(join(repo.store, head + ".json")),
    ]),
  );
}

async function build(request: ReportRequest) {
  const { repo, preview, snapshots, previous } = request;

  if (preview) {
    const scan = last(repo);

    return { html: scan && reportHtml(codeReport(repo.root, scan)) };
  }

  // Pinned comparisons always resolve their requested snapshots.
  const inputs = snapshots.some((id) => id !== undefined)
    ? undefined
    : reportInputs(repo);

  if (inputs && inputs === previous) return { inputs };
  await Promise.all(repo.packs.map(prepareLanguage));
  const report = await projectReport(new Desk(repo, false), ...snapshots);
  const stable = inputs && inputs === reportInputs(repo);

  return { html: reportHtml(report), inputs: stable ? inputs : undefined };
}

parentPort?.postMessage(await build(workerData));
