import type { Node } from "web-tree-sitter";
import { join } from "node:path";
import { digest, inScope, writeJson, type Repo } from "./files.ts";
import { visitSources } from "./source-visit.ts";
import { withSyntax } from "./syntax.ts";
import { qualityPolicy } from "./quality-policy.ts";

export const operationalRecipes = {
  "per-call-client": {
    title: "Database client constructed inside a function",
    confidence: "medium",
    scope:
      "TypeScript/JavaScript named Client import from pg; excludes aliases and reachability analysis",
    why: "Repeated calls may create repeated database connections; construction alone does not prove a connection is opened.",
    verify:
      "Trace the caller, connect/end lifecycle and pooling. Under a separately authorized workload, measure open connections, acquisition time and aggregate replica budgets.",
  },
  "promise-fanout": {
    title: "Promise.all receives an array map",
    confidence: "medium",
    scope:
      "TypeScript/JavaScript direct Promise.all(items.map(...)); no inference about input size or external I/O",
    why: "All mapped operations are scheduled together. The input may already be bounded; this is a review prompt, not proof of unbounded runtime fan-out.",
    verify:
      "Establish the maximum input size and callback effects. Verify concurrency, queue bytes/age and cancellation under a separately authorized worst-case input.",
  },
} as const;

function inFunction(node: Node) {
  let parent = node.parent;

  while (parent) {
    if (
      [
        "function_declaration",
        "function_expression",
        "arrow_function",
        "method_definition",
      ].includes(parent.type)
    )
      return true;
    parent = parent.parent;
  }

  return false;
}

function ruleFor(node: Node, pgClient: boolean) {
  if (
    pgClient &&
    node.type === "new_expression" &&
    node.childForFieldName("constructor")?.text === "Client" &&
    inFunction(node)
  )
    return "per-call-client";

  return mappedFanout(node) ? "promise-fanout" : null;
}

function mappedFanout(node: Node) {
  if (
    node.type !== "call_expression" ||
    node.childForFieldName("function")?.text !== "Promise.all"
  )
    return false;
  const arg = node.childForFieldName("arguments")?.namedChild(0);

  if (
    arg?.type === "call_expression" &&
    arg.childForFieldName("function")?.type === "member_expression" &&
    arg.childForFieldName("function")?.childForFieldName("property")?.text ===
      "map"
  )
    return true;

  return false;
}

export function inspectOperational(
  file: string,
  source: string,
  enabled: readonly string[],
) {
  return withSyntax(
    /[jt]sx$/.test(file) ? "tsx" : "typescript",
    source,
    (root) => {
      const pgClient = root
        .descendantsOfType("import_statement")
        .some(
          (node) =>
            /^['"]pg['"]$/.test(node.childForFieldName("source")?.text ?? "") &&
            node
              .descendantsOfType("import_specifier")
              .some((n) => n.text === "Client"),
        );

      const counts = new Map<string, number>();

      return root
        .descendantsOfType(["new_expression", "call_expression"])
        .flatMap((node) => {
          const rule = ruleFor(node, pgClient);

          if (!rule || !enabled.includes(rule)) return [];
          const key = digest(JSON.stringify([file, rule, node.text]));
          const occurrence = (counts.get(key) ?? 0) + 1;
          counts.set(key, occurrence);

          return [
            {
              id: key + ":" + occurrence,
              file,
              line: node.startPosition.row + 1,
              end: node.endPosition.row + 1,
              rule,
              ...operationalRecipes[rule],
            },
          ];
        });
    },
  );
}

export function scanOperationalRisks(repo: Repo) {
  const rules = qualityPolicy(repo).settings.operational?.sourceRules ?? [];
  const findings: ReturnType<typeof inspectOperational> = [];
  const skipped: { file: string; reason: string }[] = [];
  const hashes: string[] = [];
  let assessed = 0;
  visitSources(
    repo,
    null,
    (r, file) => inScope(r, file),
    (file, read) => {
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)) {
        skipped.push({
          file,
          reason: "No operational source rules for this file type",
        });

        return;
      }

      try {
        if (!rules.length) throw Error("No operational source rules enabled");
        const source = read();
        hashes.push(file, digest(source));
        findings.push(...inspectOperational(file, source, rules));
        assessed++;
      } catch (error) {
        skipped.push({ file, reason: String(error) });
      }
    },
  );

  const body = {
    version: 1,
    rules,
    findings,
    skipped,
    assessed,
    exclusions: [...repo.config.exclude, ...repo.omitDirectories],
  };

  const id = digest(JSON.stringify([body, hashes]));

  const report = {
    id,
    ...body,
    note: "Advisory source patterns only; runtime capacity, latency and reliability remain unmeasured.",
  };

  writeJson(join(repo.local, "operational-risks", id + ".json"), report);

  return report;
}
