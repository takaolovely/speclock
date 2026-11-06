import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nearApi from "near-api-js";

export const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
export const FACTORY = process.env.FACTORY_ID ?? "speclock.testnet";
export const CLIENT_ID = process.env.CLIENT_ID ?? "client-speclock.testnet";
export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";

const provider = new nearApi.providers.JsonRpcProvider({ url: RPC });

/** Read-only contract call. */
export async function view<T>(accountId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  const raw = Buffer.from((r as unknown as { result: number[] }).result).toString();
  return raw ? (JSON.parse(raw) as T) : (null as T);
}

/**
 * The demo client's key.
 *
 * Testnet only, and only enough balance to mint a few invoices. A real product
 * would have the user sign with their own wallet; a judge should not have to
 * install one to try this.
 */
function clientKey(): string {
  const fromEnv = process.env.CLIENT_PRIVATE_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const p = path.join(os.homedir(), ".near-credentials", NETWORK, `${CLIENT_ID}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8")).private_key as string;
}

export async function clientAccount() {
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  keyStore.setKey(NETWORK, CLIENT_ID, nearApi.KeyPair.fromString(clientKey() as never));
  const near = await nearApi.connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  return near.account(CLIENT_ID);
}

/** Same canonical form the verifier and the contract hash use. */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function checklistHash(checklist: unknown): string {
  return require("node:crypto").createHash("sha256").update(JSON.stringify(canonical(checklist))).digest("hex");
}

export function yocto(near: number): bigint {
  return BigInt(Math.round(near * 1e24));
}

export const STORAGE_BUFFER = 2_100_000_000_000_000_000_000_000n; // 2.1 NEAR, refunded on delete
