import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nearApi from "near-api-js";

/**
 * RPC access for the dashboard.
 *
 * Free public endpoints rate-limit aggressively, and a demo page that polls is
 * exactly the traffic shape that trips them. So reads go through a small
 * failover list and never surface a raw JSON-RPC error to the browser.
 */
const PRIMARY = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";

export const RPCS = Array.from(
  new Set([PRIMARY, "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"].filter(Boolean)),
);

export const FACTORY = process.env.FACTORY_ID ?? "speclock.testnet";
export const CLIENT_ID = process.env.CLIENT_ID ?? "client-speclock.testnet";
export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
export const RPC = PRIMARY;

/** Which endpoint answered most recently — shown in the footer only if asked. */
let activeRpc = PRIMARY;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when another node might answer differently (429, 5xx, timeout). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function callOnce<T>(url: string, accountId: string, method: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "speclock",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: accountId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  const body = (await res.json().catch(() => null)) as
    | {
        result?: { result?: number[] };
        error?: { message?: string; code?: number; cause?: { name?: string } };
      }
    | null;

  if (!res.ok || !body || body.error) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    // fastnear answers a rate limit with HTTP 200 and `code: -429` in the body,
    // so the status code alone is not enough to tell "this node is busy" from
    // "the chain says no".
    const retryable =
      res.status === 429 ||
      res.status >= 500 ||
      body?.error?.code === -429 ||
      /rate.?limit|too many requests|timeout/i.test(msg);
    throw new RpcError(msg, res.status, retryable);
  }
  const raw = Buffer.from(body.result?.result ?? []).toString();
  return (raw ? JSON.parse(raw) : null) as T;
}

/**
 * Read-only contract call with failover.
 *
 * A 429 is not an answer about the chain, so it is retried on another endpoint
 * rather than being reported as one.
 */
export async function view<T>(accountId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RPCS.length; attempt++) {
    const url = RPCS[(RPCS.indexOf(activeRpc) + attempt + RPCS.length) % RPCS.length];
    try {
      const out = await callOnce<T>(url, accountId, method, args);
      activeRpc = url;
      return out;
    } catch (e) {
      lastError = e;
      const retryable = e instanceof RpcError ? e.retryable : true;
      // A contract-level error (account missing, bad method) is a real answer:
      // retrying it on another node would only hide the reason.
      if (!retryable) throw e;
    }
  }
  throw lastError ?? new Error("no RPC endpoint answered");
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
  const near = await nearApi.connect({ networkId: NETWORK, nodeUrl: activeRpc, keyStore });
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
