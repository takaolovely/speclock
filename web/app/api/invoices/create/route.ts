import { NextResponse } from "next/server";
import * as nearApi from "near-api-js";
import { CLIENT_ID, FACTORY, yocto, STORAGE_BUFFER, clientAccount, checklistHash } from "@/lib/near";

export const maxDuration = 60;

/**
 * Mint an invoice.
 *
 * The client is a testnet key held server-side so a judge can try the product
 * without installing a wallet. Everything else is real: a sub-account is
 * created with no keys, the checklist is committed by hash, and the money is
 * locked in the invoice account.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      targetUrl?: string;
      amountNear?: number;
      splitBps?: number;
      selector?: string;
      maxConsoleErrors?: number;
      maxResponseMs?: number;
      textContains?: string;
    };

    const targetUrl = String(body.targetUrl ?? "").trim();
    const u = new URL(targetUrl);
    if (u.protocol !== "https:") {
      return NextResponse.json({ error: "target must be https" }, { status: 400 });
    }

    const amountNear = Number(body.amountNear ?? 1);
    if (!(amountNear > 0 && amountNear <= 50)) {
      return NextResponse.json({ error: "amount must be between 0 and 50 NEAR" }, { status: 400 });
    }

    const allowedSplit = [0, 500, 1000, 2000];
    const splitBps = allowedSplit.includes(Number(body.splitBps)) ? Number(body.splitBps) : 1000;

    const rules: Record<string, unknown>[] = [
      { type: "http_status", expected: 200 },
      { type: "console_errors", max: Math.max(0, Number(body.maxConsoleErrors ?? 0)) },
    ];
    if (body.selector && String(body.selector).trim()) {
      rules.push({ type: "dom_selector", selector: String(body.selector).trim(), state: "visible" });
    }
    if (body.textContains && String(body.textContains).trim()) {
      rules.push({ type: "text_contains", text: String(body.textContains).trim() });
    }
    rules.push({ type: "response_time_ms", max: Math.max(500, Number(body.maxResponseMs ?? 2000)) });

    const checklist = { version: 1, target_url: targetUrl, rules };
    const hash = checklistHash(checklist);

    const id = `inv-${Date.now().toString(36)}`;
    const amount = yocto(amountNear);
    const deposit = amount + STORAGE_BUFFER;

    const account = await clientAccount();
    const res = await account.signAndSendTransaction({
      receiverId: FACTORY,
      actions: [
        nearApi.transactions.functionCall(
          "create_invoice",
          Buffer.from(
            JSON.stringify({
              invoice_id: id,
              freelancer: process.env.FREELANCER_ID ?? "freelancer-speclock.testnet",
              client: CLIENT_ID,
              verifier: process.env.VERIFIER_ID ?? "verifier.speclock.testnet",
              split_wallet: process.env.SPLIT_ID ?? "tax-speclock.testnet",
              amount: amount.toString(),
              split_bps: splitBps,
              checklist_hash: hash,
              checklist_json: JSON.stringify(checklist),
              target_url: targetUrl,
              deadline_ms: Date.now() + 7 * 24 * 3600 * 1000,
            }),
          ),
          BigInt(200_000_000_000_000),
          deposit,
        ),
      ],
    });

    return NextResponse.json({ id, checklistHash: hash, tx: res.transaction_outcome.id, checklist });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
