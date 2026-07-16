/**
 * Tool-surface and version parity tests (proposal OMN-P-043).
 * Acceptance criteria 9 + 10: the MCP and openai-tools.json surfaces agree,
 * and version metadata cannot silently drift.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGINE_TOOLS, DECISION_TOOLS, LOCAL_ONLY_TOOL_NAMES, toOpenAiTools } from "../lib/tool-definitions.js";

const root = new URL("..", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));

test("checked-in openai-tools.json matches the canonical engine-tool surface", () => {
  const openai = readJson("openai-tools.json");
  const byName = new Map(openai.map((t) => [t.function.name, t.function]));

  assert.deepEqual(
    [...byName.keys()].sort(),
    ENGINE_TOOLS.map((t) => t.name).sort(),
    "tool name sets must be identical"
  );
  for (const tool of ENGINE_TOOLS) {
    const oa = byName.get(tool.name);
    assert.deepEqual(
      Object.keys(oa.parameters.properties ?? {}).sort(),
      Object.keys(tool.inputSchema.properties ?? {}).sort(),
      `${tool.name}: property names must match`
    );
    assert.deepEqual(
      [...(oa.parameters.required ?? [])].sort(),
      [...(tool.inputSchema.required ?? [])].sort(),
      `${tool.name}: required lists must match`
    );
  }
});

test("the once-missing omnarai_context retrieval params are present on both surfaces", () => {
  const openaiContext = readJson("openai-tools.json").find((t) => t.function.name === "omnarai_context");
  const mcpContext = ENGINE_TOOLS.find((t) => t.name === "omnarai_context");
  for (const prop of ["layers", "exclude", "evidence_threshold"]) {
    assert.ok(mcpContext.inputSchema.properties[prop], `MCP surface must keep '${prop}'`);
    assert.ok(openaiContext.function.parameters.properties[prop], `openai-tools.json must carry '${prop}'`);
  }
});

test("decision tools are local-only: never in openai-tools.json, all env-gated", () => {
  const openaiNames = new Set(readJson("openai-tools.json").map((t) => t.function.name));
  for (const name of LOCAL_ONLY_TOOL_NAMES) {
    assert.ok(!openaiNames.has(name), `${name} must not be exposed to the HTTP function-calling surface`);
  }
  assert.deepEqual(LOCAL_ONLY_TOOL_NAMES, DECISION_TOOLS.map((t) => t.name));
  for (const tool of DECISION_TOOLS) {
    assert.match(tool.description, /OMNARAI_DECISIONS_DIR/, `${tool.name} must document its opt-in gate`);
  }
});

test("toOpenAiTools projects inputSchema into function-calling parameters", () => {
  const projected = toOpenAiTools(ENGINE_TOOLS);
  assert.equal(projected.length, ENGINE_TOOLS.length);
  assert.equal(projected[0].type, "function");
  assert.deepEqual(projected[0].function.parameters, ENGINE_TOOLS[0].inputSchema);
});

test("version parity: package.json and server.json agree; index.js has no version literal", () => {
  const pkg = readJson("package.json");
  const srv = readJson("server.json");
  assert.equal(pkg.version, srv.version);
  assert.equal(srv.packages?.[0]?.version, pkg.version);

  // The runtime reads its version from package.json at startup; a hand-
  // maintained literal is how 1.3.0 shipped inside the 1.4.0 package.
  const indexSrc = readFileSync(new URL("index.js", root), "utf8");
  assert.doesNotMatch(indexSrc, /const VERSION = "\d/, "index.js must not hardcode a version literal");
  assert.match(indexSrc, /readFileSync\(new URL\("\.\/package\.json"/, "index.js must read the version from package.json");
});

test("scripts/check-tool-parity.js passes as a standalone release gate", () => {
  const out = execFileSync(process.execPath, ["scripts/check-tool-parity.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.match(out, /Parity OK/);
});
