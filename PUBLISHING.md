# Publishing omnarai-mcp — npm + the MCP Registry

Publishing is a **recurring** action, so it's been reduced to one script:
`./scripts/publish.sh`. You authenticate **once** (two browser logins); after that
every release — including ones Claude runs for you — is a single command.

---

## The whole thing, once set up

```bash
./scripts/publish.sh            # publish current version
./scripts/publish.sh patch      # bump 1.1.0 -> 1.1.1 everywhere, then publish
```
It keeps the three version fields in sync (package.json + server.json ×2),
pre-flights that `mcpName` matches, publishes to npm, then to the registry (that
order matters — the registry verifies ownership by reading the npm package).

---

## One-time setup (the only parts that need a human in a browser)

### 1. npm auth — use a TOKEN, not `npm login` (this is the seamless choice)
npm now requires 2FA for publishing, so plain `npm login` would make **every**
publish prompt for a one-time code from your phone. A **token** skips that forever.

1. Browser → <https://www.npmjs.com> → sign in (or sign up — free).
2. Top-right avatar → **Access Tokens**.
3. **Generate New Token** → **Granular Access Token**.
4. Name it `omnarai-publish`. Set an expiration (e.g. 1 year).
5. Under **Permissions → Packages and scopes**, set **Read and write**
   (select the `omnarai-mcp` package, or "All packages").
6. **Generate token** and copy it (starts `npm_…` — shown only once).
7. Save it to npm's config file:
   ```bash
   npm config set //registry.npmjs.org/:_authToken=npm_XXXXXXXX
   ```
   (or hand the token to Claude and it will do this step).

Verify: `npm whoami` prints your username.

### 2. MCP Registry auth — GitHub device login (cached)
Proves you own the `io.github.justjlee/*` namespace.

```bash
mcp-publisher login github
```
It prints a URL (<https://github.com/login/device>) and an 8-character code.
Open the URL, enter the code, click **Authorize**. The credential is cached to
`~/.mcp-publisher`; re-run only when it expires.

> Claude can run this command for you and read you the code — you'd only do the
> browser click. Then Claude runs `./scripts/publish.sh`.

---

## Registry gotchas (the script now pre-flights these)
- `server.json` **description must be ≤ 100 characters** — the registry returns a
  422 otherwise (learned the hard way 2026-06-15).
- npm publish needs a **bypass-2FA** granular token (see step 1) — a plain token
  gets a 403.
- npm must be published **before** the registry (registry reads the npm package to
  verify `mcpName`). `publish.sh` already does them in that order.

## On version bumps
`./scripts/publish.sh patch|minor|major` handles the bump. Then commit:
```bash
git add package.json server.json && git commit -m "Release vX.Y.Z" && git push
```

## Why this matters
Agents discover tools through registries, not serendipity. Listing makes the
engine's query/council/info tools one `npx omnarai-mcp` away for any MCP client —
the discoverability half of "of use to the greater community of frontier AI."
The companion to this is the engine's access telemetry
(`omnarai-memory-engine/scripts/traffic.sh`), which tells you when that
discoverability turns into a real external call.
