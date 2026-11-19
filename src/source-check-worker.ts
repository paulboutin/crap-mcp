import { parentPort, workerData } from "node:worker_threads";
import { repository } from "./files.ts";
import { accessibilityCheck } from "./accessibility.ts";
import { securityCheck } from "./security.ts";

export interface SourceCheckRequest {
  root: string;
  kind: "accessibility" | "security";
  minimum?: number | null;
  colorMinimum?: number | null;
}

if (parentPort) {
  const request: SourceCheckRequest = workerData;
  const repo = repository(request.root);

  const result =
    request.kind === "security"
      ? { security: securityCheck(repo, request.minimum) }
      : {
          accessibility: accessibilityCheck(
            repo,
            request.minimum,
            request.colorMinimum,
          ),
        };

  parentPort.postMessage(result);
}
