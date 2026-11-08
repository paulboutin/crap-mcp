import { Worker } from "node:worker_threads";
import type { ReportRequest } from "./report-worker.ts";

interface Result {
  html?: string;
  inputs?: string;
}

function generate(request: ReportRequest) {
  const entry = import.meta.url.endsWith(".ts")
    ? "./report-worker.ts"
    : "./report-worker.js";

  const worker = new Worker(new URL(entry, import.meta.url), {
    workerData: request,
  });

  return new Promise<Result>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) =>
      reject(Error("Report worker exited (" + code + ")")),
    );
  });
}

export function machineReports() {
  const pending = new Map<string, Promise<string | undefined>>();
  let cached: { root: string; inputs: string; html: string } | undefined;

  async function render(request: ReportRequest) {
    const root = request.repo.root;
    const prior = cached?.root === root ? cached : undefined;
    const result = await generate({ ...request, previous: prior?.inputs });

    if (!result.html) return result.inputs ? prior?.html : undefined;

    if (result.inputs)
      cached = { root, inputs: result.inputs, html: result.html };

    return result.html;
  }

  return (request: ReportRequest) => {
    const key = JSON.stringify([
      request.repo,
      request.preview,
      request.snapshots,
    ]);

    const active = pending.get(key);

    if (active) return active;
    const job = render(request).finally(() => pending.delete(key));
    pending.set(key, job);

    return job;
  };
}
