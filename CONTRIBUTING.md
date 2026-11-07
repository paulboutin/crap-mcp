# Contributing to CRAP Score MCP

Use [GitHub Issues](https://github.com/paulboutin/crap-mcp/issues) for bugs, feature requests and proposed language packs. For a scoring bug, include a small source example, the coverage format, and the expected and actual scores. Use a synthetic example if the original code or report is private.

## Run the project locally

You need Git, npm and Node.js 24.12 or newer. Fork the repository, clone your fork and create a branch from the current `main`. From the checkout root, run:

```sh
npm ci
npm run build
```

Use `npm test` while iterating. Before editing, save the starting commit with `base=$(git rev-parse HEAD)`. If your checkout already contains edits, also save the snapshot ID from the MCP tool `scan_repository_hotspots` so you can distinguish your patch from existing work. The [development review skill](.agents/skills/crap-development-review/SKILL.md) walks through the comparison.

Before opening a pull request, run:

```sh
CRAP_BASE="$base" npm run check
```

This runs lint, builds the server, measures the designated test suite, runs the configured QA replay and benchmark, and reviews this repository through MCP. For a scoring or coverage change, run `npm run prove` to exercise the before/after example. For a parser or catalog change, run `npm run prove:packs` to exercise download, activation and scanning. The pack proof needs network access to fetch the pinned grammars.

## Open a pull request

Target [the main branch](https://github.com/paulboutin/crap-mcp/pulls). Describe the behavior you changed, how to reproduce it, and which checks passed. For a scoring change, include the starting and ending raw CRAP score, measured coverage and any unscored functions. For a behavior or performance claim, include the corresponding replay or benchmark result. Report missing measurements explicitly.

For a language pack, follow the [catalog guide](languages/README.md). When adding or updating third-party code or a parser, record the upstream version or commit, preserve its license and copyright notices, and update [third-party notices](THIRD_PARTY_NOTICES.md). Original contributions are provided under this project's [MIT license](LICENSE).
