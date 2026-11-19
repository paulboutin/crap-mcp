import { Worker } from "node:worker_threads";
import type { CheckRun } from "./check-history.ts";
import type { SourceCheckRequest } from "./source-check-worker.ts";

type SourceResult = Pick<CheckRun, "security" | "accessibility">;

// Worker termination remains available when a grammar cannot call its progress callback.
export function boundedSourceCheck(
  request: SourceCheckRequest,
  budgetMs = 120000,
  entry = new URL(
    import.meta.url.endsWith(".ts")
      ? "./source-check-worker.ts"
      : "./source-check-worker.js",
    import.meta.url,
  ),
) {
  const worker = new Worker(entry, { workerData: request });

  return new Promise<SourceResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        Error(
          `${request.kind} scan exceeded ${budgetMs} ms; source check unassessed`,
        ),
      );
    }, budgetMs);

    worker.once("message", (result: SourceResult) => {
      clearTimeout(timer);
      resolve(result);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`${request.kind} worker exited (${code}) before a result`));
    });
  });
}
