/**
 * SpecLock end-to-end, both verdicts.
 *
 *   fail  → nothing moves, invoice stays Funded, verifier can retry
 *   pass  → split + permanent receipt + self-destruct
 *
 * Run: node scripts/e2e2.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const nearApi = require("near-api-js");

const NETWORK = "testnet";
const RPC = "https://test.rpc.fastnear.com";
const FACTORY = "speclock.testnet";
const CLIENT = "client-speclock.testnet";
const FREELANCER = "freelancer-speclock.testnet";
const VERIFIER = "verifier.speclock.testnet";
const SPLIT = "tax-speclock.testnet";
const INVOICE_ID = process.env.INVOICE_ID || "inv-0043";

const near = (y) => Number(y) / 1e24;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function creds(account) {
  return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", NETWORK, `${account}.json`), "utf8"));
}
async function account(name) {
  const { keyStores, KeyPair, connect } = nearApi;
  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey(NETWORK, name, KeyPair.fromString(creds(name).private_key));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  return near.account(name);
}
const provider = () => new nearApi.providers.JsonRpcProvider({ url: RPC });
async function view(method, args, accountId = FACTORY) {
  const r = await provider().query({
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
}
async function bal(id) {
  return near((await provider().query({ request_type: "view_account", finality: "final", account_id: id })).amount);
}
async function exists(id) {
  try {
    await provider().query({ request_type: "view_account", finality: "final", account_id: id });
    return true;
  } catch {
    return false;
  }
}
async function waitGone(id, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await exists(id))) return true;
    await wait(1000);
  }
  return false;
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}

async function attest(verifierAccount, invoiceAccount, hash, verdict) {
  const { transactions } = nearApi;
  const verifier = await account(VERIFIER);
  const res = await verifier.signAndSendTransaction({
    receiverId: invoiceAccount,
    actions: [
      transactions.functionCall(
        "attest",
        Buffer.from(JSON.stringify({ evidence_hash: hash, verdict })),
        150_000_000_000_000n,
        0n,
      ),
    ],
  });
  const logs = [];
  for (const r of res.receipts_outcome ?? []) logs.push(...(r.outcome.logs ?? []));
  return { id: res.transaction_outcome.id, logs };
}

async function main() {
  const invoiceAccount = `${INVOICE_ID}.${FACTORY}`;
  const checklist = {
    version: 1,
    target_url: "https://staging.example.com",
    rules: [
      { type: "http_status", expected: 200 },
      { type: "console_errors", max: 0 },
      { type: "dom_selector", selector: "#checkout-button", state: "visible" },
      { type: "response_time_ms", max: 2000 },
    ],
  };
  const canonicalJson = JSON.stringify(canonical(checklist));
  const hash = crypto.createHash("sha256").update(canonicalJson).digest("hex");
  console.log("checklist hash:", hash);

  const before = await Promise.all([bal(CLIENT), bal(FREELANCER), bal(SPLIT)]);
  console.log("before client/freelancer/split:", before.map((x) => x.toFixed(4)).join(" / "));

  /* mint */
  const { transactions } = nearApi;
  const client = await account(CLIENT);
  const amount = "1000000000000000000000000";
  const deposit = BigInt(amount) + 1_400_000_000_000_000_000_000_000n;
  const mint = await client.signAndSendTransaction({
    receiverId: FACTORY,
    actions: [
      transactions.functionCall(
        "create_invoice",
        Buffer.from(
          JSON.stringify({
            invoice_id: INVOICE_ID,
            freelancer: FREELANCER,
            client: CLIENT,
            verifier: VERIFIER,
            split_wallet: SPLIT,
            amount,
            checklist_hash: hash,
            target_url: checklist.target_url,
            deadline_ms: Date.now() + 7 * 24 * 3600 * 1000,
          }),
        ),
        200_000_000_000_000n,
        deposit,
      ),
    ],
  });
  console.log("mint:", mint.transaction_outcome.id);
  await wait(5000);

  const keys = await provider().query({ request_type: "view_access_key_list", finality: "final", account_id: invoiceAccount });
  console.log("invoice keys:", keys.keys.length, "| balance:", (await bal(invoiceAccount)).toFixed(4));

  /* fail 1 — broken staging */
  const f1 = await attest(VERIFIER, invoiceAccount, "aaaa1111broken-checkout", "fail");
  console.log("attest#1 (fail):", f1.id, f1.logs.filter((l) => l.startsWith("ATTEST")));
  await wait(4000);
  const s1 = await view("status", {}, invoiceAccount);
  const mid = await Promise.all([bal(FREELANCER), bal(SPLIT)]);
  console.log("status after fail:", s1, "| freelancer/split:", mid.map((x) => x.toFixed(4)).join(" / "));

  /* pass — fixed */
  const p1 = await attest(VERIFIER, invoiceAccount, "bbbb2222passing-run", "pass");
  console.log("attest#2 (pass):", p1.id, p1.logs);

  const gone = await waitGone(invoiceAccount);
  const after = await Promise.all([bal(CLIENT), bal(FREELANCER), bal(SPLIT)]);
  const receipt = await view("get_receipt", { invoice_id: INVOICE_ID });

  console.log("---------------------------------------------");
  console.log("invoice account deleted:", gone);
  console.log("client delta   :", (after[0] - before[0]).toFixed(6));
  console.log("freelancer delta:", (after[1] - before[1]).toFixed(6));
  console.log("split delta    :", (after[2] - before[2]).toFixed(6));
  console.log("receipt:", JSON.stringify(receipt));
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
