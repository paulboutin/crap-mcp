# Colorblind score

The [accessibility review skill](../skills/accessibility-review.md) reports the percentage of measured pairs that meet their contrast target in **all three** simulations, rounded down. The simulations model protanopia, deuteranopia and tritanopia using the Machado, Oliveira and Fernandes matrices at full severity. This is a project-defined score. [Simulation model](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)

## Why this can differ from ordinary contrast

| Ordinary red text on black | Ratio | 4.5:1 text target |
| --- | ---: | --- |
| Original colors, `#f00` on `#000` | 5.252:1 | Pass |
| Protanopia simulation | 3.285:1 | Fail |

This pair passes the ordinary text check but contributes zero passes to the colorblind score. If two of three measured pairs meet their target in every simulation, the overall colorblind score is **66/100**. Open a pair to see all four ratios and the target used. Unresolved colors stay pending. A skipped file or zero measured pairs leaves the score unrated.

## Check status and chart colors

In **Project settings → Accessibility**, add two hex colors and their meaning, one pair per line. For example, enter `#2e7d32 #c62828 Approved / declined`. Configured palette pairs use a local 3:1 target. Text pairs retain their ordinary or large-text target.

If a status pair loses contrast, adjust lightness and test again. Put the status in text or pair it with a recognizable icon or pattern so the meaning survives changes in hue. [WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
