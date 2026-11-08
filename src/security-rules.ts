import type { Node } from "web-tree-sitter";
import { z } from "zod";
import { sourceExcerpt } from "./finding-detail.ts";
import { digest } from "./files.ts";
import { withSyntax } from "./syntax.ts";

export const securityIds = [
  "dynamic-eval",
  "interpolated-sql",
  "tls-verification",
  "weak-digest",
  "trust-exceptions",
] as const;

export const ruleId = z.enum(securityIds);

type RuleId = z.infer<typeof ruleId>;

export const securityCatalog = {
  "dynamic-eval": {
    category: "A05:2025 Injection",
    cwe: "CWE-95",
    severity: "high",
    scope: "web",
    title: "Direct eval call",
    why: "The call passes a string to eval or globalThis.eval for execution.",
    impact:
      "If untrusted input reaches this argument, it can run with the privileges available to this code.",
    check:
      "Trace an externally supplied value through the caller and test that a string containing code stays inert.",
    action:
      "Trace the argument. Replace executable strings with data or an allowlisted operation.",
  },
  "interpolated-sql": {
    category: "A05:2025 Injection",
    cwe: "CWE-89",
    severity: "high",
    scope: "web",
    title: "Interpolated SQL in a query call",
    why: "A query or execute call receives SQL with a template substitution.",
    impact:
      "If a caller controls the substitution, data can change the structure of the query and expose or modify other records.",
    check:
      "Test a value containing quotes and SQL syntax. Confirm the driver receives SQL and bound values separately.",
    action:
      "Trace the substituted value. Use a bound query parameter for data; allowlist dynamic identifiers.",
  },
  "tls-verification": {
    category: "A07:2025 Authentication Failures",
    cwe: "CWE-295",
    severity: "high",
    scope: "web",
    title: "TLS certificate verification disabled",
    why: "The source sets rejectUnauthorized to false.",
    impact:
      "If a live connection uses this option, an impersonating server can intercept credentials or alter responses.",
    check:
      "Verify that the client rejects an untrusted certificate and accepts the expected certificate.",
    action:
      "Check that this option reaches a TLS client. Configure trusted certificates and verify the peer.",
  },
  "weak-digest": {
    category: "A04:2025 Cryptographic Failures",
    cwe: "CWE-327",
    severity: "medium",
    scope: "both",
    title: "MD5 or SHA-1 digest",
    why: "The call selects MD5 or SHA-1.",
    impact:
      "When a security decision relies on collision resistance, different inputs can share a digest and defeat the integrity check.",
    check:
      "Identify what the digest protects and exercise the replacement with matching and tampered inputs.",
    action:
      "Check whether this digest protects integrity or credentials. Use an appropriate modern cryptographic primitive for that purpose.",
  },
  "trust-exceptions": {
    category: "A07:2025 Authentication Failures",
    cwe: "CWE-295",
    severity: "high",
    scope: "swift",
    title: "Certificate trust exceptions requested",
    why: "The code calls SecTrustSetExceptions.",
    impact:
      "A trust exception can allow an unexpected peer to pass verification and intercept traffic.",
    check:
      "Exercise the trust delegate with an unexpected certificate and verify that the connection fails.",
    action:
      "Review the trust policy and replace exceptions with normal peer validation where possible.",
  },
} as const;

export const securityFinding = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  end: z.number().optional(),
  excerpt: z.string().optional(),
  rule: ruleId,
});

function interpolatedSql(callee: string, argument?: Node | null) {
  if (
    !/\.(?:query|execute)$/.test(callee) ||
    argument?.type !== "template_string"
  )
    return false;

  return (
    /^\x60\s*(?:select|insert|update|delete|with)\b/i.test(argument.text) &&
    argument.namedChildren.some(
      (child) => child?.type === "template_substitution",
    )
  );
}

function webCall(node: Node): RuleId | undefined {
  const callee = node.childForFieldName("function")?.text;

  if (callee === "eval" || callee === "globalThis.eval") return "dynamic-eval";

  const argument = node
    .childForFieldName("arguments")
    ?.namedChildren.find((n) => n?.type !== "comment");

  if (interpolatedSql(callee ?? "", argument)) return "interpolated-sql";

  if (
    ["createHash", "crypto.createHash"].includes(callee ?? "") &&
    /^(['"])(?:md5|sha1)\1$/i.test(argument?.text ?? "")
  )
    return "weak-digest";
}

function webRule(node: Node): RuleId | undefined {
  if (node.type === "call_expression") return webCall(node);
  const key = node.childForFieldName("key")?.text;

  if (
    [
      "rejectUnauthorized",
      "'rejectUnauthorized'",
      '"rejectUnauthorized"',
    ].includes(key ?? "") &&
    node.childForFieldName("value")?.type === "false"
  )
    return "tls-verification";
}

function swiftRule(node: Node): RuleId | undefined {
  const callee = node.namedChild(0)?.text;

  if (callee === "SecTrustSetExceptions") return "trust-exceptions";

  if (
    ["CC_SHA1", "CC_MD5", "Insecure.MD5.hash", "Insecure.SHA1.hash"].includes(
      callee ?? "",
    )
  )
    return "weak-digest";
}

export function inspectSecurity(
  file: string,
  parser: string,
  source: string,
  enabled: readonly RuleId[],
) {
  const swift = parser === "swift";
  const match = swift ? swiftRule : webRule;
  const types = swift ? ["call_expression"] : ["call_expression", "pair"];

  const lines = source.split(/\r?\n/);

  return withSyntax(parser, source, (root) => {
    const counts = new Map<string, number>();

    return root.descendantsOfType(types).flatMap((node) => {
      const rule = match(node);

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
          excerpt: sourceExcerpt(
            lines,
            node.startPosition.row + 1,
            node.endPosition.row + 1,
          ),
          rule,
        },
      ];
    });
  });
}

export function securityExplanation(f: z.infer<typeof securityFinding>) {
  const rule = securityCatalog[f.rule];

  return {
    ...f,
    detail: {
      file: f.file,
      line: f.line,
      end: f.end,
      excerpt: f.excerpt,
      why: rule.why,
      impact: rule.impact,
      action: rule.action,
      check: rule.check,
      scoring:
        (rule.severity === "high" ? 25 : 10) +
        " penalty points before the score floor of zero. A source match requires a review of reachability and inputs.",
    },
  };
}
