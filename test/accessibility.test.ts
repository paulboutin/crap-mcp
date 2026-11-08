import {
  colorSummary,
  measurePair,
  survives,
  type ColorSample,
} from "../src/color-contrast.ts";
import { htmlPaint } from "../src/accessibility-paint.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, repository } from "../src/files.ts";
import { inspectAccessibility } from "../src/accessibility-markup.ts";
import { qualityPolicy, updatePolicy } from "../src/quality-policy.ts";
import {
  accessibilityBaseline,
  accessibilityScan,
  accessibilityCheck,
  accessibilityReport,
  dashboardAccessibility,
} from "../src/accessibility.ts";

function outcomes(file: string, source: string) {
  const result: string[] = [];
  inspectAccessibility(file, source, (rule, status) =>
    result.push(rule + " " + status),
  );

  return result;
}

test("literal web evidence handles naming alternatives, hidden content, zoom, and document versus fragment scope", () => {
  const html = (s: string) => outcomes("view.html", s);
  assert.deepEqual(
    html(
      '<!doctype html><button id="no"></button><img alt=""><iframe title="Map"></iframe>',
    ),
    [
      "button-name fail",
      "image-alternative pass",
      "frame-name pass",
      "document-language fail",
    ],
  );
  assert.deepEqual(
    html(
      '<!-- <img> --><script>const s="<img>"</script><div hidden><button></button></div>',
    ),
    [],
  );
  assert.deepEqual(
    html(
      '<button><span>Save</span></button><img aria-labelledby="name"><img role="presentation">',
    ),
    [
      "button-name review",
      "image-alternative review",
      "image-alternative review",
    ],
  );
  assert.deepEqual(
    html(
      '<meta name="viewport" content="width=device-width, user-scalable=no"><meta name="viewport" content="maximum-scale=1.5"><meta name="viewport" content="maximum-scale=2">',
    ),
    ["viewport-zoom fail", "viewport-zoom fail", "viewport-zoom pass"],
  );
  const jsx = (s: string) => outcomes("view.tsx", "const v=<>" + s + "</>;");
  assert.deepEqual(
    jsx(
      '<button hidden={false} aria-label="Save draft">Save</button><img {...props}/><img alt={name}/><button aria-hidden="true"></button><Button/>',
    ),
    [
      "button-name pass",
      "label-in-name pass",
      "image-alternative review",
      "image-alternative review",
    ],
  );
  assert.deepEqual(
    jsx(
      '<button aria-label={name}>Save</button><iframe title={title}/><meta name="viewport" content={value}/>',
    ),
    [
      "button-name review",
      "label-in-name review",
      "frame-name review",
      "viewport-zoom review",
    ],
  );
});

test("SwiftUI labels distinguish literal labels from values that need VoiceOver verification", () => {
  assert.deepEqual(
    outcomes(
      "View.swift",
      'func render() {\n Image(systemName:"tray").accessibilityLabel("Inbox")\n Image(systemName:"tray").accessibilityLabel("")\n Image(systemName:"tray").accessibilityLabel(model.title)\n }',
    ),
    ["swiftui-label pass", "swiftui-label fail", "swiftui-label review"],
  );
});

