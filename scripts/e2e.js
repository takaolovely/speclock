/**
 * SpecLock end-to-end on NEAR testnet.
 *
 * client funds → factory mints a keyless invoice account → verifier attests a
 * pass → 10% split + permanent receipt → account deletes itself, rest sweeps to
 * the freelancer.
 *
 * Run: node scripts/e2e.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const nearApi = require("near-api-js");

const NETWORK = "testnet";
const RPC = "https://rpc.testnet.near.org";
const FACTORY = "speclock.testnet";
const CLIENT = "client-speclock.testnet";
const FREELANCER = "freelancer-speclock.testnet";
const VERIFIER = "verifier.speclock.testnet";
const SPLIT = "tax-speclock.testnet";
const INVOICE_ID = "inv-0042";

const near = (yocto) => Number(yocto) / 1e24;

function creds(account) {
  const p = path.join(os.homedir(), ".near-credentials", NETWORK, `${account}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Same canonicalisation the UI and the verifier must use. */
function canonicalChecklist(checklist) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = stable(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(stable(checklist));
}

function checklistHash(checklist) {
  const canonical = canonicalChecklist(checklist);
  return {
    canonical,
    hash: crypto.createHash("sha256").update(canonical).digest("hex"),
  };
}

async function account(name) {
  const { keyStores, KeyPair, connect } = nearApi;
  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey(NETWORK, name, KeyPair.fromString(creds(name).private_key));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  return near.account(name);
}

function logsOf(res) {
  const out = [];
  for (const r of res.receipts_outcome ?? []) {
    for (const l of r.outcome.logs ?? []) out.push(l);
    const s = JSON.stringify(r.outcome.status ?? {});
    if (s.includes("Failure")) out.push(`FAILURE ${s.slice(0, 300)}`);
  }
  return out;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function view(method, args, accountId = FACTORY) {
  const provider = new nearApi.providers.JsonRpcProvider({ url: RPC });
  const r = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
}

async function main() {
  const provider = new nearApi.providers.JsonRpcProvider({ url: RPC });
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
  const { canonical, hash } = checklistHash(checklist);
  console.log("checklist canonical:", canonical);
  console.log("checklist hash     :", hash);

  const bal = async (id) => near((await provider.query({ request_type: "view_account", finality: "final", account_id: id })).amount);
  const before = {
    client: await bal(CLIENT),
    freelancer: await bal(FREELANCER),
    split: await bal(SPLIT),
  };
  console.log("before:", before);

  /* 1 — client mints the invoice ------------------------------------- */
  const client = await account(CLIENT);
  const amount = "1000000000000000000000000"; // 1 NEAR
  const ACCOUNTING = 1_400_000_000_000_000_000_000_000n; // storage buffer
  const deposit = BigInt(amount) + ACCOUNTING;

  const { transactions } = nearApi;
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
  console.log("mint tx:", mint.transaction_outcome.id);
  console.log("  logs:", logsOf(mint));
  await wait(4000);

  const invoice = await provider.query({ request_type: "view_account", finality: "final", account_id: invoiceAccount });
  const keys = await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: invoiceAccount });
  console.log("invoice balance:", near(invoice.amount), "NEAR");
  console.log("invoice keys   :", keys.keys.length);

  /* 2 — verifier attests a pass -------------------------------------- */
  const verifier = await account(VERIFIER);
  const evidence = "b1946ac92492d2347c6235b4d2611184"; // placeholder for the real report hash
  const attest = await verifier.signAndSendTransaction({
    receiverId: invoiceAccount,
    actions: [
      transactions.functionCall(
        "attest",
        Buffer.from(JSON.stringify({ evidence_hash: evidence, verdict: "pass" })),
        150_000_000_000_000n,
        0n,
      ),
    ],
  });
  console.log("attest tx:", attest.transaction_outcome.id);
  console.log("  logs:", logsOf(attest));

  await wait(8000);

  /* 3 — what actually happened --------------------------------------- */
  let gone = false;
  try {
    await provider.query({ request_type: "view_account", finality: "final", account_id: invoiceAccount });
  } catch (e) {
    gone = /does not exist|UNKNOWN_ACCOUNT/i.test(JSON.stringify(e));
  }
  const after = {
    client: await bal(CLIENT),
    freelancer: await bal(FREELANCER),
    split: await bal(SPLIT),
  };
  const receipt = await view("get_receipt", { invoice_id: INVOICE_ID });
  const count = await view("receipt_count", {});

  console.log("---------------------------------------------");
  console.log("invoice account gone:", gone);
  console.log("client   delta:", (after.client - before.client).toFixed(6));
  console.log("split    delta:", (after.split - before.split).toFixed(6));
  console.log("freelancer delta:", (after.freelancer - before.freelancer).toFixed(6));
  console.log("receipt count:", count);
  console.log("receipt:", JSON.stringify(receipt));
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
