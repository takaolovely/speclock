#!/usr/bin/env node
/**
 * SpecLock verifier — outbound only.
 *
 *   node index.js --invoice inv-0049 [--attest]     one invoice, ad hoc
 *   node index.js --poll [--interval 12] [--once]   watch the factory, forever
 *
 * Safety rails, enforced here rather than trusted to the caller:
 *   - no HTTP server, no inbound port, no webhook: this process only talks out
 *   - no LLM, no paid API: rules are measured in the browser, nothing inferred
 *   - one inspection at a time (lock file), hard 15s ceiling inside inspect()
 *   - invoice must belong to the demo freelancer, else refused
 *   - the checklist is read from the invoice account itself and must hash to
 *     checklist_hash committed there, so a swapped checklist cannot pass
 *   - target URL must clear the SSRF gate in lib/security.js
 */
const fs = require("node:fs");
const path = require("node:path");
const nearApi = require("near-api-js");

const { vetUrl } = require("./lib/security");
const { inspect, HARD_TIMEOUT_MS } = require("./lib/inspect");
const { canonicalJson, sha256Hex, claimOf, claimHash } = require("./lib/report");

const NETWORK = "testnet";
const RPC = process.env.NEAR_RPC || "https://test.rpc.fastnear.com";
const FACTORY = process.env.FACTORY_ID || "speclock.testnet";
const VERIFIER_ACCOUNT = process.env.VERIFIER_ID || "verifier.speclock.testnet";
const ALLOWED_FREELANCER = process.env.ALLOWED_FREELANCER || "freelancer-speclock.testnet";
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "vercel.app,speclock.xyz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const INTERVAL_S = Number(arg("interval", 12));

const LOCK = path.join(__dirname, ".verifier.lock");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? fallback : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const provider = new nearApi.providers.JsonRpcProvider({ url: RPC });

async function chainView(accountId, method, args = {}) {
  const r = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
}

async function verifierAccount() {
  const credsPath = path.join(process.env.HOME, ".near-credentials", NETWORK, `${VERIFIER_ACCOUNT}.json`);
  const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
  const { keyStores, KeyPair, connect } = nearApi;
  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey(NETWORK, VERIFIER_ACCOUNT, KeyPair.fromString(creds.private_key));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  return near.account(VERIFIER_ACCOUNT);
}

