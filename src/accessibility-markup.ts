import { jsxPaint } from "./accessibility-jsx-paint.ts";
import type { Paint } from "./color-contrast.ts";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { Node } from "web-tree-sitter";
import { withSyntax } from "./syntax.ts";
import {
  assessElement,
  type Markup,
  type Evaluate,
} from "./accessibility-rules.ts";

function hidden(attrs: Map<string, string | null>) {
  return (
    attrs.get("hidden") != null ||
    attrs.get("inert") != null ||
    attrs.get("aria-hidden") === "true"
  );
}

function literalText(el: Html.Element) {
  const parts: string[] = [];

  for (const child of el.childNodes) {
    if ("value" in child) parts.push(child.value);
    else if ("tagName" in child) return null;
  }

  return parts.join("").trim();
}

function html(source: string, record: Evaluate) {
  const tree = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      if (error.code.startsWith("eof-in-"))
        throw Error("Incomplete HTML at line " + error.startLine);
    },
  });

  const visit = (el: Html.Element) => {
    const attrs = new Map(el.attrs.map((a) => [a.name, a.value]));

    if (hidden(attrs)) return;
    const loc = el.sourceCodeLocation?.startTag;

    if (loc)
      assessElement(
        {
          tag: el.tagName,
          attrs,
          line: loc.startLine,
          end: loc.endLine,
          source: source.slice(loc.startOffset, loc.endOffset),
          text: literalText(el),
          spread: false,
        },
        record,
      );

    for (const child of el.childNodes) if ("tagName" in child) visit(child);
  };

  for (const el of tree.childNodes) if ("tagName" in el) visit(el);

  // HTML allows the root start tag to be omitted. A complete document still needs a language.
  const root = tree.childNodes.find(
    (el) => "tagName" in el && el.tagName === "html",
  );

  if (
    root &&
    !root.sourceCodeLocation &&
    tree.childNodes.some((el) => el.nodeName === "#documentType")
  )
    assessElement(
      {
        tag: "html",
        attrs: new Map(),
        line: 1,
        source: "<html>",
        text: "",
        spread: false,
      },
      record,
    );
}

function jsxValue(node: Node | null) {
  if (!node) return "";

  if (node.type === "string") return node.text.slice(1, -1);

  return null;
}

function attributes(node: Node) {
  const attrs = new Map<string, string | null>();
  let spread = false;

  for (const attr of node.namedChildren) {
    if (attr?.type === "jsx_expression") spread = true;

    if (attr?.type !== "jsx_attribute") continue;
    const key = attr.namedChild(0)!.text;
    const val = attr.namedChild(1);

    if (["hidden", "inert"].includes(key) && val?.text === "{false}") continue;
    attrs.set(key, val?.text === "{true}" ? "true" : jsxValue(val));
  }

  return { attrs, spread };
}

function jsxText(tag: Node) {
  if (tag.type === "jsx_self_closing_element") return "";

  const content = tag.parent!.namedChildren.filter(
    (child) =>
      child &&
      !["jsx_opening_element", "jsx_closing_element"].includes(child.type),
  );

  if (content.some((child) => child?.type !== "jsx_text")) return null;

  return content
    .map((child) => child!.text)
    .join("")
    .trim();
}

function uncertainPaint(a: ReturnType<typeof attributes>) {
  return (
    a.spread ||
    ["hidden", "inert", "aria-hidden"].some((key) => a.attrs.get(key) === null)
  );
}

function assessJsx(
  node: Node,
  uncertain: boolean,
  record: Evaluate,
  paint?: Paint,
) {
  const tag =
    node.type === "jsx_element" ? node.childForFieldName("open_tag") : node;

  if (
    tag &&
    ["jsx_opening_element", "jsx_self_closing_element"].includes(tag.type)
  ) {
    const a = attributes(tag);

    if (hidden(a.attrs)) return null;
    uncertain ||= uncertainPaint(a);

    const el: Markup = {
      tag: tag.childForFieldName("name")?.text ?? "",
      ...a,
      spread: uncertain,
      text: jsxText(tag),
      source: tag.text,
      line: tag.startPosition.row + 1,
      end: tag.endPosition.row + 1,
    };

    assessElement(el, record);

    if (paint) jsxPaint(tag, el, paint);
  }

  return uncertain;
}

function jsx(source: string, record: Evaluate, paint?: Paint) {
  withSyntax("tsx", source, (root) => {
    function visit(node: Node, uncertain: boolean) {
      const next = assessJsx(node, uncertain, record, paint);

      if (next === null) return;

      for (const child of node.namedChildren)
        if (child && child.type !== "jsx_opening_element") visit(child, next);
    }

    visit(root, false);
  });
}

function swiftValue(arg: Node | null | undefined) {
  if (arg?.type !== "line_string_literal") return null;

  if (!/^"[^"\\]*"$/.test(arg.text)) return null;

  return arg.text.slice(1, -1);
}

function swift(source: string, record: Evaluate, paint?: Paint) {
  withSyntax("swift", source, (root) => {
    for (const call of root.descendantsOfType("call_expression")) {
      if (paint && call.namedChild(0)?.text === "Text")
        paint(
          call.startPosition.row + 1,
          "Text",
          null,
          "Read the resolved text and background in the running app.",
          call.endPosition.row + 1,
        );
      const member = call.namedChild(0)?.childForFieldName("suffix")?.text;

      if (member !== ".accessibilityLabel") continue;
      const args = call.namedChild(1)?.descendantsOfType("value_argument");

      if (args?.length !== 1) continue;
      const value = args[0].childForFieldName("value");

      const el: Markup = {
        tag: "swiftui-label",
        line: args[0].startPosition.row + 1,
        end: args[0].endPosition.row + 1,
        source: ".accessibilityLabel(" + args[0].text + ")",
        attrs: new Map(),
        spread: false,
        text: swiftValue(value),
      };

      assessElement(el, record);
    }
  });
}

export function inspectAccessibility(
  file: string,
  source: string,
  record: Evaluate,
  paint?: Paint,
) {
  if (/\.html?$/i.test(file)) return html(source, record);

  if (/\.swift$/i.test(file)) return swift(source, record, paint);

  if (/\.(?:jsx|tsx|[cm]?js)$/i.test(file)) return jsx(source, record, paint);
  throw Error("No accessibility parser for this interface format");
}
