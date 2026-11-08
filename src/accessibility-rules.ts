import { z } from "zod";

export const accessibilityIds = [
  "text-contrast",
  "image-alternative",
  "document-language",
  "frame-name",
  "button-name",
  "label-in-name",
  "viewport-zoom",
  "swiftui-label",
] as const;

export const accessibilityRule = z.enum(accessibilityIds);

export type AccessibilityRule = z.infer<typeof accessibilityRule>;

const shared = "Revised 508 E205.4 / E207.2 (WCAG 2.0)";

export const accessibilityCatalog = {
  "text-contrast": {
    title: "Text contrast and color vision",
    why: "The measured text and background fall below the threshold for this text size.",
    impact:
      "Readers with low vision may struggle to distinguish characters from the background.",
    check:
      "Sample rendered foreground and background colors in each supported theme and interaction state.",
    category: "WCAG 2.2 · 1.4.3 AA",
    section508: shared,
    action:
      "Adjust the foreground or background to meet 4.5:1 for ordinary text or 3:1 for large text. Verify in the running interface.",
  },
  "image-alternative": {
    title: "Image text alternative",
    why: "The image has no text alternative recognized by the enabled source check.",
    impact:
      "A screen reader user may miss the information or purpose conveyed by the image.",
    check:
      "Inspect the accessibility tree and listen to the image in context. A decorative image should be skipped.",
    category: "WCAG 2.2 · 1.1.1 A",
    section508: shared,
    action:
      "Give informative images an equivalent description and decorative images an empty alt.",
  },
  "document-language": {
    title: "Page language declaration",
    why: "The document has no nonempty primary language declaration.",
    impact:
      "Assistive speech can use the wrong pronunciation rules, making the page difficult to understand.",
    check:
      "Inspect the rendered html lang attribute and listen to a passage with a screen reader.",
    category: "WCAG 2.2 · 3.1.1 A",
    section508: shared,
    action:
      "Declare the primary language on the html element and verify it matches the content.",
  },
  "frame-name": {
    title: "Frame name",
    why: "The frame has no accessible name recognized in its markup.",
    impact:
      "A screen reader user navigating by frame may be unable to identify the embedded content.",
    check:
      "Inspect the frame list with a screen reader and confirm the name identifies its purpose.",
    category: "WCAG 2.2 · 4.1.2 A",
    section508: shared,
    action: "Give the frame a descriptive title or an accessible name.",
  },
  "button-name": {
    title: "Button name",
    why: "The button has no accessible name recognized in its markup.",
    impact:
      "Someone navigating controls by name may hear only “button” and be unable to choose the intended action.",
    check:
      "Focus the button and confirm the accessibility tree exposes its role and a meaningful name.",
    category: "WCAG 2.2 · 4.1.2 A",
    section508: shared,
    action:
      "Give the button visible text or an accessible name describing its action.",
  },
  "label-in-name": {
    title: "Visible button label in its accessible name",
    why: "The explicit accessible name omits the visible button label.",
    impact:
      "A speech input user may be unable to activate the button by saying the words on screen.",
    check:
      "Compare the computed name with the visible text and activate the control using that text.",
    category: "WCAG 2.2 · 2.5.3 A",
    section508: "Added in WCAG 2.1, outside the incorporated WCAG 2.0 criteria",
    action:
      "Include the visible label in the accessible name so speech users can activate the button by name.",
  },
  "viewport-zoom": {
    title: "Page permits text resizing",
    why: "The viewport declaration restricts user scaling or caps zoom below 200%.",
    impact:
      "People who enlarge text may be unable to read or operate the interface at a usable size.",
    check:
      "Zoom to 200% and complete the same task without losing content or controls.",
    category: "WCAG 2.2 · 1.4.4 AA",
    section508: shared,
    action:
      "Allow user scaling and a maximum zoom of at least 200%. Verify text resizing in the browser.",
  },
  "swiftui-label": {
    title: "Explicit SwiftUI accessibility label",
    why: "The explicit SwiftUI accessibility label is empty.",
    impact:
      "VoiceOver users may lose the spoken cue that identifies the control.",
    check:
      "Navigate to the element with VoiceOver and listen to its name and available action.",
    category: "WCAG 2.2 · 4.1.2 A",
    section508: "Revised 508 E207.2 (WCAG 2.0)",
    action:
      "Provide a meaningful spoken label and verify the resulting control with VoiceOver.",
  },
} as const;

export const assessedElement = z.object({
  file: z.string(),
  line: z.number(),
  end: z.number().optional(),
  excerpt: z.string().optional(),
  evidence: z.string().optional(),
  rule: accessibilityRule,
});

export const observation = assessedElement.extend({
  id: z.string(),
  status: z.enum(["fail", "review"]),
});

export interface Markup {
  tag: string;
  line: number;
  source: string;
  end?: number;
  evidence?: string;
  attrs: Map<string, string | null>;
  spread: boolean;
  text: string | null;
}

