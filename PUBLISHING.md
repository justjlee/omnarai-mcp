# Publishing omnarai-mcp to npm + the official MCP Registry

Everything is prepared (`server.json`, `mcpName` in `package.json`, `LICENSE`, version 1.1.0).
Two steps require interactive auth and must be run by the curator. Total time: ~5 minutes.

## 1. Publish to npm (one-time login, then one command)

```bash
cd omnarai-mcp
npm login                # browser flow — npmjs.com account
npm publish              # publishes omnarai-mcp@1.1.0 (name verified free 2026-06-11)
```

The registry validates that the npm package's `mcpName` field matches `server.json`'s
`name` (`io.github.justjlee/omnarai-mcp`) — already set, nothing to do.

## 2. Publish to the MCP Registry

```bash
# install the publisher CLI (either)
brew install mcp-publisher
# or:
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

cd omnarai-mcp
mcp-publisher login github     # device flow — proves ownership of io.github.justjlee/*
mcp-publisher publish          # reads ./server.json
```

Success prints the server name + version. The server then appears at
`https://registry.modelcontextprotocol.io` and in downstream clients that sync from it.

## On version bumps

1. Bump `version` in BOTH `package.json` and `server.json` (and `packages[0].version`).
2. `npm publish`
3. `mcp-publisher publish`

## Why this matters

Agents discover tools through registries, not serendipity. Listing makes the engine's
query/council/info tools one `npx omnarai-mcp` away for any MCP client — the
discoverability half of "of use to the greater community of frontier AI entities."
