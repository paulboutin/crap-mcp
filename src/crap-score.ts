// This module also runs inside the standalone HTML report.
import type { Health, Rule } from "./findings.ts";

export function score(complexity: number, percent: number) {
  return complexity ** 2 * (1 - percent / 100) ** 3 + complexity;
}

function points(value: number) {
  if (value > 0 && value < 0.005) return "less than 0.01";

  const rounded = Number(value.toFixed(2));

  if (value > rounded && [30, 60].includes(rounded))
    return "just over " + rounded;

  return String(rounded);
}

function missingEvidence(h: Health) {
  const reasons = {
    missing: "The designated suite has no coverage for this function.",
    stale: "The coverage was measured on a different version of the source.",
    "wrong-suite": "The coverage came from a different test suite.",
    insufficient: "No measured lines could be attributed to this function.",
    fresh: "The measurement is incomplete.",
  };

  const reason =
    h.coverage.reason === "shared-line"
      ? "This callback shares a source line and has no separate execution count."
      : reasons[h.coverage.status];

  return (
    reason +
    " Its complexity is " +
    h.complexity +
    ", but the coverage contribution and total CRAP are unknown."
  );
}

function coverageObservation(h: Health) {
  const c = h.coverage;

  if (c.basis === "function-entry")
    return c.covered
      ? "The suite entered this callback"
      : "The suite did not enter this callback";

  return (
    "The suite covered " + c.covered + " of " + c.executable + " measured lines"
  );
}

// Use the same unrounded score and strict threshold as the scan. Rounding a
// target percentage first can recommend one too few executable lines.
function passingLineCount(complexity: number, covered: number, total: number) {
  let low = covered + 1;
  let high = total;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (score(complexity, (100 * mid) / total) > 30) low = mid + 1;
    else high = mid;
  }

  return low;
}

function coverageTarget(h: Health, covered: number, total: number) {
  if (h.complexity > 30 && covered === total)
    return " Reaching 30 requires reducing complexity.";

  if (h.complexity > 30)
    return (
      " Even with full measured coverage, CRAP would be " +
      h.complexity +
      ". Reaching 30 requires reducing complexity."
    );

  if (h.coverage.basis === "function-entry")
    return (
      " If the suite exercised this callback, its CRAP would fall to " +
      h.complexity +
      "."
    );
  const required = passingLineCount(h.complexity, covered, total);
  const extra = required - covered;

  return (
    " With the same complexity, covering at least " +
    extra +
    " more measured " +
    (extra === 1 ? "line" : "lines") +
    " (" +
    required +
    "/" +
    total +
    ") would bring CRAP to 30 or below."
  );
}

export function scoreEffect(h: Health, rule?: Rule) {
  if (rule === "nesting")
    return (
      "The nesting depth of " +
      h.depth +
      " adds no points by itself. Flattening these branches leaves CRAP unchanged if complexity and measured coverage stay the same."
    );
  const { covered, executable } = h.coverage;

  if (h.score === null || covered === null || executable === null)
    return missingEvidence(h);

  if (rule === "complexity" && h.coverage.percent !== null)
    return (
      "At full coverage, complexity alone gives this function a score of " +
      h.complexity +
      ". With the recorded coverage, reducing complexity from " +
      h.complexity +
      " to " +
      (h.complexity - 1) +
      " would lower CRAP from " +
      points(h.score) +
      " to " +
      points(score(h.complexity - 1, h.coverage.percent)) +
      "."
    );

  return measuredEffect(h, h.score, covered, executable);
}

function measuredEffect(
  h: Health,
  measured: number,
  covered: number,
  executable: number,
) {
  const gap = measured - h.complexity;
  const observation = coverageObservation(h);

  const breakdown =
    gap === 0
      ? observation +
        ". Coverage adds no points. The entire CRAP score of " +
        h.complexity +
        " comes from complexity."
      : observation +
        ". The coverage gap adds " +
        points(gap) +
        " points above the complexity of " +
        h.complexity +
        ", bringing CRAP to " +
        points(measured) +
        ".";

  return measured > 30
    ? breakdown + coverageTarget(h, covered, executable)
    : breakdown;
}
