import { NextResponse, connection } from "next/server";
import { FACTORY, RPC, RpcError, view } from "@/lib/near";

// Next 16 with cacheComponents: opt into per-request execution by awaiting
// connection(). Route segment config ("dynamic") is rejected in this mode.
export const maxDuration = 60;

/**
 * One call the UI can rely on: the factory's invoice list, each entry resolved
 * into a state the browser can render.
 *
 * The trap this exists to avoid: a settled invoice deletes its own account, so
 * `view_account` on it fails with UNKNOWN_ACCOUNT. That is not an error — it is
 * the success case. When the account is gone we fall back to the factory, which
 * kept the receipt and the per-rule summary before the account died.
 */
type Row = Record<string, unknown>;

async function resolveInvoice(id: string): Promise<Row> {
  const account = `${id}.${FACTORY}`;
  try {
    // Three reads, not five: `meta` already carries the inspection flag and
    // `evidence` already carries the per-rule summary. Public RPCs are rate
    // limited, and every dropped call is a judge who sees a 429 instead of the
    // product.
    const [meta, status, evidence] = await Promise.all([
      view<string[]>(account, "meta"),
      view<string>(account, "status"),
      view<string[]>(account, "evidence"),
    ]);
    const [freelancer, client, verifier, amountYocto, checklistHash, targetUrl, deadlineMs, inspection] = meta;
    return {
      id,
      account,
      state: "live",
      status: String(status).replace(/"/g, ""),
      freelancer,
      client,
      verifier,
      amountYocto,
      checklistHash,
      targetUrl,
      deadlineMs: Number(deadlineMs),
      inspectionRequested: Boolean(inspection),
      evidenceHash: evidence?.[0] ?? "",
      verdict: evidence?.[1] ?? "",
      rulesSummary: evidence?.[2] ?? "",
    };
  } catch (e) {
    // A busy node is not evidence that the account is gone. If the read failed
    // for a transient reason, let the caller serve its last good snapshot
    // instead of silently dropping a live invoice off the page.
    if (e instanceof RpcError && e.retryable) throw e;

    /* account is gone — either settled or never created */
    const [receipt, summary] = await Promise.all([
      view<Row | null>(FACTORY, "get_receipt", { invoice_id: id }),
      view<string | null>(FACTORY, "get_summary", { invoice_id: id }),
    ]);
    if (!receipt) return { id, account, state: "missing" };
    return {
      id,
      account,
      state: "settled",
      status: "SETTLED",
      amountYocto: receipt.amount,
      freelancer: receipt.freelancer,
      evidenceHash: receipt.evidence_hash,
      verdict: receipt.verdict,
      settledAtMs: Number(receipt.at_ms),
      rulesSummary: summary ?? "",
    };
  }
}

type Payload = {
  factory: string;
  rpc: string;
  invoices: Row[];
  readAtMs: number;
  stale?: boolean;
};

/**
 * Short-lived snapshot.
 *
 * The page polls, judges open it in several tabs, and free RPC endpoints count
 * every one of those reads. Serving a 12-second-old snapshot from the same
 * lambda keeps the chain as the source of truth without turning the demo into a
 * rate-limit test.
 */
const TTL_MS = 12_000;
let cache: { atMs: number; payload: Payload } | null = null;
let refreshing: Promise<Payload> | null = null;

async function readChain(): Promise<Payload> {
  const ids = await view<string[]>(FACTORY, "list_invoices");
  const rows = await Promise.all(ids.map((id) => resolveInvoice(id)));
  return {
    factory: FACTORY,
    rpc: RPC,
    invoices: rows.filter((r) => r.state !== "missing").reverse(),
    readAtMs: Date.now(),
  };
}

export async function GET() {
  await connection();

  if (cache && Date.now() - cache.atMs < TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    refreshing ??= readChain().finally(() => {
      refreshing = null;
    });
    const payload = await refreshing;
    cache = { atMs: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (e) {
    const message = String((e as Error).message ?? e);
    const rateLimited = /429|rate limit/i.test(message);

    // A stale snapshot beats an error screen: the numbers are seconds old and
    // still true. The flag lets the page say so instead of pretending.
    if (cache) {
      return NextResponse.json({
        ...cache.payload,
        stale: true,
        warning: rateLimited
          ? "Chain reads are rate limited right now — showing the last confirmed snapshot."
          : "Chain reads are failing — showing the last confirmed snapshot.",
      });
    }

    return NextResponse.json(
      {
        error: rateLimited
          ? "The public RPC is rate limiting reads. Retrying in a few seconds."
          : `Could not read the factory: ${message}`,
      },
      { status: 503 },
    );
  }
}
