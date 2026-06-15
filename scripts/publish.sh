#!/usr/bin/env bash
# One-command publish of omnarai-mcp to BOTH npm and the MCP Registry.
#
# Why this exists: publishing is a recurring action and the two-registry dance
# (npm first so the registry can verify the package's mcpName, then the registry)
# plus keeping THREE version fields in sync is easy to get wrong by hand.
#
# ONE-TIME setup (see PUBLISHING.md):
#   1. npm auth — put a granular/automation token in ~/.npmrc  (no OTP at publish)
#   2. mcp-publisher login github   (cached to ~/.mcp-publisher; re-run when it expires)
# After that, every release is just this script.
#
# Usage:
#   ./scripts/publish.sh                  # publish the current version as-is
#   ./scripts/publish.sh patch            # bump 1.1.0 -> 1.1.1 everywhere, then publish
#   ./scripts/publish.sh minor|major      # larger bumps
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:$HOME/.npm-global/bin:$PATH"

BUMP="${1:-}"
if [[ -n "$BUMP" ]]; then
  echo ">> Bumping version ($BUMP) in package.json + server.json (all 3 fields)"
  NEWV=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
  node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('server.json','utf8'));s.version='$NEWV';if(s.packages&&s.packages[0])s.packages[0].version='$NEWV';fs.writeFileSync('server.json',JSON.stringify(s,null,2)+'\n')"
  echo "   -> now v$NEWV"
fi

# Sanity: package.json mcpName must equal server.json name, or the registry rejects it.
node -e "const p=require('./package.json'),s=require('./server.json');if(p.mcpName!==s.name){console.error('MISMATCH: package.mcpName='+p.mcpName+' server.name='+s.name);process.exit(1)}if(p.version!==s.version){console.error('VERSION MISMATCH: package='+p.version+' server='+s.version);process.exit(1)}console.log('>> Pre-flight OK — '+p.name+'@'+p.version+' ('+p.mcpName+')')"

echo ">> 1/2  Publishing to npm…"
npm publish

echo ">> 2/2  Publishing to the MCP Registry…"
mcp-publisher publish

echo ""
echo ">> Done. Verify:"
echo "     https://www.npmjs.com/package/omnarai-mcp"
echo "     https://registry.modelcontextprotocol.io/v0/servers?search=omnarai"
echo ""
echo "   If you bumped the version, commit the package.json + server.json change:"
echo "     git add package.json server.json && git commit -m \"Release v$(node -p "require('./package.json').version")\" && git push"
