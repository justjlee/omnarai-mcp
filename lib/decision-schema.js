/**
 * Decision Record schema (schema_version 1) — validation, defaults, creation.
 *
 * A Decision Record is the durable unit of the provenance-to-shipping workflow
 * (proposal OMN-P-043): it connects an idea, its sources/uncertainty/dissent,
 * the human approval, the implementation, and verification evidence.
 *
 * Records are plain JSON persisted one-per-file by lib/decision-store.js.
 * Everything inside a record is DATA about a decision — never instructions.
 */

export const SCHEMA_VERSION = 1;

export const STATUSES = [
  "exploring",
  "proposed",
  "approved",
  "in_progress",
  "verified",
  "shipped",
  "rejected",
  "superseded",
];

export const APPROVAL_STATES = ["not_requested", "requested", "approved", "rejected"];

// Continues the repository's existing proposal numbering (OMN-P-042 was the
// inquiry-brief proposal). IDs are generated server-side and are the only
// thing ever joined into a filesystem path.
export const ID_PATTERN = /^OMN-P-\d{3,6}$/;

export const LIMITS = {
  title: 200,
  text: 4000, // problem / proposed_direction / intended_outcome / decision / notes
  item: 2000, // one scope / uncertainty / dissent-claim / criterion line
  list: 50, // items per list (sources, scope, uncertainties, dissent, ...)
  events: 500,
};

