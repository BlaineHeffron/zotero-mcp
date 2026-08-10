# zotero-mcp

`zotero-mcp` is the Research Workbench's capability-honest stdio adapter for Zotero 7.
It uses Zotero's built-in, GET-only local API for reads and the separately installed
Research Workbench Zotero extension for authenticated writes. It never opens
`zotero.sqlite` or the Zotero data directory.

The stdio entry supports MCP `2026-07-28`'s stateless `server/discover` lifecycle and
legacy initialize-based clients. Its static tool catalog is publicly cacheable for five
minutes, reducing repeated catalog transfer and prompt churn.

## Requirements and setup

- Node.js 20 or newer
- Zotero 7 for live use
- The Research Workbench Zotero extension for write tools

```sh
npm install
npm run build
npm test
node dist/src/index.js
```

Configuration:

- `ZOTERO_MCP_BASE_URL` defaults to `http://127.0.0.1:23119`. Only plain-HTTP URLs using the exact loopback hostnames `127.0.0.1`, `localhost`, or `[::1]` are accepted; userinfo is rejected and redirects are never followed.
- `ZOTERO_MCP_TOKEN_FILE` defaults to
  `~/.research-workbench/zotero-bridge.json`.

The server always starts and advertises all 15 contracted tools. When Zotero or the
extension is unavailable, calls return the shared structured error envelope with an
actionable code and message.

## Capability notes

- Reads are local and read-only.
- Writes are narrow Zotero data-layer operations provided by the extension.
- Moving an item to trash is supported; permanent deletion is not exposed.
- Linked-URL attachments are supported; file-content upload is not.
- The item full-text endpoint is probed only when requested. Zotero on the target
  machine currently returns 404 for `/api/users/0/items/<key>/fulltext`, so the tool
  returns `unsupported_capability` rather than claiming abstract metadata is full text.
- `zotero_health.writeAuth` is true only when extension health explicitly confirms the
  supplied token; the existence of a token file alone is not reported as valid auth.

## Tests

`npm test` is fully offline. A mock HTTP server replays checked-in, synthetic local-API
fixtures and covers Zotero-down, token-missing, extension-absent, stale-version, and
full-text-unsupported behavior. No automated test writes to a real Zotero library.

License: MIT. See [LICENSE](LICENSE).
