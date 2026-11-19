import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CheckRun } from "./check-history.ts";
import type { SourceCheckRequest } from "./source-check-process.ts";

type SourceResult = Pick<CheckRun, "security" | "accessibility">;

// A separate process contains native/WASM faults as well as non-cooperative parsing.
export function boundedSourceCheck(
  request: SourceCheckRequest,
  budgetMs = 120000,
  entry = new URL(
    import.meta.url.endsWith(".ts")
      ? "./source-check-process.ts"
      : "./source-check-process.js",
    import.meta.url,
  ),
) {
  const worker = fork(fileURLToPath(entry), [], {
    execPath: process.execPath,
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  worker.send(request);

  return new Promise<SourceResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.kill("SIGKILL");
      reject(
        Error(
          `${request.kind} scan exceeded ${budgetMs} ms; source check unassessed`,
        ),
      );
    }, budgetMs);

    worker.once("message", (result: SourceResult) => {
      clearTimeout(timer);
      worker.disconnect();
      resolve(result);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`${request.kind} process exited (${code}) before a result`));
    });
  });
}
