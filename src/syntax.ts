import { Parser, Language, type Node } from "web-tree-sitter";
import {
  acquireGrammar,
  adapter,
  languageCatalog,
  languageFor,
  type Adapter,
} from "./languages.ts";
import { digest } from "./files.ts";

await Parser.init();

const parsers = new Map<string, Parser>();

const loading = new Map<string, Promise<void>>();

async function loadParser(pack: Adapter) {
  const grammar = await Language.load(await acquireGrammar(pack));
  const parser = new Parser();
  parser.setLanguage(grammar);
  parsers.set(pack.version, parser);
}

export async function prepareLanguage(id: string) {
  const pack = adapter(id);

  if (parsers.has(pack.version)) return;
  let pending = loading.get(pack.version);

  if (!pending) {
    pending = loadParser(pack).finally(() => loading.delete(pack.version));
    loading.set(pack.version, pending);
  }

  await pending;
}

for (const pack of languageCatalog()) {
  if (pack.core) await prepareLanguage(pack.id);
}

export interface Routine {
  symbol: string;
  start: number;
  end: number;
  complexity: number;
  depth: number;
  deepest: number;
  hash: string;
  callbackCounter?: boolean;
  omit: [number, number][];
}

function nameOf(node: Node) {
  return node.childForFieldName("name")?.text;
}

function containerName(node: Node) {
  const name = nameOf(node) ?? node.childForFieldName("type")?.text;

  return name ? name + "." : "";
}

function label(node: Node) {
  const name = nameOf(node);

  if (name && node.type === "method_declaration") {
    const receiver = node
      .childForFieldName("receiver")
      ?.namedChild(0)
      ?.childForFieldName("type")?.text;

    if (receiver) return receiver + "." + name;
  }

  if (name) return name;
  const owner = node.parent;

  if (owner) {
    const bound = nameOf(owner) ?? owner.childForFieldName("key")?.text;

    if (bound) return bound;
  }

  return node.type.replace("_declaration", "");
}

function decision(node: Node, language: Adapter) {
  if (node.type === "do_statement")
    return Boolean(node.childForFieldName("condition"));

  if (node.type === "match_arm")
    return node.childForFieldName("pattern")?.text !== "_";

  if (
    language.decisions.includes(node.type) ||
    language.controls.includes(node.type)
  )
    return true;

  if (node.type === "switch_entry")
    return !node.namedChildren.some(
      (child) => child?.type === "default_keyword",
    );

  return (
    node.type === "binary_expression" &&
    ["&&", "||", "??"].includes(node.childForFieldName("operator")?.text ?? "")
  );
}

function addMetrics(node: Node, r: Routine, depth: number, language: Adapter) {
  const next =
    depth +
    Number(
      language.nesting.includes(node.type) ||
        language.controls.includes(node.type),
    );

  if (decision(node, language)) r.complexity++;

  if (next > r.depth) {
    r.depth = next;
    r.deepest = node.startPosition.row + 1;
  }

  return next;
}

interface Walk {
  language: Adapter;
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
      ["arguments", "argument_list"].includes(node.parent?.type ?? "") &&
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
  if (state.language.functions.includes(node.type)) {
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
  } else if (state.language.containers.includes(node.type)) {
    scope += containerName(node);
  }

  if (owner) depth = addMetrics(node, owner, depth, state.language);

  for (const child of node.namedChildren) {
    if (child) visit(child, scope, state, owner, depth);
  }
}

function uniqueCallbacks(rows: Routine[]) {
  const starts = new Map<number, number>();

  for (const r of rows) starts.set(r.start, (starts.get(r.start) ?? 0) + 1);

  for (const r of rows)
    r.callbackCounter =
      r.start === r.end && r.omit.length === 1 && starts.get(r.start) === 1;

  return rows;
}

export function parse(file: string, source: string) {
  const language = languageFor(file);

  if (!language) throw Error("Unsupported source extension: " + file);

  return withSyntax(language.id, source, (root) => {
    const state: Walk = { rows: [], counts: new Map(), language };
    visit(root, "", state, undefined, 0);

    return uniqueCallbacks(state.rows);
  });
}

export function withSyntax<T>(
  id: string,
  source: string,
  inspect: (root: Node) => T,
) {
  const tree = parsers.get(adapter(id).version)!.parse(source);

  if (!tree) throw Error("Parser did not produce a tree");

  try {
    if (tree.rootNode.hasError)
      throw Error("Syntax error or unsupported grammar");

    return inspect(tree.rootNode);
  } finally {
    tree.delete();
  }
}
