import { z } from "zod";

export const rgbHex = z.string().regex(/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i);

export const palettePairs = z
  .array(
    z
      .object({
        label: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .regex(/^[^\r\n]+$/),
        first: rgbHex,
        second: rgbHex,
      })
      .strict(),
  )
  .max(100)
  .refine((rows) => {
    const labels = rows.map((r) => r.label);

    return new Set(labels).size === rows.length;
  }, "Use unique palette labels");

export const colorPair = z.object({
  foreground: z.string(),
  background: z.string(),
  threshold: z.number(),
  ratio: z.number(),
  protanopia: z.number(),
  deuteranopia: z.number(),
  tritanopia: z.number(),
});

export type ColorPair = z.infer<typeof colorPair>;

type Channels = [number, number, number];

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear sRGB.
const matrices = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function linear(byte: number) {
  const v = byte / 255;

  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function channels(hex: string): Channels {
  const full =
    hex.length === 4 ? hex.slice(1).replace(/./g, "$&$&") : hex.slice(1);

  return [
    linear(parseInt(full.slice(0, 2), 16)),
    linear(parseInt(full.slice(2, 4), 16)),
    linear(parseInt(full.slice(4, 6), 16)),
  ];
}

function dot(rgb: Channels, weights: number[]) {
  return Math.max(
    0,
    Math.min(
      1,
      rgb[0] * weights[0] + rgb[1] * weights[1] + rgb[2] * weights[2],
    ),
  );
}

function luminance(rgb: Channels, matrix?: number[][]) {
  const color: Channels = matrix
    ? [dot(rgb, matrix[0]), dot(rgb, matrix[1]), dot(rgb, matrix[2])]
    : rgb;

  return dot(color, [0.2126, 0.7152, 0.0722]);
}

function ratio(a: Channels, b: Channels, matrix?: number[][]) {
  const x = luminance(a, matrix),
    y = luminance(b, matrix);

  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function measurePair(
  foreground: string,
  background: string,
  threshold: number,
): ColorPair {
  const fg = channels(foreground),
    bg = channels(background);

  return {
    foreground,
    background,
    threshold,
    ratio: ratio(fg, bg),
    protanopia: ratio(fg, bg, matrices.protanopia),
    deuteranopia: ratio(fg, bg, matrices.deuteranopia),
    tritanopia: ratio(fg, bg, matrices.tritanopia),
  };
}

export function textThreshold(px: number, weight: string | undefined) {
  const bold = weight === "bold" || Number(weight) >= 700;

  return px >= 24 || (px >= 56 / 3 && bold) ? 3 : 4.5;
}

export const simulations = [
  "protanopia",
  "deuteranopia",
  "tritanopia",
] as const;

export function survives(pair: ColorPair) {
  return simulations.every((profile) => pair[profile] >= pair.threshold);
}

export const sample = z.object({
  file: z.string(),
  line: z.number(),
  element: z.string(),
  end: z.number().optional(),
  excerpt: z.string().optional(),
  pair: colorPair.nullable(),
  reason: z.string().optional(),
});

export type ColorSample = z.infer<typeof sample>;

export type Paint = (
  line: number,
  element: string,
  pair: ColorPair | null,
  reason?: string,
  end?: number,
) => void;

export function colorSummary(samples: ColorSample[], skipped: number) {
  const measured = samples.flatMap((s) => (s.pair ? [s.pair] : []));
  const passed = measured.filter(survives).length;

  const score =
    measured.length && !skipped
      ? Math.floor((100 * passed) / measured.length)
      : null;

  return {
    score,
    passed,
    measured: measured.length,
    pending: samples.length - measured.length,
    profiles: Object.fromEntries(
      simulations.map((p) => [
        p,
        measured.filter((pair) => pair[p] >= pair.threshold).length,
      ]),
    ),
  };
}

export function colorExplanation(s: ColorSample) {
  const p = s.pair;

  const failedProfiles = p
    ? simulations.filter((profile) => p[profile] < p.threshold)
    : [];

  const status = !p
    ? "Needs review"
    : failedProfiles.length
      ? "Failed simulation"
      : "Passed simulations";

  const measurements = p
    ? [
        p.foreground +
          " on " +
          p.background +
          " · target " +
          p.threshold +
          ":1",
        "Ordinary contrast " +
          p.ratio.toFixed(3) +
          ":1 (" +
          (p.ratio >= p.threshold ? "pass" : "fail") +
          ")",
        ...simulations.map(
          (profile) =>
            profile +
            " " +
            p[profile].toFixed(3) +
            ":1 (" +
            (p[profile] >= p.threshold ? "pass" : "fail") +
            ")",
        ),
      ].join(" · ")
    : (s.reason ?? "Rendered measurements are needed.");

  return {
    ...s,
    status,
    failedProfiles,
    detail: {
      file: s.file,
      line: s.line,
      end: s.end,
      excerpt: s.excerpt,
      why: measurements,
      impact: failedProfiles.length
        ? "The pair loses contrast under " +
          failedProfiles.join(", ") +
          ". People with this color vision may have difficulty distinguishing the two colors."
        : "Text legibility and the distinction between states also depend on the surrounding interface and its non-color cues.",
      scoring: !p
        ? "Pending. Excluded from the measured-pair denominator."
        : "Counts as one measured pair. The colorblind score counts a pass only when all three simulations meet the target.",
      action:
        "Adjust foreground or background lightness where contrast falls short. Pair meaningful status colors with a label, icon or pattern.",
      check:
        "Sample the rendered colors in each relevant state, rerun the pair check and verify the task can be completed without relying on hue.",
    },
  };
}
