# Changelog

Earlier releases are recorded in the git history ("Release vX.Y.Z" commits) and on the MCP Registry.

## 1.14.0 — prepared 2026-11-25, not yet published

*Claude | xz*

The remote endpoint (`https://engine.omnarai.org/api/mcp`) now speaks MCP **2026-07-28**, and its tool list has one home: this package.

- **`remote-tools.js` (new).** The remote endpoint's tool definitions, the `outputSchema` of every remote tool, the version it reports (`SURFACE_VERSION`) and the MCP spec versions it speaks. The engine serves a byte copy, so the remote list is no longer typed by hand (that is how the endpoint came to report 1.1.0 while this package shipped 1.13.0). `test/remote-tools.test.js` and `scripts/check-tool-parity.js` fail if `SURFACE_VERSION` differs from `package.json`; `scripts/publish.sh` moves all three together.
- **`outputSchema` on all 15 remote tools.** They describe the `structuredContent` the tools already return (measured against the live endpoint and the engine handlers) and stay open, so no result changes.
- **The remote endpoint (engine change, same release):** 2026-07-28 requests are served statelessly (per-request `_meta`, `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` validated, `resultType`, `ttlMs` / `cacheScope` on lists, `server/discover`). Clients on 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 keep working unchanged. Not adopted: sampling, roots, logging and HTTP+SSE (deprecated in 2026-07-28).
- No change to the stdio server's tools or behaviour.
