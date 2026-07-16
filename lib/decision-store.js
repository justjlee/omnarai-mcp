/**
 * File-backed Decision Ledger store (proposal OMN-P-043).
 *
 * One JSON file per record inside a single configured root directory —
 * Git-tracked so scope/approval changes show up as reviewable diffs.
 *
 * Safety properties:
 *   - IDs are generated server-side; caller input is never joined into a path.
 *   - Every resolved path is asserted to stay inside the ledger root.
 *   - Creates are exclusive (temp write + hardlink), so two racing creates
 *     cannot silently overwrite each other; updates are temp write + rename.
 *   - Every record is schema-validated on read AND write; a corrupt file
 *     fails loud instead of flowing onward.
 *
 * Note: the ledger is an audit trail, not an identity system. Anyone with
 * write access to the directory can edit records; Git history is the witness.
 */

import { link, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { assertSafeId, newRecord, validateRecord } from "./decision-schema.js";

const RECORD_FILE = /^(OMN-P-\d{3,6})\.json$/;
// Legacy YAML proposals (e.g. OMN-P-042.yaml) share the numbering but are not
// served by the store — they only reserve their number.
const NUMBERED_FILE = /^OMN-P-(\d{3,6})\.(json|yaml|yml)$/;

export function createDecisionStore({ rootDir }) {
  if (!rootDir || typeof rootDir !== "string") {
    throw new Error("Decision store requires a rootDir (set OMNARAI_DECISIONS_DIR).");
  }
  const root = path.resolve(rootDir);

  function fileFor(id) {
    assertSafeId(id);
    const file = path.join(root, `${id}.json`);
    if (!file.startsWith(root + path.sep)) {
      throw new Error(`Record path for ${id} escapes the ledger root — refusing.`);
    }
    return file;
  }

  async function listDirNames() {
    try {
      return await readdir(root);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  // Highest number used by ANY ledger file (json or legacy yaml), plus one.
  async function nextIdNumber() {
    const names = await listDirNames();
    let max = 0;
    for (const name of names) {
      const m = NUMBERED_FILE.exec(name);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }

  async function writeAtomic(file, record, { exclusive }) {
    const tmp = path.join(root, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    try {
      if (exclusive) {
        await link(tmp, file); // fails with EEXIST instead of overwriting
        await unlink(tmp);
      } else {
        await rename(tmp, file);
      }
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  return {
    root,

    /** Create a new record in 'exploring' status; allocates the next OMN-P id. */
    async create(fields) {
      await mkdir(root, { recursive: true });
      const base = await nextIdNumber();
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = `OMN-P-${String(base + attempt).padStart(3, "0")}`;
        const record = newRecord({ id, ...fields });
        try {
          await writeAtomic(fileFor(id), record, { exclusive: true });
          return record;
        } catch (err) {
          if (err.code !== "EEXIST") throw err;
          // Another writer took this number — try the next one.
        }
      }
      throw new Error("Could not allocate a unique decision id after 5 attempts.");
    },

    /** Read and validate one record. Returns null when the id has no file. */
    async get(id) {
      let raw;
      try {
        raw = await readFile(fileFor(id), "utf8");
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
      return validateRecord(JSON.parse(raw));
    },

    /** All JSON records in the ledger, sorted by id. Legacy YAML is skipped. */
    async list() {
      const names = await listDirNames();
      const ids = names
        .map((n) => RECORD_FILE.exec(n)?.[1])
        .filter(Boolean)
        .sort();
      const records = [];
      for (const id of ids) {
        const record = await this.get(id);
        if (record) records.push(record);
      }
      return records;
    },

    /**
     * Append one event to a record's history and persist atomically.
     * Never rewrites past events; updated_at moves to the event time.
     */
    async appendEvent(id, event) {
      const record = await this.get(id);
      if (!record) throw new Error(`No decision record ${id} in the ledger.`);
      const at = event.at ?? new Date().toISOString();
      record.events.push({
        type: event.type,
        at,
        actor: event.actor,
        revision: record.revision,
        ...(event.note ? { note: event.note } : {}),
      });
      record.updated_at = at;
      validateRecord(record);
      await writeAtomic(fileFor(id), record, { exclusive: false });
      return record;
    },

    /**
     * Persist a full updated record (used by the state-transition service in
     * later phases). The record must already exist and validate.
     */
    async save(record) {
      validateRecord(record);
      const existing = await this.get(record.id);
      if (!existing) throw new Error(`No decision record ${record.id} in the ledger — use create().`);
      await writeAtomic(fileFor(record.id), record, { exclusive: false });
      return record;
    },
  };
}
