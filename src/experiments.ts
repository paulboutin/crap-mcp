import { spawnSync } from "node:child_process";
import { arch, cpus, hostname, platform } from "node:os";
import { z } from "zod";
import { createHash } from "node:crypto";

const workload = z.object({
  name: z.string().trim().min(1),
  version: z.string().min(1),
  command: z.array(z.string().min(1)).min(1),
});

export const experiments = z
  .array(
    z.discriminatedUnion("kind", [
      workload.extend({ kind: z.literal("qa") }).strict(),
      workload
        .extend({
          kind: z.literal("benchmark"),
          maxMs: z.number().positive().optional(),
        })
        .strict(),
    ]),
  )
  .max(40)
  .refine((items) => {
    const names = items.map((item) => item.name);

    return new Set(names).size === items.length;
  }, "Duplicate experiment name");

type Workload = z.infer<typeof experiments>[number];

export interface Trial {
  name: string;
  kind: Workload["kind"];
  protocol: string;
  status: "passed" | "failed";
  samples: number[];
  medianMs: number | null;
  error?: string;
}

function sample(root: string, spec: Workload) {
  const [bin, ...args] = spec.command;

  const child = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });

  if (child.error) throw child.error;

  if (child.status !== 0) {
    process.stderr.write(child.stderr || child.stdout || "");
    throw Error("Workload exited " + (child.status ?? child.signal));
  }

  if (spec.kind === "qa") return null;

  return z.number().nonnegative().parse(JSON.parse(child.stdout));
}

export function runTrial(root: string, spec: Workload): Trial {
  const protocol = createHash("sha256")
    .update(
      JSON.stringify([
        spec,
        hostname(),
        platform(),
        arch(),
        cpus()[0]?.model,
        process.version,
      ]),
    )
    .digest("hex");

  const result: Trial = {
    name: spec.name,
    kind: spec.kind,
    protocol,
    samples: [],
    medianMs: null,
    status: "passed",
  };

  try {
    if (spec.kind === "qa") sample(root, spec);
    else {
      for (let i = 0; i < 5; i++) result.samples.push(sample(root, spec)!);
      result.medianMs = [...result.samples].sort((a, b) => a - b)[2];

      if (spec.maxMs !== undefined && result.medianMs > spec.maxMs)
        throw Error("Median exceeds budget of " + spec.maxMs + " ms");
    }
  } catch (error) {
    result.status = "failed";
    result.error = String(error);
  }

  return result;
}
