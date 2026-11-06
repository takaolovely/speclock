import type { Metadata } from "next";
import { connection } from "next/server";
import ToggleBar from "./ToggleBar";
import SyncBadge from "./SyncBadge";
import { readDemoState } from "@/lib/demoState";

export const metadata: Metadata = {
  title: "Kopi Nusantara — checkout (staging)",
  description: "Deliverable under inspection: a checkout page that either ships its payment button or does not.",
};

// The page must be read at request time (its whole point is that it changes),
// and Next 16 with cacheComponents blocks dynamic data in the initial render
// unless the route opts out of instant navigation.
export const instant = false;

/**
 * The delivery under inspection.
 *
 * Two states, one URL. `broken` is the version the freelancer actually shipped
 * the first time: the payment widget throws before it renders, so
 * `#checkout-button` never reaches the DOM. `fixed` is the same page after the
 * freelancer found it. The verifier does not know which is which — it just looks
 * for the element the client asked for.
 */
export default async function DemoTargetPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await connection();
  const [{ state }, params] = await Promise.all([readDemoState(), searchParams]);
  // `state` is written by the staging switch's own POST, so it is the freshest
  // honest answer right after a deploy. The verifier never sends it and reads
  // the shared store instead.
  const override = params.state === "fixed" ? "fixed" : params.state === "broken" ? "broken" : null;
  const mode = override ?? state.mode;
  const fixed = mode === "fixed";

  return (
    <div className="min-h-screen bg-[#0b0d12] text-zinc-200">
      <ToggleBar mode={mode} />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#d9a441] font-semibold text-[#2b1d05]">
            K
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">Kopi Nusantara</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">staging · order checkout</div>
          </div>
        </div>

        <h1 className="mt-8 text-2xl font-semibold text-zinc-50">Your order</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Two bags of Gayo, one grinder. Delivered Thursday. This is the page the client is paying for.
        </p>

        <div className="mt-6 rounded-xl border border-zinc-800 bg-[#141720]">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-sm">
            <span className="text-zinc-300">Gayo Arabica · 2 × 250g</span>
            <span className="font-mono text-zinc-300">$34.00</span>
          </div>
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-sm">
            <span className="text-zinc-300">Hand grinder · 1</span>
            <span className="font-mono text-zinc-300">$21.00</span>
          </div>
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-sm">
            <span className="text-zinc-300">Shipping</span>
            <span className="font-mono text-zinc-300">$5.00</span>
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-sm font-medium text-zinc-200">Total</span>
            <span className="font-mono text-lg font-semibold text-zinc-50">$60.00</span>
          </div>
        </div>

        {/*
          The contract's checklist asks for exactly one thing on this page:
          a visible #checkout-button. In the broken deploy it is absent, and the
          page says so instead of pretending. No console.error either, so the
          verdict comes from the rule the client actually wrote.
        */}
        {fixed ? (
          <button
            id="checkout-button"
            type="button"
            className="mt-6 w-full rounded-xl bg-[#d9a441] px-4 py-3 text-sm font-semibold text-[#2b1d05] hover:bg-[#e6b355]"
          >
            Pay $60.00
          </button>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">Payment widget did not load.</p>
            <p className="mt-1 font-mono text-[11px] text-zinc-600">
              {`> render(): document.getElementById("checkout-button") — not in DOM`}
            </p>
          </div>
        )}

        <p className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-600">
          <span>deploy {fixed ? "v3 (fixed)" : "v2 (regression)"}</span>
          <span>·</span>
          <SyncBadge mode={mode} />
        </p>
      </main>
    </div>
  );
}
