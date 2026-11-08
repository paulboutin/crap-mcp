import { qualityPolicy, applyPolicy, edit } from "./quality-policy.ts";
import { shareProject } from "./project-learning.ts";
import { z } from "zod";
import { recentRuns } from "./check-history.ts";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Projects, sharedServer } from "./projects.ts";
import { checkReport } from "./check-report.ts";
import {
  archivedReportData,
  recordedSource,
  reportDocument,
  reportHtml,
} from "./report-html.ts";
import { machineReports } from "./machine-reports.ts";

export function machineApp(projects: Projects) {
  const app = createMcpExpressApp();
  const report = machineReports();
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
  app.post("/projects/:project/manifest", async (req, res) => {
    const input = z
      .object({ revision: z.string() })
      .strict()
      .safeParse(req.body);

    if (!input.success) {
      res.status(400).json({ error: "Expected a settings revision." });

      return;
    }

    try {
      const revision = await shareProject(
        projects.desk(req.params.project),
        input.data.revision,
      );

      res.json({ file: ".crap-team.json", revision });
    } catch (error) {
      res.status(409).json({ error: String(error) });
    }
  });
  app.get("/checks/:project/:at", (req, res) => {
    try {
      res
        .type("html")
        .send(
          reportHtml(
            checkReport(projects.repo(req.params.project), req.params.at),
          ),
        );
    } catch (error) {
      res.status(404).type("text").send(String(error));
    }
  });
  app.get("/report/:project/recorded", async (req, res) => {
    try {
      const file = recordedSource(projects.repo(req.params.project));

      if (!file) {
        res.sendStatus(204);

        return;
      }

      if (req.method === "HEAD") {
        res.type("html").end();

        return;
      }

      const data = await readFile(file, {
        encoding: "utf8",
        flag: constants.O_RDONLY | constants.O_NOFOLLOW,
      });

      res
        .type("html")
        .send(
          reportDocument(
            file.endsWith(".html") ? archivedReportData(data) : data,
          ),
        );
    } catch (error) {
      res.status(400).type("text").send(String(error));
    }
  });
  app.get("/report/:project", async (req, res) => {
    try {
      const param = (name: string) =>
        req.query[name] === undefined ? undefined : String(req.query[name]);

      const html = await report({
        repo: projects.repo(req.params.project),
        preview: req.query.preview === "saved",
        snapshots: [
          param("snapshot"),
          param("securitySnapshot"),
          param("accessibilitySnapshot"),
        ],
      });

      if (html) res.type("html").send(html);
      else res.sendStatus(204);
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
