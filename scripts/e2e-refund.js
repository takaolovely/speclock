/** Fail path + refund after deadline. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const nearApi = require("near-api-js");

const RPC = "https://test.rpc.fastnear.com";
const NETWORK = "testnet", FACTORY = "speclock.testnet";
const CLIENT = "client-speclock.testnet", FREELANCER = "freelancer-speclock.testnet";
const VERIFIER = "verifier.speclock.testnet", SPLIT = "tax-speclock.testnet";
const ID = "inv-0045";
const near = (y) => Number(y) / 1e24;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const p = () => new nearApi.providers.JsonRpcProvider({ url: RPC });

async function acct(name) {
  const { keyStores, KeyPair, connect } = nearApi;
  const ks = new keyStores.InMemoryKeyStore();
  const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", NETWORK, name + ".json"), "utf8"));
  ks.setKey(NETWORK, name, KeyPair.fromString(c.private_key));
  return (await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore: ks })).account(name);
}
async function view(m, a, acct = FACTORY) {
  const r = await p().query({ request_type: "call_function", finality: "final", account_id: acct, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
}
const bal = async (id) => near((await p().query({ request_type: "view_account", finality: "final", account_id: id })).amount);
const exists = async (id) => { try { await p().query({ request_type: "view_account", finality: "final", account_id: id }); return true; } catch { return false; } };

(async () => {
  const { transactions } = nearApi;
  const inv = `${ID}.${FACTORY}`;
  const c0 = await bal(CLIENT);
  const client = await acct(CLIENT);

  const mint = await client.signAndSendTransaction({
    receiverId: FACTORY,
    actions: [transactions.functionCall("create_invoice", Buffer.from(JSON.stringify({
      invoice_id: ID, freelancer: FREELANCER, client: CLIENT, verifier: VERIFIER, split_wallet: SPLIT,
      amount: "1000000000000000000000000", checklist_hash: "f".repeat(64),
      target_url: "https://broken.example.com", deadline_ms: Date.now() + 75_000,
    })), 200_000_000_000_000n, 2_400_000_000_000_000_000_000_000n)],
  });
  console.log("mint:", mint.transaction_outcome.id);
  await wait(5000);
  console.log("invoice keys:", (await p().query({ request_type: "view_access_key_list", finality: "final", account_id: inv })).keys.length);

  const v = await acct(VERIFIER);
  const at = await v.signAndSendTransaction({
    receiverId: inv,
    actions: [transactions.functionCall("attest", Buffer.from(JSON.stringify({ evidence_hash: "deadbeef", verdict: "fail" })), 150_000_000_000_000n, 0n)],
  });
  console.log("attest fail:", at.transaction_outcome.id);
  await wait(4000);
  console.log("status:", JSON.stringify(await view("status", {}, inv)), "| evidence:", JSON.stringify(await view("evidence", {}, inv)));

  const cMid = await bal(CLIENT);
  console.log("client balance held:", cMid.toFixed(4));

  console.log("waiting for deadline…");
  await wait(80_000);

  const rf = await client.signAndSendTransaction({
    receiverId: inv,
    actions: [transactions.functionCall("refund", Buffer.from("{}"), 100_000_000_000_000n, 0n)],
  });
  const logs = [];
  for (const r of rf.receipts_outcome ?? []) logs.push(...(r.outcome.logs ?? []));
  console.log("refund:", rf.transaction_outcome.id, logs);

  await wait(7000);
  const c1 = await bal(CLIENT);
  console.log("invoice gone:", !(await exists(inv)));
  console.log("client refunded:", (c1 - c0 + 2.4).toFixed(4), "NEAR of 2.4 deposit (delta from start incl gas:", (c1 - c0).toFixed(4), ")");
})();
