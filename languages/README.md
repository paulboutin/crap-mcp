# Language pack catalog

Each JSON file is a pack consumed by the machine service and the standalone CLI. TypeScript, TSX and Swift ship with pinned grammars in `core/`. The other catalog entries fetch only their named WASM when enabled. All six published manifests use binaries from [@repomix/tree-sitter-wasms 0.1.17](https://www.npmjs.com/package/@repomix/tree-sitter-wasms/v/0.1.17); each lists the expected byte size and SHA-256. The bundled license and upstream Swift and TypeScript notices are in `core/`.

Start with [the Python manifest](python.json). Match the function, container, control-flow, decision and nesting entries to node names from the grammar. Controls count toward both complexity and nesting. The walker assigns nested functions their own decisions and source ranges. Verify the adapter on representative source, including closures and methods, then supply line-level coverage to check CRAP scores. When updating a remote grammar, pin a new immutable version and digest.

For a private pack put the manifest and optional local WASM in the machine's trusted `languages/` directory outside project checkouts. Restart the server to reload its catalog. See [installation, settings and registration](../README.md#language-packs-and-native-linters). The proof command exercises an external local manifest as well as the three downloadable packs.
