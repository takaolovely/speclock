import { NextResponse } from "next/server";
import * as nearApi from "near-api-js";
import { FACTORY, clientAccount } from "@/lib/near";

/**
 * Client's escape hatch. The contract refuses before the deadline, so this
 * route does not have to trust the clock in the browser.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await clientAccount();
    const res = await account.signAndSendTransaction({
      receiverId: `${id}.${FACTORY}`,
      actions: [nearApi.transactions.functionCall("refund", Buffer.from("{}"), BigInt(100_000_000_000_000), BigInt(0))],
    });
    return NextResponse.json({ tx: res.transaction_outcome.id });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
