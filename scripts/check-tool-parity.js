#!/usr/bin/env node
/**
 * Tool-surface + version parity check (proposal OMN-P-043).
 *
 * Guards the three ways this package's surfaces have historically drifted:
 *   1. openai-tools.json missing tools or input properties that the MCP
 *      surface already ships (observed: omnarai_context's layers/exclude/
 *      evidence_threshold were absent for a full release cycle);
 *   2. openai-tools.json carrying tools the MCP surface doesn't have;
 *   3. package.json / server.json version fields disagreeing (the runtime
 *      version is now READ from package.json at startup, so it cannot drift
 *      on its own).
 *
 * Parity is enforced on names, required lists, and property-name sets — NOT
 * description text, because openai-tools.json keeps hand-tuned descriptions.
 *
 * DECISION_TOOLS are local stdio-only tools (they write to a local ledger and
 * have no engine HTTP equivalent), so they must NOT appear in openai-tools.json.
 *
 * Run directly (node scripts/check-tool-parity.js) or via scripts/publish.sh,
 * which treats a non-zero exit as a release blocker.
 */

import { readFileSync } from "node:fs";
import { ENGINE_TOOLS, LOCAL_ONLY_TOOL_NAMES } from "../lib/tool-definitions.js";

const root = new URL("..", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));

const problems = [];

// ── 1+2. Tool-surface parity ──────────────────────────────────────────────────

const openaiTools = readJson("openai-tools.json");
const openaiByName = new Map(openaiTools.map((t) => [t.function?.name, t.function]));
const mcpByName = new Map(ENGINE_TOOLS.map((t) => [t.name, t]));

for (const tool of ENGINE_TOOLS) {
  const oa = openaiByName.get(tool.name);
  if (!oa) {
    problems.push(`openai-tools.json is missing engine tool '${tool.name}'`);
    continue;
  }
  const mcpProps = Object.keys(tool.inputSchema.properties ?? {}).sort();
  const oaProps = Object.keys(oa.parameters?.properties ?? {}).sort();
  if (JSON.stringify(mcpProps) !== JSON.stringify(oaProps)) {
    problems.push(
      `'${tool.name}' property mismatch — MCP [${mcpProps.join(", ")}] vs openai-tools.json [${oaProps.join(", ")}]`
    );
  }
  const mcpReq = [...(tool.inputSchema.required ?? [])].sort();
  const oaReq = [...(oa.parameters?.required ?? [])].sort();
  if (JSON.stringify(mcpReq) !== JSON.stringify(oaReq)) {
    problems.push(
      `'${tool.name}' required mismatch — MCP [${mcpReq.join(", ")}] vs openai-tools.json [${oaReq.join(", ")}]`
    );
  }
}

for (const name of openaiByName.keys()) {
  if (!mcpByName.has(name)) {
    problems.push(
      LOCAL_ONLY_TOOL_NAMES.includes(name)
        ? `'${name}' is a local-only decision tool and must NOT be in openai-tools.json (no HTTP equivalent)`
        : `openai-tools.json has '${name}' which is not an MCP engine tool`
    );
  }
}

// ── 3. Version parity ─────────────────────────────────────────────────────────

const pkg = readJson("package.json");
const srv = readJson("server.json");
if (pkg.version !== srv.version) {
  problems.push(`version mismatch — package.json ${pkg.version} vs server.json ${srv.version}`);
}
const srvPkgVersion = srv.packages?.[0]?.version;
if (srvPkgVersion && srvPkgVersion !== pkg.version) {
  problems.push(`version mismatch — package.json ${pkg.version} vs server.json packages[0] ${srvPkgVersion}`);
}

// ── Report ────────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error("Tool/version parity FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `Parity OK — ${ENGINE_TOOLS.length} engine tools match openai-tools.json; ` +
    `${LOCAL_ONLY_TOOL_NAMES.length} decision tools correctly local-only; versions agree at ${pkg.version}.`
);