test("accessibility gates, policy changes, skips and empty scopes preserve evidence boundaries", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "access-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init");
  const repo = repository(dir);
  assert.equal(accessibilityCheck(repo, 90).status, "incomplete");
  writeFileSync(join(dir, "view.jsx"), "const ui=<img/>;");
  const baseline = accessibilityScan(repo);
  assert.equal(accessibilityCheck(repo, 80).status, "failed");
  writeFileSync(
    join(dir, "view.jsx"),
    'const ui=<><img alt=""/><button>{label}</button></>;',
  );
  assert.equal(accessibilityCheck(repo, 80).status, "incomplete");
  writeFileSync(join(dir, "view.jsx"), 'const ui=<img alt=""/>;');
  assert.equal(accessibilityCheck(repo, 100).status, "passed");
  const policy = qualityPolicy(repo);
  updatePolicy(repo, {
    revision: policy.revision,
    settings: { ...policy.settings, accessibilityRules: [] },
  });
  assert.throws(
    () => accessibilityReport(accessibilityScan(repo), baseline),
    /policy differs/,
  );
  assert.match(
    dashboardAccessibility(repo, baseline.id).comparisonText,
    /policy changed/,
  );
  assert.match(
    accessibilityReport(accessibilityScan(repo)).reason!,
    /No enabled/,
  );
  writeFileSync(join(dir, "view.vue"), "<template/>");
  symlinkSync("missing-file", join(dir, "link.html"));
  const s = accessibilityScan(repo);
  assert.equal(s.skipped.length, 2);
  assert.equal(accessibilityReport(s).score, null);
  assert.throws(() => accessibilityBaseline(repo, "../x"), /Invalid/);
});

test("contrast uses original ratios at the AA boundary and linear RGB for each simulation", () => {
  const white = measurePair("#fff", "#000", 4.5);
  assert.equal(white.ratio, 21);
  assert.equal(survives(white), true);
  assert.ok(
    Math.abs(measurePair("#777", "#fff", 4.5).ratio - 4.47808945) < 0.000001,
  );
  const red = measurePair("#f00", "#000", 4.5);
  assert.equal(red.ratio, 5.252);
  assert.ok(red.protanopia < 4.5);
  assert.ok(red.deuteranopia > 4.5);
  assert.equal(survives(red), false);
});

test("contrast uses local CSS, ancestor backgrounds and large text thresholds, and keeps uncertain paints pending", () => {
  const styles = new Map([
    [
      "pages/theme.css",
      "body{background:white;color:#777} .large{font-size:24px} .red{color:red;background:black}",
    ],
  ]);

  const markup =
    '<link rel="stylesheet" href="./theme.css"><p>Ordinary</p><p class="large">Large</p><p class="red">Danger</p><p style="background-image:linear-gradient(red,blue)">Gradient</p><p hidden>Hidden</p>';

  const colors: ColorSample[] = [];

  const run = (html: string) =>
    htmlPaint("pages/index.html", html, styles, (line, element, pair, reason) =>
      colors.push({ file: "pages/index.html", line, element, pair, reason }),
    );

  run(markup);
  assert.equal(colors.length, 4);
  assert.equal(colors[0].pair?.foreground, "#777777");
  assert.equal(colors[0].pair?.threshold, 4.5);
  assert.equal(colors[1].pair?.threshold, 3);
  assert.equal(colors[3].pair, null);
  assert.deepEqual(colorSummary(colors, 0), {
    score: 33,
    passed: 1,
    measured: 3,
    pending: 1,
    profiles: { protanopia: 1, deuteranopia: 2, tritanopia: 2 },
  });
  run(
    '<link rel="stylesheet" href="https://example.invalid/remote.css"><p>Unknown</p>',
  );
  assert.equal(colors[4].pair, null);
});

test("checkout palette and JSX styles contribute independently to the colorblind score", (t) => {
  const root = mkdtempSync(join(tmpdir(), "palette-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init");
  const repo = repository(root);
  const p = qualityPolicy(repo);

  const palette = [
    { label: "Approved / rejected", first: "#f00", second: "#008000" },
  ];

  updatePolicy(repo, {
    revision: p.revision,
    settings: { ...p.settings, accessibilityPalette: palette },
  });
  writeFileSync(
    join(root, "card.tsx"),
    'const card=<span style={{color:"#fff",backgroundColor:"#000",fontSize:16}}>Card</span>',
  );
  const r = accessibilityReport(accessibilityScan(repo));
  assert.equal(r.score, 100);
  assert.equal(r.colorblind.score, 50);
  assert.equal(accessibilityCheck(repo, 90, 80).colorblindStatus, "failed");
  assert.equal(r.colorblind.measured, 2);
  assert.equal(r.colors[1].element, "Approved / rejected");
});