/** Inspect one invoice and (optionally) attest. Returns a small result object. */
async function inspectInvoice(invoiceId, { attest = true, account = null } = {}) {
  const invoiceAccount = `${invoiceId}.${FACTORY}`;

  const meta = await chainView(invoiceAccount, "meta");
  const [freelancer, , verifier, amount, checklistHash, targetUrl, deadlineMs] = meta;
  if (freelancer !== ALLOWED_FREELANCER) {
    log(`skip ${invoiceId}: freelancer ${freelancer} not allowed`);
    return { skipped: "freelancer" };
  }
  if (verifier !== VERIFIER_ACCOUNT) {
    log(`skip ${invoiceId}: verifier ${verifier} is not this worker`);
    return { skipped: "verifier" };
  }

  /* checklist comes from the invoice account, not from a local file */
  const checklistRaw = await chainView(invoiceAccount, "checklist");
  const checklist = JSON.parse(checklistRaw);
  const localHash = sha256Hex(canonicalJson(checklist));
  if (localHash !== checklistHash) {
    log(`refuse ${invoiceId}: checklist hash mismatch (onchain ${checklistHash}, read ${localHash})`);
    return { skipped: "hash" };
  }

  const vet = await vetUrl(targetUrl, { allowlist: ALLOWED_HOSTS });
  if (!vet.ok) {
    log(`refuse ${invoiceId}: ${vet.reason}`);
    return { skipped: "url" };
  }

  /* one report at a time */
  let lockFd;
  try {
    lockFd = fs.openSync(LOCK, "wx");
  } catch {
    log("another inspection holds the lock; will retry");
    return { skipped: "locked" };
  }

  const outDir = path.join(__dirname, "evidence", invoiceId);
  fs.mkdirSync(outDir, { recursive: true });
  let result;
  try {
    result = await inspect({
      url: targetUrl,
      rules: checklist.rules,
      screenshotPath: path.join(outDir, "screenshot.png"),
    });
  } finally {
    fs.closeSync(lockFd);
    try {
      fs.unlinkSync(LOCK);
    } catch {}
  }

  const report = {
    report_version: 1,
    invoice_id: invoiceId,
    invoice_account: invoiceAccount,
    target_url: targetUrl,
    checklist_hash: checklistHash,
    checked_at_ms: Date.now(),
    overall: result.overall,
    timed_out: result.timed_out,
    duration_ms: result.duration_ms,
    browser: result.browser,
    navigation: result.navigation,
    console_error_count: result.console_error_count,
    page_error_count: result.page_error_count,
    failed_request_count: result.failed_request_count,
    failed_requests: result.failed_requests,
    results: result.results,
  };

  /* The hash covers the stable claim, never the timings: two runs of the same
     page must agree or nobody can check our work. */
  const claim = claimOf(report);
  const evidenceHash = claimHash(report);

  fs.writeFileSync(path.join(outDir, "checklist.json"), checklistRaw + "\n");
  fs.writeFileSync(path.join(outDir, "report.json"), canonicalJson(report) + "\n");
  fs.writeFileSync(path.join(outDir, "report.hash"), evidenceHash + "\n");
  // No trailing newline: `sha256sum claim.json` must equal the hash stored on
  // chain, so a reviewer can check the attestation with one shell command.
  fs.writeFileSync(path.join(outDir, "claim.json"), canonicalJson(claim));
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      { invoice_id: invoiceId, evidence_hash: evidenceHash, verdict: result.overall, at_ms: report.checked_at_ms, screenshot: "screenshot.png" },
      null,
      2,
    ),
  );

  log(`${invoiceId} → ${result.overall.toUpperCase()} (${result.duration_ms}ms) ${evidenceHash.slice(0, 16)}…`);
  for (const r of result.results) log(`   ${r.passed ? "PASS" : "FAIL"} ${r.type} ${JSON.stringify(r.observed)}`);

  if (!attest) return { verdict: result.overall, evidenceHash, attested: false };

  // Compact, permanent per-rule result. The invoice account is deleted on
  // settlement, so the factory keeps this or the proof dies with the account.
  const summary = JSON.stringify({
    r: result.results.map((x) => ({ t: x.type, p: !!x.passed })),
  });

  const acct = account ?? (await verifierAccount());
  const tx = await acct.signAndSendTransaction({
    receiverId: invoiceAccount,
    actions: [
      nearApi.transactions.functionCall(
        "attest",
        Buffer.from(JSON.stringify({ evidence_hash: evidenceHash, verdict: result.overall, rules_summary: summary })),
        150_000_000_000_000n,
        0n,
      ),
    ],
  });
  log(`attest ${invoiceId}: ${tx.transaction_outcome.id}`);
  for (const r of tx.receipts_outcome ?? []) for (const l of r.outcome.logs ?? []) log("   log:", l);
  return { verdict: result.overall, evidenceHash, attested: true, tx: tx.transaction_outcome.id };
}

async function pollOnce(account) {
  const ids = await chainView(FACTORY, "list_invoices");
  if (!ids.length) {
    log("no invoices minted yet");
    return;
  }
  for (const id of ids) {
    const invoiceAccount = `${id}.${FACTORY}`;
    let status, requested;
    try {
      status = await chainView(invoiceAccount, "status");
      requested = await chainView(invoiceAccount, "inspection");
    } catch {
      continue; // settled invoices no longer exist
    }
    if (status !== "Funded" || !requested) continue;
    log(`picked up ${id} (Funded, inspection requested)`);
    try {
      await inspectInvoice(id, { attest: true, account });
    } catch (e) {
      log(`error on ${id}: ${String(e.message).slice(0, 200)}`);
    }
  }
}

async function main() {
  if (has("poll")) {
    const account = await verifierAccount();
    log(`polling ${FACTORY} every ${INTERVAL_S}s as ${VERIFIER_ACCOUNT} (no inbound port)`);
    do {
      try {
        await pollOnce(account);
      } catch (e) {
        log(`poll error: ${String(e.message).slice(0, 200)}`);
      }
      if (has("once")) break;
      await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
    } while (true);
    return;
  }

  const invoiceId = arg("invoice");
  if (!invoiceId) {
    console.error("usage: node index.js --invoice <id> [--attest] | --poll [--once] [--interval N]");
    process.exit(2);
  }
  await inspectInvoice(invoiceId, { attest: has("attest") });
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
