# Third-party notices

The [project MIT license](LICENSE) covers original CRAP Score MCP code, documentation, dashboard and agent skills. The following components retain their upstream licenses and copyright notices.

## Code and binaries distributed with this repository

| Component | Source | License text |
| --- | --- | --- |
| anti-slop Oxlint plugins | [Vendored revision and provenance](tools/oxlint/anti-slop/UPSTREAM.md) | [MIT, Dillon Mulroy](tools/oxlint/anti-slop/LICENSE) |
| ESLint Stylistic padding rule inside anti-slop | [Upstream revision and adaptations](tools/oxlint/anti-slop/vendor/eslint-stylistic/UPSTREAM.md) | [MIT, OpenJS Foundation and ESLint Stylistic contributors](tools/oxlint/anti-slop/vendor/eslint-stylistic/LICENSE) |
| Tree-sitter WASM bundle | [Repomix build used by the six catalog entries](https://github.com/repomix/tree-sitter-wasms/tree/1876d74fb86d4e45efade2176b71d776f430e7e6) | [The Unlicense](languages/core/BUNDLE-LICENSE) |
| TypeScript and TSX grammars | [tree-sitter-typescript 0.23.2](https://www.npmjs.com/package/tree-sitter-typescript/v/0.23.2), based on [tree-sitter-javascript 0.23.1](https://www.npmjs.com/package/tree-sitter-javascript/v/0.23.1) | [TypeScript MIT notice](languages/core/TYPESCRIPT-LICENSE) and [JavaScript MIT notice](languages/licenses/javascript-LICENSE) |
| Swift grammar | [tree-sitter-swift 0.7.1](https://www.npmjs.com/package/tree-sitter-swift/v/0.7.1) | [MIT](languages/core/SWIFT-LICENSE) |

## Optional language packs

Enabling a pack downloads a grammar from the same Repomix bundle. The [bundle lockfile](https://github.com/repomix/tree-sitter-wasms/blob/1876d74fb86d4e45efade2176b71d776f430e7e6/package-lock.json) identifies the grammar versions. These notices ship with the catalog so they are available offline after installation.

| Grammar | Upstream package | License text |
| --- | --- | --- |
| Python | [tree-sitter-python 0.25.0](https://www.npmjs.com/package/tree-sitter-python/v/0.25.0) | [MIT](languages/licenses/python-LICENSE) |
| Go | [tree-sitter-go 0.25.0](https://www.npmjs.com/package/tree-sitter-go/v/0.25.0) | [MIT](languages/licenses/go-LICENSE) |
| Rust | [tree-sitter-rust 0.24.0](https://www.npmjs.com/package/tree-sitter-rust/v/0.24.0) | [MIT](languages/licenses/rust-LICENSE) |

## Dependencies installed by npm

The installer uses `npm ci` with the committed [lockfile](package-lock.json). Installed packages retain their distributed license and notice files under `node_modules`. Keep those files with any redistribution of the installed runtime, including transitive dependencies and platform binaries.

| Direct runtime packages | License | Installed license file |
| --- | --- | --- |
| `@modelcontextprotocol/sdk`, `@oxlint/plugins`, `oxlint`, `parse5`, `web-tree-sitter`, `zod` | MIT | `node_modules/<package>/LICENSE` |
| `jsdom` | MIT | `node_modules/jsdom/LICENSE.txt` |
| `jsonc-parser` | MIT | `node_modules/jsonc-parser/LICENSE.md` |
| `@resvg/resvg-js` and its native renderer | MPL-2.0 | `node_modules/@resvg/resvg-js/LICENSE` |

The scorecard renderer is installed unmodified. Its corresponding source for version 2.6.2 is available from [resvg-js at the published revision](https://github.com/yisibl/resvg-js/tree/9ca058462ac529120c8cc84ddcd6fef644cc5406).
