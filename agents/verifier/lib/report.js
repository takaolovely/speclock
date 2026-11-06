/**
 * Canonical report + hash.
 *
 * The contract only stores a 32-byte hash. If two people canonicalise
 * differently, the hash proves nothing, so the rule is one function used by the
 * UI, the agent and the README example: sort keys, no whitespace.
 */
const crypto = require("node:crypto");

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}

function canonicalJson(v) {
  return JSON.stringify(canonical(v));
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * The part worth hashing.
 *
 * A report contains timings, and timings differ on every run — hashing them
 * would mean the same page never produces the same hash twice, and "re-run it
 * and compare" would be a claim we cannot honour. So the on-chain hash covers
 * only what must be identical: which checklist was used and how each rule
 * resolved. The full report stays on disk for humans.
 */
function claimOf(report) {
  return {
    v: 1,
    invoice_id: report.invoice_id,
    target_url: report.target_url,
    checklist_hash: report.checklist_hash,
    overall: report.overall,
    rules: report.results.map((r) => ({ i: r.index, t: r.type, p: !!r.passed })),
  };
}

function claimHash(report) {
  return sha256Hex(canonicalJson(claimOf(report)));
}

module.exports = { canonical, canonicalJson, sha256Hex, claimOf, claimHash };
