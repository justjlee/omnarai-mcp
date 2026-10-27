// contract.js is the one table of what each tool is. These tests pin it to the tool schemas this
// package ships, and check the real stdio server advertises the annotations derived from it.
// The cross-surface checks (remote MCP, OpenAPI) live in the engine: scripts/check-tool-contract.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { TOOL_META, POLICY_CARD, CONTRACT_VERSION, WRITE_TOOLS, annotationsFor, contractSummary } from "../contract.js";
import { ENGINE_TOOLS, DECISION_TOOLS } from "../lib/tool-definitions.js";
import { PROTOCOL_ROUTES } from "../protocol-tools.js";

const ALL = [...ENGINE_TOOLS, ...DECISION_TOOLS];

test("every shipped tool has a contract entry, and every entry that claims stdio is shipped", () => {
  for (const t of ALL) assert.ok(TOOL_META[t.name], `${t.name} missing from TOOL_META`);
  const shipped = new Set(ALL.map((t) => t.name));
  for (const [name, m] of Object.entries(TOOL_META)) {
    if (m.surfaces.includes("stdio") || m.surfaces.includes("stdio-local")) assert.ok(shipped.has(name), `${name} claims stdio but is not shipped`);
  }
});

test("each input property is either sent to the route under a mapped name or declared client-side", () => {
  for (const t of ALL) {
    const m = TOOL_META[t.name];
    const props = Object.keys(t.inputSchema?.properties || {});
    const covered = new Set(Object.keys(m.client_side || {}));
    for (const h of m.http) {
      for (const k of Object.keys(h.params || {})) covered.add(k);
      for (const k of Object.keys(h.headers || {})) covered.add(k);
      for (const k of h.body || []) covered.add(k);
    }
    if (!m.http.length) continue; // local-only tools have no route
    for (const p of props) assert.ok(covered.has(p), `${t.name}.${p} is neither mapped nor declared client-side`);
    for (const k of covered) assert.ok(props.includes(k), `${t.name}: contract names '${k}', which the schema does not have`);
  }
});

test("the protocol runners send exactly what the contract says", () => {
  for (const [name, r] of Object.entries(PROTOCOL_ROUTES)) {
    const h = TOOL_META[name].http[0];
    assert.equal(h.path, r.path, name);
    assert.equal(h.method, r.method || "GET", name);
    if (r.method === "POST") assert.deepEqual(h.body, r.body, `${name} body`);
    else {
      assert.deepEqual(Object.keys(h.params).sort(), [...r.params].sort(), `${name} query params`);
      assert.deepEqual(h.headers || {}, r.headers || {}, `${name} headers`);
    }
  }
});

test("exactly one write reaches the engine; annotations follow the mode", () => {
  assert.deepEqual(WRITE_TOOLS.filter((n) => TOOL_META[n].scope === "review-queue"), ["omnarai_contribute"]);
  for (const n of WRITE_TOOLS) assert.ok(["review-queue", "local-files"].includes(TOOL_META[n].scope), `${n} writes somewhere undeclared`);
  for (const t of ALL) {
    assert.deepEqual(t.annotations, annotationsFor(t.name), `${t.name} carries derived annotations`);
    assert.equal(t.annotations.readOnlyHint, TOOL_META[t.name].mode === "read");
  }
  assert.equal(annotationsFor("omnarai_contribute").destructiveHint, false);
  assert.equal(annotationsFor("omnarai_create_decision_record").openWorldHint, false, "local ledger is not the open world");
});

test("the policy card is versioned and carries the trust boundary and identity policy", () => {
  assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(POLICY_CARD.contract_version, CONTRACT_VERSION);
  assert.match(POLICY_CARD.trust_boundary, /never instruction/);
  assert.match(POLICY_CARD.identity_policy, /declared, never verified/);
  assert.match(POLICY_CARD.disagreement_policy, /never a consensus score/);
  assert.ok(Object.isFrozen(POLICY_CARD));
  const s = contractSummary();
  for (const t of s.tools) assert.ok(!/approve|reject|redact|delete|publish/i.test(t.name), `${t.name}: discovery lists no moderation control`);
  assert.ok(!/INGEST|SECRET|Bearer/i.test(JSON.stringify(s)), "discovery names no secret or credential");
});

test("the stdio server advertises the annotated tools (real process, no network)", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../index.js", import.meta.url))], env: { PATH: process.env.PATH || "" }, stderr: "ignore" });
  const client = new Client({ name: "contract-test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, ENGINE_TOOLS.length, "decision tools stay hidden without OMNARAI_DECISIONS_DIR");
    for (const t of tools) assert.deepEqual(t.annotations, annotationsFor(t.name), `${t.name} over stdio`);
  } finally {
    await client.close();
  }
});
