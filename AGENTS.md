# zotero-mcp

Capability-honest stdio adapter for Zotero 7.

## Invariants

- Read through Zotero's loopback GET API. Write only through the authenticated Research Workbench extension.
- Never open `zotero.sqlite` or the Zotero data directory.
- Accept only the existing loopback URL policy; do not follow redirects or weaken token handling.
- Report unsupported or unavailable capabilities explicitly. Metadata is not full text.
- Automated tests are offline and must never write to a real Zotero library.

## Verification

- Run `npm test`, `npm run typecheck`, and `npm run build`.
