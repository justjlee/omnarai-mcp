/**
 * The remote surface's one source (remote-tools.js, 2026-11-25): version, order, schemas.
 * The engine serves a byte-identical copy (api/_remote-tools.js); its check-mcp-surface.js checks the copy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SURFACE_VERSION, MCP_SPEC, MCP_SPEC_VERSIONS, LIST_CACHE, OUTPUT_SCHEMAS, buildRemoteTools } from "../remote-tools.js";
import { PROTOCOL_TOOLS } from "../protocol-tools.js";
import { TOOL_META } from "../contract.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
const tools = buildRemoteTools(PROTOCOL_TOOLS);

test("SURFACE_VERSION is the package version (the remote serverInfo.version cannot drift again)", () => {
  assert.equal(SURFACE_VERSION, pkg.version);
  assert.equal(SURFACE_VERSION, server.version);
});

test("the remote tool set is exactly the contract's remote surface, with no duplicates", () => {
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "no duplicate names");
  const contractRemote = Object.keys(TOOL_META).filter((n) => TOOL_META[n].surfaces.includes("remote")).sort();
  assert.deepEqual([...names].sort(), contractRemote);
});

test("the order is fixed: engine tools, participation tools, omnarai_info last; same on every build", () => {
  assert.equal(tools[0].name, "omnarai_context");
  assert.equal(tools.at(-1).name, "omnarai_info");
  assert.deepEqual(buildRemoteTools(PROTOCOL_TOOLS).map((t) => t.name), tools.map((t) => t.name));
});

test("every remote tool declares an open object outputSchema", () => {
  for (const t of tools) {
    assert.ok(t.outputSchema, `${t.name} has an outputSchema`);
    assert.equal(t.outputSchema.type, "object", `${t.name}: root type object (required by spec 2025-06-18+)`);
    assert.equal(t.outputSchema.additionalProperties, true, `${t.name}: stays open`);
    assert.ok(!t.outputSchema.required, `${t.name}: requires nothing a branch can omit`);
  }
  assert.deepEqual(Object.keys(OUTPUT_SCHEMAS).sort(), tools.map((t) => t.name).sort());
});

test("spec versions: latest first, no duplicates; list cache is public with a non-negative ttl", () => {
  assert.equal(MCP_SPEC_VERSIONS[0], MCP_SPEC.latest);
  assert.equal(new Set(MCP_SPEC_VERSIONS).size, MCP_SPEC_VERSIONS.length);
  assert.ok(Number.isInteger(LIST_CACHE.ttlMs) && LIST_CACHE.ttlMs >= 0);
  assert.equal(LIST_CACHE.cacheScope, "public");
});