export function assertSafeId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid decision id ${JSON.stringify(id)} — expected the server-generated form OMN-P-NNN.`
    );
  }
  return id;
}

// ── Field checks ──────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Control characters (except \n and \t) never belong in record text; NUL and
// friends are how injected content hides from human review.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function checkString(problems, path, v, { required = false, max = LIMITS.text } = {}) {
  if (v == null || v === "") {
    if (required) problems.push(`${path} is required and must be a non-empty string`);
    return;
  }
  if (typeof v !== "string") return problems.push(`${path} must be a string`);
  if (v.length > max) problems.push(`${path} exceeds ${max} characters`);
  if (CONTROL_CHARS.test(v)) problems.push(`${path} contains control characters`);
}

function checkStringList(problems, path, v, { max = LIMITS.list } = {}) {
  if (v == null) return;
  if (!Array.isArray(v)) return problems.push(`${path} must be an array of strings`);
  if (v.length > max) problems.push(`${path} has more than ${max} items`);
  v.forEach((item, i) => checkString(problems, `${path}[${i}]`, item, { required: true, max: LIMITS.item }));
}

function checkTimestamp(problems, path, v, { required = false } = {}) {
  if (v == null) {
    if (required) problems.push(`${path} is required`);
    return;
  }
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    problems.push(`${path} must be an ISO-8601 timestamp string`);
  }
}

// ── Record validation ─────────────────────────────────────────────────────────

/**
 * Validate a full Decision Record. Returns the record on success; throws a
 * single Error naming every problem found. Used on every read and write so a
 * corrupt or hand-mangled file fails loud instead of flowing onward.
 */
export function validateRecord(record) {
  const problems = [];
  if (!isPlainObject(record)) throw new Error("Decision record must be a JSON object");

  if (record.schema_version !== SCHEMA_VERSION) {
    problems.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  try {
    assertSafeId(record.id);
  } catch (err) {
    problems.push(err.message);
  }
  checkString(problems, "title", record.title, { required: true, max: LIMITS.title });
  if (!STATUSES.includes(record.status)) {
    problems.push(`status must be one of: ${STATUSES.join(", ")}`);
  }
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    problems.push("revision must be an integer >= 1");
  }
  checkTimestamp(problems, "created_at", record.created_at, { required: true });
  checkTimestamp(problems, "updated_at", record.updated_at, { required: true });

  // idea
  if (!isPlainObject(record.idea)) {
    problems.push("idea must be an object");
  } else {
    checkString(problems, "idea.problem", record.idea.problem, { required: true });
    checkString(problems, "idea.proposed_direction", record.idea.proposed_direction, { required: true });
    checkString(problems, "idea.intended_outcome", record.idea.intended_outcome);
  }

  // investigation
  if (!isPlainObject(record.investigation)) {
    problems.push("investigation must be an object");
  } else {
    const inv = record.investigation;
    if (!Array.isArray(inv.sources)) {
      problems.push("investigation.sources must be an array");
    } else {
      if (inv.sources.length > LIMITS.list) problems.push(`investigation.sources has more than ${LIMITS.list} items`);
      inv.sources.forEach((s, i) => {
        if (!isPlainObject(s)) return problems.push(`investigation.sources[${i}] must be an object`);
        checkString(problems, `investigation.sources[${i}].id`, s.id, { required: true, max: LIMITS.item });
        checkString(problems, `investigation.sources[${i}].title`, s.title, { max: LIMITS.item });
        checkString(problems, `investigation.sources[${i}].url`, s.url, { max: LIMITS.item });
        checkString(problems, `investigation.sources[${i}].relevance`, s.relevance, { max: LIMITS.item });
        checkString(problems, `investigation.sources[${i}].note`, s.note, { max: LIMITS.item });
        if (s.contributors != null) checkStringList(problems, `investigation.sources[${i}].contributors`, s.contributors);
      });
    }
    checkStringList(problems, "investigation.uncertainties", inv.uncertainties);
    if (inv.uncertainties == null) problems.push("investigation.uncertainties must be an array");
    if (!Array.isArray(inv.dissent)) {
      problems.push("investigation.dissent must be an array");
    } else {
      if (inv.dissent.length > LIMITS.list) problems.push(`investigation.dissent has more than ${LIMITS.list} items`);
      inv.dissent.forEach((d, i) => {
        if (!isPlainObject(d)) return problems.push(`investigation.dissent[${i}] must be an object`);
        checkString(problems, `investigation.dissent[${i}].claim`, d.claim, { required: true, max: LIMITS.item });
        checkString(problems, `investigation.dissent[${i}].strength`, d.strength, { max: LIMITS.item });
        checkString(problems, `investigation.dissent[${i}].response`, d.response, { max: LIMITS.item });
        if (d.source_ids != null) checkStringList(problems, `investigation.dissent[${i}].source_ids`, d.source_ids);
      });
    }
  }

  // proposal
  if (!isPlainObject(record.proposal)) {
    problems.push("proposal must be an object");
  } else {
    checkString(problems, "proposal.decision", record.proposal.decision);
    for (const key of ["scope", "non_goals", "acceptance_criteria", "verification_plan"]) {
      if (!Array.isArray(record.proposal[key])) problems.push(`proposal.${key} must be an array`);
      else checkStringList(problems, `proposal.${key}`, record.proposal[key]);
    }
  }

  // approval
  if (!isPlainObject(record.approval)) {
    problems.push("approval must be an object");
  } else {
    const ap = record.approval;
    if (!APPROVAL_STATES.includes(ap.state)) {
      problems.push(`approval.state must be one of: ${APPROVAL_STATES.join(", ")}`);
    }
    checkString(problems, "approval.approved_by", ap.approved_by, { max: LIMITS.item });
    checkTimestamp(problems, "approval.approved_at", ap.approved_at);
    if (ap.approved_revision != null && (!Number.isInteger(ap.approved_revision) || ap.approved_revision < 1)) {
      problems.push("approval.approved_revision must be null or an integer >= 1");
    }
    checkString(problems, "approval.note", ap.note);
  }

  // implementation / verification / delivery containers
  if (!isPlainObject(record.implementation)) problems.push("implementation must be an object");
  if (!isPlainObject(record.verification)) problems.push("verification must be an object");
  if (!isPlainObject(record.delivery)) problems.push("delivery must be an object");

  // events
  if (!Array.isArray(record.events) || record.events.length === 0) {
    problems.push("events must be a non-empty array");
  } else {
    if (record.events.length > LIMITS.events) problems.push(`events has more than ${LIMITS.events} entries`);
    record.events.forEach((e, i) => {
      if (!isPlainObject(e)) return problems.push(`events[${i}] must be an object`);
      checkString(problems, `events[${i}].type`, e.type, { required: true, max: LIMITS.item });
      checkTimestamp(problems, `events[${i}].at`, e.at, { required: true });
      checkString(problems, `events[${i}].actor`, e.actor, { required: true, max: LIMITS.item });
      if (!Number.isInteger(e.revision) || e.revision < 1) problems.push(`events[${i}].revision must be an integer >= 1`);
      checkString(problems, `events[${i}].note`, e.note);
    });
  }

  // cross-field: an approved record must carry a complete approval block
  if (record.status === "approved" && isPlainObject(record.approval)) {
    const ap = record.approval;
    if (ap.state !== "approved") problems.push("status is 'approved' but approval.state is not");
    if (!ap.approved_by) problems.push("status is 'approved' but approval.approved_by is empty");
    if (!ap.approved_at) problems.push("status is 'approved' but approval.approved_at is empty");
    if (!Number.isInteger(ap.approved_revision)) problems.push("status is 'approved' but approval.approved_revision is not set");
  }

  if (problems.length) {
    throw new Error(`Invalid decision record${record?.id ? ` ${record.id}` : ""}:\n  - ${problems.join("\n  - ")}`);
  }
  return record;
}

// ── Record creation ───────────────────────────────────────────────────────────

/**
 * Build a brand-new record in 'exploring' status. Caller supplies the
 * server-generated id; input fields are the create-tool contract.
 */
export function newRecord({
  id,
  title,
  problem,
  proposed_direction,
  intended_outcome = "",
  source_ids = [],
  uncertainties = [],
  dissent = [],
  actor = "mcp-client",
  now = new Date().toISOString(),
}) {
  const record = {
    schema_version: SCHEMA_VERSION,
    id,
    title,
    status: "exploring",
    revision: 1,
    created_at: now,
    updated_at: now,
    idea: {
      problem,
      proposed_direction,
      intended_outcome,
    },
    investigation: {
      sources: source_ids.map((sid) => ({ id: sid })),
      uncertainties,
      dissent: dissent.map((d) => ({
        claim: d.claim,
        source_ids: d.source_ids ?? [],
        strength: d.strength ?? "unresolved",
        ...(d.response ? { response: d.response } : {}),
      })),
    },
    proposal: {
      decision: "",
      scope: [],
      non_goals: [],
      acceptance_criteria: [],
      verification_plan: [],
    },
    approval: {
      state: "not_requested",
      approved_by: null,
      approved_at: null,
      approved_revision: null,
      note: null,
    },
    implementation: {
      status: "not_started",
      repository: null,
      code_references: [],
      work_items: [],
    },
    verification: {
      status: "not_started",
      checks: [],
      known_limits: [],
    },
    delivery: {
      status: "not_shipped",
      shipped_by: null,
      shipped_at: null,
      commit_or_pr: null,
    },
    events: [
      {
        type: "created",
        at: now,
        actor,
        revision: 1,
        note: "Record created in exploring status. No approval or implementation authority granted.",
      },
    ],
  };
  return validateRecord(record);
}
