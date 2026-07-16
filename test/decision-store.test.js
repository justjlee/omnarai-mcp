/**
 * Decision Ledger store tests (proposal OMN-P-043).
 * Runs with the built-in test runner: `npm test` (node --test).
 * All records are written to fs.mkdtemp directories — never into the repo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDecisionStore } from "../lib/decision-store.js";
import { validateRecord } from "../lib/decision-schema.js";

const FIELDS = {
  title: "Test decision",
  problem: "Lineage is lost between idea and implementation.",
  proposed_direction: "Track it in a local ledger.",
  intended_outcome: "Shipped code traceable to approval.",
  source_ids: ["OMN-001"],
  uncertainties: ["File-backed approval is attestation, not identity."],
  dissent: [{ claim: "Could become process overhead.", strength: "unresolved" }],
  actor: "test-suite",
};

async function tempStore() {
  const root = await mkdtemp(path.join(tmpdir(), "omnarai-decisions-"));
  return createDecisionStore({ rootDir: root });
}

test("create: valid input yields a schema-valid exploring record with an initial event", async () => {
  const store = await tempStore();
  const record = await store.create(FIELDS);

  assert.match(record.id, /^OMN-P-\d{3}$/);
  assert.equal(record.status, "exploring");
  assert.equal(record.revision, 1);
  assert.equal(record.approval.state, "not_requested");
  assert.equal(record.events.length, 1);
  assert.equal(record.events[0].type, "created");
  assert.equal(record.events[0].actor, "test-suite");
  assert.doesNotThrow(() => validateRecord(record));

  // Persisted file round-trips through a NEW store instance.
  const store2 = createDecisionStore({ rootDir: store.root });
  const loaded = await store2.get(record.id);
  assert.deepEqual(loaded, record);
});

test("create: ids continue past existing json AND legacy yaml numbering", async () => {
  const store = await tempStore();
  await writeFile(path.join(store.root, "OMN-P-042.yaml"), "legacy: true\n");
  const record = await store.create(FIELDS);
  assert.equal(record.id, "OMN-P-043");
  const next = await store.create(FIELDS);
  assert.equal(next.id, "OMN-P-044");
});

test("create: rejects invalid input loudly", async () => {
  const store = await tempStore();
  await assert.rejects(
    () => store.create({ ...FIELDS, title: "" }),
    /title/
  );
  await assert.rejects(
    () => store.create({ ...FIELDS, problem: "x".repeat(5000) }),
    /exceeds/
  );
  await assert.rejects(
    () => store.create({ ...FIELDS, uncertainties: ["contains \u0000 nul"] }),
    /control characters/
  );
});

test("get: unsafe ids are rejected before touching the filesystem", async () => {
  const store = await tempStore();
  for (const bad of ["../evil", "OMN-P-001/../../x", "OMN-P-00ущерб", "", "OMN-D-0001"]) {
    await assert.rejects(() => store.get(bad), /Invalid decision id/);
  }
});

test("get: missing record returns null; corrupt record fails loud", async () => {
  const store = await tempStore();
  assert.equal(await store.get("OMN-P-999"), null);

  await writeFile(path.join(store.root, "OMN-P-100.json"), "{ not json");
  await assert.rejects(() => store.get("OMN-P-100"), SyntaxError);

  await writeFile(path.join(store.root, "OMN-P-101.json"), JSON.stringify({ id: "OMN-P-101", status: "shipped" }));
  await assert.rejects(() => store.get("OMN-P-101"), /Invalid decision record/);
});

test("appendEvent: appends without rewriting history and bumps updated_at", async () => {
  const store = await tempStore();
  const record = await store.create(FIELDS);
  const updated = await store.appendEvent(record.id, {
    type: "note",
    actor: "test-suite",
    note: "Investigation continued.",
    at: "2026-07-16T12:00:00Z",
  });
  assert.equal(updated.events.length, 2);
  assert.deepEqual(updated.events[0], record.events[0]); // history untouched
  assert.equal(updated.updated_at, "2026-07-16T12:00:00Z");

  // Write is atomic-replacement: file on disk parses and validates.
  const raw = await readFile(path.join(store.root, `${record.id}.json`), "utf8");
  assert.doesNotThrow(() => validateRecord(JSON.parse(raw)));
});

test("list: returns json records sorted, skipping legacy yaml", async () => {
  const store = await tempStore();
  await writeFile(path.join(store.root, "OMN-P-042.yaml"), "legacy: true\n");
  const a = await store.create(FIELDS);
  const b = await store.create(FIELDS);
  const all = await store.list();
  assert.deepEqual(all.map((r) => r.id), [a.id, b.id]);
});

test("store requires an explicit rootDir (the opt-in gate)", () => {
  assert.throws(() => createDecisionStore({}), /OMNARAI_DECISIONS_DIR/);
});
