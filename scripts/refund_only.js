const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nearApi = require("/home/ubuntu/speclock/node_modules/near-api-js");

const RPC = "https://test.rpc.fastnear.com";
const CLIENT = "client-speclock.testnet";
const ID = process.argv[2] || "inv-0063";

(async () => {
  const creds = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".near-credentials", "testnet", `${CLIENT}.json`), "utf8"),
  );
  const { keyStores, KeyPair, connect, transactions } = nearApi;
  const ks = new keyStores.InMemoryKeyStore();
  ks.setKey("testnet", CLIENT, KeyPair.fromString(creds.private_key));
  const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: ks });
  const client = await near.account(CLIENT);
  const res = await client.signAndSendTransaction({
    receiverId: `${ID}.speclock.testnet`,
    actions: [transactions.functionCall("refund", Buffer.from("{}"), 100_000_000_000_000n)],
  });
  console.log("REFUND_TX", res.transaction_outcome.id);
  for (const r of res.receipts_outcome ?? []) for (const l of r.outcome.logs ?? []) console.log("  log:", l);
  setTimeout(() => process.exit(0), 12000);
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
