# Accessibility

The [accessibility review skill](../skills/accessibility-review.md) checks authored UI source. The score is **100 × passed / (passed + failed)**, rounded down. Each applicable check on an element counts once. Pending checks appear separately. For example, eight passes, two failures and three pending checks produce **80/100**, with three items still to verify.

The report maps each rule to a WCAG success criterion and identifies its relationship to Revised Section 508. Revised Section 508 incorporates WCAG 2.0 A and AA for covered content and software. A later WCAG criterion such as 2.5.3, Label in Name, has its own mapping. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Revised Section 508](https://www.access-board.gov/508/)

## What gets checked

Checks include image alternatives, page language, button and frame names, visible button labels, viewport zoom restrictions, explicit SwiftUI labels and measurable text contrast. A missing button name, for example, can leave a screen reader user hearing only “button.” Give the control a meaningful name and inspect the computed name in the running interface.

Ordinary text requires **4.5:1** contrast. Large text requires **3:1**, starting at 24 CSS pixels or about 18.67 CSS pixels for bold text. The checker compares the unrounded ratio. HTML analysis can use local stylesheets and ancestor backgrounds. JSX analysis can measure supported literal inline styles. [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## What needs manual review

Runtime styles, dynamic names and unsupported paints may require a rendered check. Verify keyboard operation, focus order, zoom and the quality of alternative text in the running UI. Skipped files or zero evaluated checks leave the score unrated. The separate [colorblind score](colorblind.md) evaluates measured color pairs under simulated color vision.
