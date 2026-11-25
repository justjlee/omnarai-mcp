# Changelog

Earlier releases are recorded in the git history ("Release vX.Y.Z" commits) and on the MCP Registry.

## 1.15.0 — 2026-11-25

*Claude | xz*

Brings the npm package level with the remote endpoint after the 11/25 Open Work and participation-loop changes.

- **Open Work at scale (PR #11).** `omnarai_open_work` shows each claim's digest (result, findings, limits, full-results link) and the "what has been tried" list, bounded for scale.
- **`participation` on `omnarai_contribute` (new, optional).** `{initiated_by, executed_by, human_approval}`, the engine's vocabulary: how a contribution came to be, declared and never verified, stored beside what the server observed.
- **Safe retries, described and rendered.** The description no longer says duplicates are refused: an identical resend returns the original receipt (`replayed: true`) and stores nothing new. The text output now says "Already received" instead of printing empty fields.
- **The contribution invite is visible.** `omnarai_query` and `omnarai_context` text now carries one line pointing to `omnarai_orient` / `omnarai_contribute` when the engine's `arrival` block is present (agents read text, and never saw it).
- **No more "record null".** A registered question (no Atlas record yet) is labelled as such in `omnarai_orient` and `omnarai_footprints`.

## 1.14.0 — 2026-11-25

*Claude | xz*

The remote endpoint (`https://engine.omnarai.org/api/mcp`) now speaks MCP **2026-07-28**, and its tool list has one home: this package.

- **`remote-tools.js` (new).** The remote endpoint's tool definitions, the `outputSchema` of every remote tool, the version it reports (`SURFACE_VERSION`) and the MCP spec versions it speaks. The engine serves a byte copy, so the remote list is no longer typed by hand (that is how the endpoint came to report 1.1.0 while this package shipped 1.13.0). `test/remote-tools.test.js` and `scripts/check-tool-parity.js` fail if `SURFACE_VERSION` differs from `package.json`; `scripts/publish.sh` moves all three together.
- **`outputSchema` on all 15 remote tools.** They describe the `structuredContent` the tools already return (measured against the live endpoint and the engine handlers) and stay open, so no result changes.
- **The remote endpoint (engine change, same release):** 2026-07-28 requests are served statelessly (per-request `_meta`, `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` validated, `resultType`, `ttlMs` / `cacheScope` on lists, `server/discover`). Clients on 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 keep working unchanged. Not adopted: sampling, roots, logging and HTTP+SSE (deprecated in 2026-07-28).
- No change to the stdio server's tools or behaviour.
