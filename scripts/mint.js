/**
 * Mint an invoice and write the checklist file the verifier will hash.
 *
 *   node scripts/mint.js <invoice_id> <target_url> <near_amount> <preset>
 *
 * preset: "demo-checkout" (expects #checkout-button, will fail on a normal site)
 *         "demo-text"     (expects the page to contain a string — used for pass)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nearApi = require("near-api-js");

const RPC = process.env.NEAR_RPC || "https://test.rpc.fastnear.com";
const NETWORK = "testnet";
const FACTORY = "speclock.testnet";
const CLIENT = "client-speclock.testnet";
const FREELANCER = "freelancer-speclock.testnet";
const VERIFIER = "verifier.speclock.testnet";
const SPLIT = "tax-speclock.testnet";

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

function preset(name, url) {
  if (name === "demo-text") {
    return {
      version: 1,
      target_url: url,
      rules: [
        { type: "http_status", expected: 200 },
        { type: "console_errors", max: 2 },
        { type: "text_contains", text: "Northwind Coffee" },
        { type: "response_time_ms", max: 20000 },
      ],
    };
  }
  return {
    version: 1,
    target_url: url,
    rules: [
      { type: "http_status", expected: 200 },
      { type: "console_errors", max: 0 },
      { type: "dom_selector", selector: "#checkout-button", state: "visible" },
      { type: "response_time_ms", max: 20000 },
    ],
  };
}

(async () => {
  const [invoiceId, targetUrl, amountNear, presetName = "demo-checkout"] = process.argv.slice(2);
  if (!invoiceId || !targetUrl || !amountNear) {
    console.error("usage: node scripts/mint.js <invoice_id> <target_url> <near_amount> [preset]");
    process.exit(2);
  }

  const checklist = preset(presetName, targetUrl);
  const canonicalJson = JSON.stringify(canonical(checklist));
  const hash = sha256(canonicalJson);

  const dir = path.join(__dirname, "..", "agents", "verifier", "evidence", invoiceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "checklist.json"), JSON.stringify(checklist, null, 2) + "\n");
  console.log("checklist file :", path.join(dir, "checklist.json"));
  console.log("checklist hash :", hash);

  const amount = BigInt(Math.round(Number(amountNear) * 1e24)).toString();
  const deposit = BigInt(amount) + 2_100_000_000_000_000_000_000_000n;

  const creds = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".near-credentials", NETWORK, `${CLIENT}.json`), "utf8"),
  );
  const { keyStores, KeyPair, connect, transactions } = nearApi;
  const ks = new keyStores.InMemoryKeyStore();
  ks.setKey(NETWORK, CLIENT, KeyPair.fromString(creds.private_key));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore: ks });
  const client = await near.account(CLIENT);

  const res = await client.signAndSendTransaction({
    receiverId: FACTORY,
    actions: [
      transactions.functionCall(
        "create_invoice",
        Buffer.from(
          JSON.stringify({
            invoice_id: invoiceId,
            freelancer: FREELANCER,
            client: CLIENT,
            verifier: VERIFIER,
            split_wallet: SPLIT,
            amount,
            split_bps: Number(process.env.SPLIT_BPS || 1000),
            checklist_hash: hash,
            checklist_json: JSON.stringify(checklist),
            target_url: targetUrl,
            deadline_ms: Date.now() + 7 * 24 * 3600 * 1000,
          }),
        ),
        200_000_000_000_000n,
        deposit,
      ),
    ],
  });
  console.log("mint tx        :", res.transaction_outcome.id);
  for (const r of res.receipts_outcome ?? []) for (const l of r.outcome.logs ?? []) console.log("  log:", l);
})();
