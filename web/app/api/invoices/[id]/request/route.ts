import { NextResponse } from "next/server";
import * as nearApi from "near-api-js";
import { FACTORY, clientAccount } from "@/lib/near";

/**
 * The on-chain "please check this now" signal.
 *
 * The verifier has no inbound port, so the browser cannot call it. It cannot
 * call the browser either. This tiny transaction is the meeting point: the
 * worker polls for it and does the work.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await clientAccount();
    const res = await account.signAndSendTransaction({
      receiverId: `${id}.${FACTORY}`,
      actions: [nearApi.transactions.functionCall("request_inspection", Buffer.from("{}"), BigInt(50_000_000_000_000), BigInt(0))],
    });
    return NextResponse.json({ tx: res.transaction_outcome.id });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
