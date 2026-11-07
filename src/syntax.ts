import { Parser, Language, type Node } from "web-tree-sitter";
import { fileURLToPath } from "node:url";
import { digest } from "./files.ts";

await Parser.init();

async function grammar(name: string) {
  const parser = new Parser();
  parser.setLanguage(
    await Language.load(
      fileURLToPath(
        import.meta.resolve(
          "@repomix/tree-sitter-wasms/out/tree-sitter-" + name + ".wasm",
        ),
      ),
    ),
  );

  return parser;
}

const parsers = {
  typescript: await grammar("typescript"),
  tsx: await grammar("tsx"),
  swift: await grammar("swift"),
};

const functions = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
  "arrow_function",
  "init_declaration",
  "deinit_declaration",
  "lambda_literal",
]);

const containers = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "class",
  "object",
  "internal_module",
  "protocol_declaration",
]);

const controls = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "repeat_while_statement",
  "guard_statement",
  "catch_clause",
  "catch_block",
  "ternary_expression",
]);

const decisions = new Set([
  ...controls,
  "switch_case",
  "conjunction_expression",
  "disjunction_expression",
  "nil_coalescing_expression",
]);

const nesting = new Set([...controls, "switch_statement"]);

export interface Routine {
  symbol: string;
  start: number;
  end: number;
  complexity: number;
  depth: number;
  deepest: number;
  hash: string;
  omit: [number, number][];
}

function nameOf(node: Node) {
  return node.childForFieldName("name")?.text;
}

function label(node: Node) {
  const name = nameOf(node);

  if (name) return name;
  const owner = node.parent;

  if (owner) {
    const bound = nameOf(owner) ?? owner.childForFieldName("key")?.text;

    if (bound) return bound;
  }

  return node.type.replace("_declaration", "");
}

function decision(node: Node) {
  if (node.type === "do_statement")
    return Boolean(node.childForFieldName("condition"));

  if (decisions.has(node.type)) return true;

  if (node.type === "switch_entry")
    return !node.namedChildren.some(
      (child) => child?.type === "default_keyword",
    );

  return (
    node.type === "binary_expression" &&
    ["&&", "||", "??"].includes(node.childForFieldName("operator")?.text ?? "")
  );
}

function addMetrics(node: Node, r: Routine, depth: number) {
  const next = depth + Number(nesting.has(node.type));

  if (decision(node)) r.complexity++;

  if (next > r.depth) {
    r.depth = next;
    r.deepest = node.startPosition.row + 1;
  }

  return next;
}

interface Walk {
  rows: Routine[];
  counts: Map<string, number>;
}

function routine(node: Node, scope: string, state: Walk) {
  const base = scope + label(node);
  const index = (state.counts.get(base) ?? 0) + 1;
  state.counts.set(base, index);
  const symbol = index === 1 ? base : base + "#" + index;

  const r: Routine = {
    symbol,
    start: node.startPosition.row + 1,
    end: node.endPosition.row + 1,
    complexity: 1,
    depth: 0,
    deepest: node.startPosition.row + 1,
    hash: digest(node.text),
    // A line hit in the enclosing call cannot prove a one-line callback ran.
    omit:
      node.parent?.type === "arguments" &&
      node.startPosition.row === node.endPosition.row
        ? [[node.startPosition.row + 1, node.endPosition.row + 1]]
        : [],
  };

  state.rows.push(r);

  return r;
}

function visit(
  node: Node,
  scope: string,
  state: Walk,
  owner: Routine | undefined,
  depth: number,
) {
  if (functions.has(node.type)) {
    if (
      ["function_declaration", "method_definition"].includes(node.type) &&
      !node.childForFieldName("body")
    )
      return;
    const child = routine(node, scope, state);
    owner?.omit.push([child.start, child.end]);
    owner = child;
    scope = child.symbol + ".";
    depth = 0;
  } else if (containers.has(node.type) && nameOf(node)) {
    scope += nameOf(node) + ".";
  }

  if (owner) depth = addMetrics(node, owner, depth);

  for (const child of node.namedChildren) {
    if (child) visit(child, scope, state, owner, depth);
  }
}

export function parse(file: string, source: string) {
  const parser = file.endsWith(".swift")
    ? parsers.swift
    : file.endsWith(".tsx")
      ? parsers.tsx
      : parsers.typescript;

  const tree = parser.parse(source);

  if (!tree) throw Error("Parser did not produce a tree");

  try {
    if (tree.rootNode.hasError)
      throw Error("Syntax error or unsupported grammar");
    const state: Walk = { rows: [], counts: new Map() };
    visit(tree.rootNode, "", state, undefined, 0);

    return state.rows;
  } finally {
    tree.delete();
  }
}
