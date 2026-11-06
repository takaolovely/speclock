/**
 * Mint a short-deadline invoice and refund it, so the landing page can link a
 * real refund transaction instead of naming one that has no hash.
 *
 *   node /tmp/refund_demo.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nearApi = require("/home/ubuntu/speclock/node_modules/near-api-js");

const RPC = "https://test.rpc.fastnear.com";
const NETWORK = "testnet";
const FACTORY = "speclock.testnet";
const CLIENT = "client-speclock.testnet";
const INVOICE_ID = process.argv[2] || "inv-0063";
const TARGET = "https://speclock-nine.vercel.app/demo-target";
const AMOUNT = 100_000_000_000_000_000_000_000n; // 0.1 NEAR

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}
const sha256 = (s) => require("node:crypto").createHash("sha256").update(s).digest("hex");

const checklist = {
  version: 1,
  target_url: TARGET,
  rules: [
    { type: "http_status", expected: 200 },
    { type: "console_errors", max: 0 },
    { type: "dom_selector", selector: "#checkout-button", state: "visible" },
    { type: "response_time_ms", max: 2000 },
  ],
};
const hash = sha256(JSON.stringify(canonical(checklist)));

(async () => {
  const creds = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".near-credentials", NETWORK, `${CLIENT}.json`), "utf8"),
  );
  const { keyStores, KeyPair, connect, transactions } = nearApi;
  const ks = new keyStores.InMemoryKeyStore();
  ks.setKey(NETWORK, CLIENT, KeyPair.fromString(creds.private_key));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore: ks });
  const client = await near.account(CLIENT);

  const deadline = Date.now() + 75_000;
  const mint = await client.signAndSendTransaction({
    receiverId: FACTORY,
    actions: [
      transactions.functionCall(
        "create_invoice",
        Buffer.from(
          JSON.stringify({
            invoice_id: INVOICE_ID,
            freelancer: "freelancer-speclock.testnet",
            client: CLIENT,
            verifier: "verifier.speclock.testnet",
            split_wallet: "tax-speclock.testnet",
            amount: AMOUNT.toString(),
            split_bps: 1000,
            checklist_hash: hash,
            checklist_json: JSON.stringify(checklist),
            target_url: TARGET,
            deadline_ms: deadline,
          }),
        ),
        200_000_000_000_000n,
        AMOUNT + 2_100_000_000_000_000_000_000_000n,
      ),
    ],
  });
  console.log("MINT_TX", mint.transaction_outcome.id);
  console.log("DEADLINE", new Date(deadline).toISOString());

  const waitMs = Math.max(0, deadline - Date.now()) + 6_000;
  console.log(`waiting ${Math.round(waitMs / 1000)}s for the deadline`);
  await new Promise((r) => setTimeout(r, waitMs));

  const invoice = await near.account(`${INVOICE_ID}.speclock.testnet`);
  const refund = await invoice.signAndSendTransaction({
    receiverId: `${INVOICE_ID}.speclock.testnet`,
    actions: [transactions.functionCall("refund", Buffer.from("{}"), 100_000_000_000_000n)],
  });
  console.log("REFUND_TX", refund.transaction_outcome.id);
  for (const r of refund.receipts_outcome ?? [])
    for (const l of r.outcome.logs ?? []) console.log("  log:", l);
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
