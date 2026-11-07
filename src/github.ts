import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Tracker } from "./issues.ts";

const issue = z.object({
  number: z.number().int().positive(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
});

export type Ticket = z.infer<typeof issue>;

interface Fields {
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

function api(path: string, method: string, fields: Fields) {
  if (method === "GET")
    return JSON.parse(
      execFileSync("gh", ["api", "--hostname", "github.com", path], {
        encoding: "utf8",
        timeout: 20000,
      }),
    );

  return JSON.parse(
    execFileSync(
      "gh",
      ["api", "--hostname", "github.com", "-X", method, path, "--input", "-"],
      { encoding: "utf8", input: JSON.stringify(fields), timeout: 20000 },
    ),
  );
}

function recover(project: string, tag: string) {
  const raw = execFileSync(
    "gh",
    [
      "api",
      "--hostname",
      "github.com",
      "--paginate",
      "--slurp",
      "repos/" + project + "/issues?state=all&per_page=100",
    ],
    { encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
  );

  return issue
    .array()
    .array()
    .parse(JSON.parse(raw))
    .flat()
    .find((t) => t.body?.startsWith(tag + "\n"));
}

function verify(ticket: Ticket, tag: string) {
  if (!ticket.body?.startsWith(tag + "\n"))
    throw Error("Remote issue no longer carries the finding marker");

  return ticket;
}

export function githubTracker(request = api, find = recover): Tracker {
  return {
    upsert(project, tag, title, body, number) {
      const path = "repos/" + project + "/issues";

      const known = number
        ? verify(issue.parse(request(path + "/" + number, "GET", {})), tag)
        : find(project, tag);

      if (!known)
        return issue.parse(request(path, "POST", { title, body })).number;

      if (known.state === "closed" || known.body !== body)
        request(path + "/" + known.number, "PATCH", { body, state: "open" });

      return known.number;
    },
    close(project, number, tag) {
      const path = "repos/" + project + "/issues/" + number;
      const ticket = verify(issue.parse(request(path, "GET", {})), tag);

      if (ticket.state !== "closed")
        request(path, "PATCH", { state: "closed" });
    },
  };
}

export const github = githubTracker();
