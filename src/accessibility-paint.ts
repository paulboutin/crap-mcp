import { JSDOM, VirtualConsole } from "jsdom";
import { posix } from "node:path";
import { measurePair, textThreshold, type Paint } from "./color-contrast.ts";

function hex(color: string) {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);

  return match
    ? "#" +
        match
          .slice(1)
          .map((n) => Number(n).toString(16).padStart(2, "0"))
          .join("")
    : null;
}

function layers(el: Element, style: (e: Element) => CSSStyleDeclaration) {
  const chain: CSSStyleDeclaration[] = [];

  for (let node: Element | null = el; node; node = node.parentElement)
    chain.push(style(node));

  return chain;
}

function complex(c: CSSStyleDeclaration) {
  return (
    [
      c.filter,
      c.mixBlendMode,
      c.backgroundBlendMode,
      c.textShadow,
      c.maskImage,
    ].some((v) => v && !["none", "normal", "initial"].includes(v)) ||
    (c.opacity !== "" && Number(c.opacity) !== 1)
  );
}

function background(chain: CSSStyleDeclaration[]) {
  for (const c of chain) {
    if (c.backgroundImage && c.backgroundImage !== "none") return null;

    if (["rgba(0, 0, 0, 0)", "transparent", ""].includes(c.backgroundColor))
      continue;

    return hex(c.backgroundColor);
  }

  return "#ffffff"; // Default light canvas used for this source model.
}

function fontPixels(value: string, parent: number, root: number) {
  if (!value) return parent;
  const v = parseFloat(value);

  if (value.endsWith("px")) return v;

  if (value.endsWith("rem")) return v * root;

  if (value.endsWith("em")) return v * parent;

  if (value.endsWith("%")) return (v * parent) / 100;

  return NaN;
}

function threshold(chain: CSSStyleDeclaration[]) {
  const root = fontPixels(chain.at(-1)!.fontSize, 16, 16);

  const size = chain
    .slice(0, -1)
    .reduceRight((px, c) => fontPixels(c.fontSize, px, root), root);

  if (!Number.isFinite(size)) return null;
  const weight = chain.find((c) => c.fontWeight)?.fontWeight ?? "normal";

  return textThreshold(size, weight);
}

function directText(e: Element) {
  return Array.from(e.childNodes).some(
    (n) => n.nodeType === 3 && n.textContent?.trim(),
  );
}

function styles(doc: Document, file: string, sheets: Map<string, string>) {
  let unavailable = false;

  for (const link of doc.querySelectorAll('link[rel~="stylesheet" i]')) {
    const href = (link.getAttribute("href") ?? "").split(/[?#]/)[0];
    const css = sheets.get(posix.join(posix.dirname(file), href));

    if (
      css === undefined ||
      /^(?:[\w+-]+:|\/)/.test(href) ||
      link.hasAttribute("media") ||
      doc.querySelector("base[href]")
    ) {
      unavailable = true;
      continue;
    }

    const replacement = doc.createElement("style");
    replacement.textContent = css;
    link.replaceWith(replacement);
  }

  return (
    unavailable ||
    Array.from(doc.querySelectorAll("style")).some((s) =>
      /@import\b/i.test(s.textContent ?? ""),
    )
  );
}

function sampleElement(chain: CSSStyleDeclaration[]) {
  if (chain.some(complex)) return null;

  const fg = hex(chain[0].color),
    bg = background(chain),
    target = threshold(chain);

  if (!fg || !bg || target === null) return null;

  return measurePair(fg, bg, target);
}

function unresolvedControl(el: Element, c: CSSStyleDeclaration) {
  return (
    el.matches("button,select,input,textarea") &&
    !hex(c.backgroundColor) &&
    c.appearance !== "none"
  );
}

function hiddenText(chain: CSSStyleDeclaration[]) {
  return (
    chain.some((c) => c.display === "none") || chain[0].visibility === "hidden"
  );
}

function endOfStartTag(loc: {
  startLine: number;
  startTag?: { endLine: number };
}) {
  return loc.startTag?.endLine ?? loc.startLine;
}

export function htmlPaint(
  file: string,
  source: string,
  sheets: Map<string, string>,
  record: Paint,
) {
  const dom = new JSDOM(source, {
    includeNodeLocations: true,
    virtualConsole: new VirtualConsole(),
  });

  try {
    const doc = dom.window.document;
    const missing = styles(doc, file, sheets);
    const cache = new Map<Element, CSSStyleDeclaration>();

    const style = (e: Element) => {
      const value = cache.get(e) ?? dom.window.getComputedStyle(e);
      cache.set(e, value);

      return value;
    };

    for (const el of doc.querySelectorAll("body, body *")) {
      if (
        !directText(el) ||
        el.closest("script,style,template,noscript,[hidden],[inert],:disabled")
      )
        continue;
      const loc = dom.nodeLocation(el);

      if (!loc) continue;
      const chain = layers(el, style);

      if (hiddenText(chain)) continue;

      const pair =
        missing || unresolvedControl(el, chain[0])
          ? null
          : sampleElement(chain);

      record(
        loc.startLine,
        el.localName,
        pair,
        pair ? undefined : "Verify rendered colors, font size or compositing.",
        endOfStartTag(loc),
      );
    }
  } finally {
    dom.window.close();
  }
}
