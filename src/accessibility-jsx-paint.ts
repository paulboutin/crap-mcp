import { z } from "zod";
import type { Node } from "web-tree-sitter";
import {
  measurePair,
  textThreshold,
  rgbHex,
  type Paint,
} from "./color-contrast.ts";
import type { Markup } from "./accessibility-rules.ts";

function inlineStyles(tag: Node) {
  const style = tag.namedChildren.find(
    (attr) => attr?.namedChild(0)?.text === "style",
  );

  const object = style?.namedChild(1)?.namedChild(0);
  const values = new Map<string, string>();

  for (const field of object?.namedChildren ?? []) {
    if (field?.type !== "pair") return new Map<string, string>();
    const key = field.childForFieldName("key")?.text ?? "";
    const value = field.childForFieldName("value")?.text ?? "";
    values.set(key, value.replace(/^(['"])(.*)\1$/, "$2"));
  }

  return values;
}

const literalPaint = z
  .object({
    color: rgbHex,
    backgroundColor: rgbHex,
    fontSize: z.string().regex(/^\d+(?:\.\d+)?(?:px)?$/),
    fontWeight: z
      .string()
      .regex(/^(normal|bold|[1-9]00)$/)
      .optional(),
  })
  .strict();

function pairFor(tag: Node, el: Markup) {
  if (el.spread || el.attrs.has("className")) return null;
  const parsed = literalPaint.safeParse(Object.fromEntries(inlineStyles(tag)));

  if (!parsed.success) return null;
  const { color, backgroundColor, fontSize, fontWeight } = parsed.data;

  return measurePair(
    color,
    backgroundColor,
    textThreshold(parseFloat(fontSize), fontWeight),
  );
}

export function jsxPaint(tag: Node, el: Markup, paint: Paint) {
  if (!/^[a-z][\w-]*$/.test(el.tag) || el.text === "") return;
  const pair = pairFor(tag, el);
  paint(
    el.line,
    el.tag,
    pair,
    pair ? undefined : "Check colors and font in the rendered component.",
    el.end,
  );
}
