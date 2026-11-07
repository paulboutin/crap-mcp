import { qualityPolicy, applyPolicy, edit } from "./quality-policy.ts";
import { recentRuns } from "./check-history.ts";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Projects, projectReport, sharedServer } from "./projects.ts";
import { reportHtml } from "./report-html.ts";

export function machineApp(projects: Projects) {
  const app = createMcpExpressApp();
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    );

    if (
      req.headers.origin &&
      req.headers.origin !== "http://" + req.headers.host
    ) {
      res.sendStatus(403);

      return;
    }

    next();
  });
  app.get("/health", (_req, res) => res.type("text").send("crap-score-mcp"));
  app.get("/", (_req, res) =>
    res
      .type("html")
      .send(
        readFileSync(
          new URL("../dashboard/projects.html", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/projects", (_req, res) => res.json(projects.list()));
  app.get("/settings", (_req, res) =>
    res.sendFile("settings.html", {
      root: fileURLToPath(new URL("../dashboard/", import.meta.url)),
    }),
  );
  app.get("/projects/:project/settings", (req, res) => {
    const repo = projects.repo(req.params.project);
    res.json({
      ...qualityPolicy(repo),
      suite: repo.config.suite,
      report: repo.config.report ?? "coverage/lcov.info",
      runs: recentRuns(repo),
    });
  });
  app.put("/projects/:project/settings", async (req, res) => {
    const parsed = edit.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid project settings." });

      return;
    }

    try {
      const repo = projects.repo(req.params.project);
      res.json(await applyPolicy(repo, parsed.data));
    } catch (error) {
      res.status(409).json({ error: String(error) });
    }
  });
  app.get("/report/:project", async (req, res) => {
    try {
      const baseline = req.query.snapshot;
      const id = baseline === undefined ? undefined : String(baseline);
      res
        .type("html")
        .send(
          reportHtml(
            await projectReport(projects.desk(req.params.project), id),
          ),
        );
    } catch (error) {
      res.status(400).type("text").send(String(error));
    }
  });
  app.post("/mcp", async (req, res) => {
    const server = sharedServer(projects);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all("/mcp", (_req, res) => res.sendStatus(405));

  return app;
}
