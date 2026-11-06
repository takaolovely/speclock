import { NextResponse, connection } from "next/server";
import { FACTORY, RPC, view } from "@/lib/near";

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
    const [meta, status, evidence, checklistRaw, inspection] = await Promise.all([
      view<string[]>(account, "meta"),
      view<string>(account, "status"),
      view<string[]>(account, "evidence"),
      view<string>(account, "checklist"),
      view<boolean>(account, "inspection"),
    ]);
    const [freelancer, client, verifier, amountYocto, checklistHash, targetUrl, deadlineMs] = meta;
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
      checklist: checklistRaw ? JSON.parse(checklistRaw) : null,
    };
  } catch {
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

export async function GET() {
  await connection();
  try {
    const ids = await view<string[]>(FACTORY, "list_invoices");
    const rows = await Promise.all(ids.map((id) => resolveInvoice(id)));
    return NextResponse.json({
      factory: FACTORY,
      rpc: RPC,
      invoices: rows.filter((r) => r.state !== "missing").reverse(),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
