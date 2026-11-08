import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { page } from "./backlog.ts";
import type { Repo } from "./files.ts";
import type { Desk } from "./service.ts";

interface SourceOperations<S> {
  scan(repo: Repo, ref?: string): S;
  load(repo: Repo, id: string): S;
  data(offset: number, limit: number, now: S, before?: S): object;
  chat(
    directory: string,
    card: boolean,
    now: S,
    before?: S,
  ): Promise<CallToolResult>;
}

const snapshot = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .optional();

export function sourceTools<S>(
  name: string,
  ops: SourceOperations<S>,
  server: McpServer,
  select: (id?: string) => Desk,
  scope: { project: z.ZodString | z.ZodOptional<z.ZodNever> },
) {
  const presentation = {
    format: z.enum(["data", "chat"]).default("data"),
    scorecard: z.boolean().default(false),
  };

  server.registerTool(
    "scan_application_" + name,
    {
      description:
        "Scan application " +
        name +
        ". Save the snapshot ID and pass it back for stable pagination.",
      inputSchema: z.object({ ...scope, ...page, snapshot, ...presentation }),
    },
    async (q) => {
      const { repo } = select(q.project);

      const now = q.snapshot ? ops.load(repo, q.snapshot) : ops.scan(repo);

      if (q.format === "chat") return ops.chat(repo.local, q.scorecard, now);
      const result = ops.data(q.offset, q.limit, now);

      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
  server.registerTool(
    "review_application_" + name,
    {
      description:
        "Compare application " +
        name +
        " with its starting snapshot or a Git ref (default HEAD). Use chat and scorecard for the PNG.",
      inputSchema: z.object({
        ...scope,
        ...page,
        snapshot,
        current: snapshot,
        base: z.string().min(1).optional(),
        ...presentation,
      }),
    },
    async (q) => {
      if (q.snapshot && q.base)
        throw Error("Choose a " + name + " snapshot or Git ref");
      const { repo } = select(q.project);

      const before = q.snapshot
        ? ops.load(repo, q.snapshot)
        : ops.scan(repo, q.base ?? "HEAD");

      const now = q.current ? ops.load(repo, q.current) : ops.scan(repo);

      if (q.format === "chat")
        return ops.chat(repo.local, q.scorecard, now, before);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(ops.data(q.offset, q.limit, now, before)),
          },
        ],
      };
    },
  );
}
