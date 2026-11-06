import type { Metadata } from "next";
import { connection } from "next/server";
import { FACTORY, view } from "@/lib/near";

export const metadata: Metadata = {
  title: "SpecLock — invoices that unlock on proof, not on mood",
  description:
    "Keyless NEAR invoice accounts that pay out when an independent agent attests a deterministic checklist. No approval button, no ghosting.",
};

// Live counters are read per request; they are also the first thing a judge
// checks against the explorer, so they had better not be a build-time constant.
export const instant = false;

type LiveStats = { invoices: number; receipts: number } | null;

async function readLiveStats(): Promise<LiveStats> {
  try {
    const [ids, receipts] = await Promise.all([
      view<string[]>(FACTORY, "list_invoices"),
      view<number>(FACTORY, "receipt_count"),
    ]);
    return { invoices: new Set(ids).size, receipts: Number(receipts) };
  } catch {
    // A landing page must not fail because a free RPC endpoint is busy.
    return null;
  }
}

const STEPS = [
  {
    n: "01",
    title: "Keyless sub-account",
    body: "The client's deposit mints inv-xxxx.speclock.testnet with CreateAccount → Transfer → DeployContract — and no AddKey anywhere in the batch.",
    detail: "0 access keys · neither party can rug the escrow",
  },
  {
    n: "02",
    title: "Deterministic agent QA",
    body: "An outbound-only Playwright verifier measures HTTP status, console errors, DOM selectors and timing, then hashes the claim with SHA-256.",
    detail: "no LLM · no paid API · re-runnable by anyone",
  },
  {
    n: "03",
    title: "Split & self-destruct",
    body: "A pass splits the payout and the tax, writes a permanent receipt to the factory, then calls delete_account to sweep the remainder home.",
    detail: "10% default split · 100% of the storage stake refunded",
  },
];

export default async function Landing() {
  await connection();
  const stats = await readLiveStats();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#090a0f] text-zinc-200">
      {/* Depth without an image: two soft green pools and a faint grid. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 32rem at 20% -10%, rgba(0,236,151,0.10), transparent 60%), radial-gradient(40rem 24rem at 85% 0%, rgba(0,236,151,0.06), transparent 55%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(39,39,42,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(39,39,42,0.55) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(to bottom, black, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 70%)",
        }}
      />

      <div className="relative">
        {/* nav */}
        <header className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#00EC97] text-[13px] font-bold text-[#06231a]">
              S
            </span>
            <span className="text-sm font-semibold tracking-tight text-zinc-100">SpecLock</span>
          </div>
          <nav className="ml-auto hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 sm:flex">
            <a href="#how" className="transition-colors hover:text-zinc-200">
              How it works
            </a>
            <a
              href="https://github.com/takaolovely/speclock"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-zinc-200"
            >
              GitHub
            </a>
            <a
              href="https://testnet.nearblocks.io/account/speclock.testnet"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-zinc-200"
            >
              Factory ↗
            </a>
          </nav>
          <a
            href="/app"
            className="rounded-lg bg-[#00EC97] px-4 py-2 text-[13px] font-semibold text-[#06231a] transition-transform hover:scale-[1.02]"
          >
            Launch App
          </a>
        </header>

        {/* hero */}
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:pt-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800/80 bg-zinc-900/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00EC97] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00EC97]" />
            </span>
            Live on NEAR testnet — keyless ephemeral escrow
          </div>

          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-50 sm:text-6xl">
            Invoices that unlock on proof,{" "}
            <span className="text-[#00EC97]">not on mood.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-300">
            Freelancers wait on a client&apos;s approval button — and a client who ghosts keeps the money stuck. Here the
            money unlocks when an independent agent attests the checklist both sides agreed to.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="/app"
              className="group inline-flex items-center gap-2 rounded-xl bg-[#00EC97] px-5 py-3 text-sm font-semibold text-[#06231a] shadow-[0_0_40px_-8px_rgba(0,236,151,0.55)] transition-transform hover:scale-[1.02]"
            >
              Launch App
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </a>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-3 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              How it works
            </a>
            <span className="font-mono text-[11px] text-zinc-400">no wallet needed to try it</span>
          </div>

          <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-800/60 sm:grid-cols-4">
            {[
              { k: "network", v: "NEAR testnet" },
              { k: "invoices minted", v: stats ? String(stats.invoices) : "—" },
              { k: "permanent receipts", v: stats ? String(stats.receipts) : "—" },
              { k: "inbound ports", v: "0" },
            ].map((s) => (
              <div key={s.k} className="bg-[#0b0d13] px-4 py-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">{s.k}</dt>
                <dd className="mt-1 font-mono text-sm text-zinc-200">{s.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* three steps */}
        <section id="how" className="mx-auto max-w-6xl px-6 pb-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">The whole machine, in three moves</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">verified on testnet</span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="group rounded-2xl border border-zinc-800/80 bg-[#0f121a] p-5 transition-colors hover:border-[#00EC97]/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-[#00EC97]/80">{s.n}</span>
                  <span className="h-1 w-8 rounded-full bg-zinc-800 transition-colors group-hover:bg-[#00EC97]/50" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-zinc-100">{s.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{s.body}</p>
                <p className="mt-4 border-t border-zinc-800/80 pt-3 font-mono text-[10px] text-zinc-400">{s.detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-[#0d1017] to-[#0a0c11] p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-sm font-medium text-zinc-200">The dashboard is one click away.</p>
              <p className="mt-1 text-[13px] text-zinc-400">
                Mint an invoice, request a verification, and watch a settled account stay visible after it deletes itself.
              </p>
            </div>
            <a
              href="/app"
              className="mt-4 inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#00EC97] px-5 py-3 text-sm font-semibold text-[#06231a] transition-transform hover:scale-[1.02] sm:mt-0"
            >
              Open the dashboard →
            </a>
          </div>
        </section>

        <footer className="border-t border-zinc-800/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-6 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
            <a
              href="https://testnet.nearblocks.io/account/speclock.testnet"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-[#00EC97]"
            >
              factory: speclock.testnet
            </a>
            <span>verifier: outbound only</span>
            <span>checklist hashed on chain</span>
            <a
              href="https://github.com/takaolovely/speclock"
              target="_blank"
              rel="noreferrer"
              className="ml-auto transition-colors hover:text-[#00EC97]"
            >
              source ↗
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