export type Verdict = "pass" | "fail" | "review";

export type Evaluate = (
  rule: AccessibilityRule,
  verdict: Verdict,
  element: Markup,
) => void;

function nonempty(value: string | undefined | null): Verdict {
  if (value === null) return "review";

  return value?.trim() ? "pass" : "fail";
}

function named(e: Markup, fallback: string | null): Verdict {
  if (e.attrs.get("aria-labelledby") || e.attrs.get("aria-labelledby") === null)
    return "review";
  const label = e.attrs.get("aria-label");

  if (label === null || label?.trim()) return nonempty(label);

  if (fallback === null) return "review";

  return nonempty(fallback || e.attrs.get("title"));
}

function imageAlternative(e: Markup): Verdict {
  if (e.attrs.has("alt"))
    return e.attrs.get("alt") === null ? "review" : "pass";

  if (["presentation", "none"].includes(e.attrs.get("role") ?? ""))
    return "review";

  return named(e, "");
}

function zoom(content: string | null | undefined): Verdict {
  if (content === null) return "review";

  const tokens = (content ?? "")
    .toLowerCase()
    .split(/[,;]/)
    .map((s) => s.trim().split(/\s*=\s*/));

  const params = new Map(tokens.map(([key, value]) => [key, value]));

  if (["0", "no"].includes(params.get("user-scalable") ?? "")) return "fail";
  const max = params.get("maximum-scale");

  return max && Number(max) < 2 ? "fail" : "pass";
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function button(e: Markup, evaluate: Evaluate) {
  evaluate("button-name", named(e, e.text), e);
  const label = e.attrs.get("aria-label");

  if (!e.attrs.has("aria-label") || e.text === "") return;

  if (label == null || e.text === null || e.attrs.has("aria-labelledby")) {
    evaluate("label-in-name", "review", e);

    return;
  }

  if (label.trim())
    evaluate(
      "label-in-name",
      normalize(label).includes(normalize(e.text)) ? "pass" : "fail",
      e,
    );
}

export function assessElement(e: Markup, record: Evaluate) {
  const evaluate: Evaluate = (id, outcome, el) =>
    record(id, el.spread ? "review" : outcome, el);

  switch (e.tag) {
    case "html":
      evaluate("document-language", nonempty(e.attrs.get("lang")), e);
      break;
    case "img":
      evaluate("image-alternative", imageAlternative(e), e);
      break;
    case "iframe":
      evaluate("frame-name", named(e, ""), e);
      break;
    case "button":
      button(e, evaluate);
      break;
    case "meta":
      if (e.attrs.get("name")?.toLowerCase() === "viewport")
        evaluate("viewport-zoom", zoom(e.attrs.get("content")), e);
      break;
    case "swiftui-label":
      evaluate("swiftui-label", nonempty(e.text), e);
      break;
  }
}

export function accessibilityExplanation(f: z.infer<typeof observation>) {
  const rule = accessibilityCatalog[f.rule];
  const pending = f.status === "review";

  return {
    ...f,
    detail: {
      file: f.file,
      line: f.line,
      end: f.end,
      excerpt: f.excerpt,
      why:
        f.evidence ??
        (pending
          ? "The source check could not establish the rendered result for “" +
            rule.title +
            "”."
          : rule.why),
      impact: pending
        ? "If the rendered element fails this check, " +
          rule.impact.charAt(0).toLowerCase() +
          rule.impact.slice(1)
        : rule.impact,
      action: rule.action,
      check: rule.check,
      scoring: pending
        ? "Pending manual verification. Excluded from the evaluated-check denominator."
        : "One failed evaluated check, included in the accessibility score denominator.",
    },
  };
}

const passReasons = {
  "text-contrast":
    "The modeled foreground and background meet the text contrast target.",
  "image-alternative":
    "The image supplies an alternative, including an empty alt for decorative use, or another recognized name.",
  "document-language": "The page declares a nonempty primary language.",
  "frame-name": "The frame supplies a name recognized by the source check.",
  "button-name": "The button supplies a name recognized by the source check.",
  "label-in-name":
    "The explicit accessible name includes the visible button label.",
  "viewport-zoom": "The viewport declaration permits the tested zoom settings.",
  "swiftui-label": "The explicit SwiftUI accessibility label contains text.",
};

export function passedExplanation(f: z.infer<typeof assessedElement>) {
  const rule = accessibilityCatalog[f.rule];

  return {
    ...f,
    detail: {
      file: f.file,
      line: f.line,
      end: f.end,
      excerpt: f.excerpt,
      why: f.evidence ?? passReasons[f.rule],
      impact:
        "If this check regresses, " +
        rule.impact.charAt(0).toLowerCase() +
        rule.impact.slice(1),
      action: rule.action,
      check: rule.check,
      scoring:
        "One pass in the numerator and denominator of the accessibility score.",
    },
  };
}
