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

const EVIDENCE = [
  {
    step: "01 · mint",
    what: "Keyless invoice minted with 0.5 NEAR of escrow",
    hash: "615p1eBn…QPWS",
    href: "https://testnet.nearblocks.io/txns/615p1eBnSDSV6GuXNcKeJAPz6nwjAo8N8mAtGh8pQPWS",
    note: "four actions, no AddKey",
  },
  {
    step: "02 · fail",
    what: "Verdict fail — escrow untouched, invoice stays Funded",
    hash: "2UMr3eyy…q5NC",
    href: "https://testnet.nearblocks.io/txns/2UMr3eyyH7fhaB8s6pMhc4UUmtjSKwhykW8Y4n3Aq5NC",
    note: "the freelancer can fix and re-verify",
  },
  {
    step: "03 · pass",
    what: "Attest pass → split, permanent receipt, self-destruct",
    hash: "34PatvWw…MZn8",
    href: "https://testnet.nearblocks.io/txns/34PatvWwqzELFr7MUkGbgCcbV5FQQFJ6c778EWF5MZn8",
    note: "90% + full storage stake returned",
  },
  {
    step: "04 · refund",
    what: "Deadline passed, client refunded, account deleted",
    hash: "5npkCiNu…hkqL",
    href: "https://testnet.nearblocks.io/txns/5npkCiNuiy78d1dfaxMr6EZF3dEatCdmAYBiCq4shkqL",
    note: "nobody has to approve anything",
  },
];

const SSRF_CASES = [
  ["BLOCK", "https://169.254.169.254/latest/meta-data/", "IP literals are not allowed"],
  ["BLOCK", "https://127.0.0.1/x", "IP literals are not allowed"],
  ["BLOCK", "https://user:pass@staging.example.com/", "credentials in URL are not allowed"],
  ["BLOCK", "https://staging.example.com:8443/x", "port 8443 not allowed"],
  ["BLOCK", "https://evil.example.com/x", "host is not on the allowlist"],
  ["ALLOW", "https://speclock-nine.vercel.app/", "ok"],
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
          <a href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="SpecLock" width={28} height={28} className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-tight text-zinc-100">SpecLock</span>
          </a>
          <nav className="ml-auto hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 sm:flex">
            <a href="#how-it-works" className="transition-colors hover:text-zinc-200">
              How it works
            </a>
            <a href="#proof" className="transition-colors hover:text-zinc-200">
              Proof
            </a>
            <a href="#evidence" className="transition-colors hover:text-zinc-200">
              Evidence
            </a>
            <a
              href="https://github.com/takaolovely/speclock"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-zinc-200"
            >
              GitHub
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
              href="/demo-target"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-3 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              Open staging target ↗
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
        <section className="mx-auto max-w-6xl px-6 pb-20">
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
        </section>

        {/* A — architecture, pass vs fail */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-8 px-6 pb-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Architecture, five on-chain steps</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              diagram drawn from the contracts
            </span>
          </div>

          <figure className="mt-6 overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#0a0c11]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/architecture.png"
              width={900}
              height={500}
              alt="SpecLock flow: the client deposits, the factory mints a keyless invoice account, the agent measures the delivery, and the contract attests, splits and deletes the account."
              className="w-full"
            />
          </figure>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[#00EC97]/25 bg-[#00EC97]/[0.04] p-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#00EC97]">pass</span>
                <span className="h-px flex-1 bg-[#00EC97]/20" />
                <span className="font-mono text-[10px] text-zinc-400">one transaction</span>
              </div>
              <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-zinc-300">
                <li>
                  <span className="font-mono text-[11px] text-zinc-100">90%</span> to the freelancer,{" "}
                  <span className="font-mono text-[11px] text-zinc-100">10%</span> to the split wallet, taken from the
                  invoice amount and never from the storage stake.
                </li>
                <li>A permanent receipt lands in the factory, so the proof outlives the account that produced it.</li>
                <li>
                  <span className="font-mono text-[11px] text-zinc-100">delete_account</span> sweeps the remainder home and
                  refunds 100% of the storage stake.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">fail / refund</span>
                <span className="h-px flex-1 bg-amber-500/20" />
                <span className="font-mono text-[10px] text-zinc-400">nothing moves</span>
              </div>
              <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-zinc-300">
                <li>
                  A fail verdict transfers nothing. The invoice stays <span className="font-mono text-[11px]">Funded</span>{" "}
                  and the escrow is untouched.
                </li>
                <li>The freelancer fixes the delivery and asks for another inspection — the same invoice, a new attempt.</li>
                <li>
                  After <span className="font-mono text-[11px]">deadline_ms</span> the client calls{" "}
                  <span className="font-mono text-[11px]">refund()</span>; the account deletes itself and makes the client
                  whole.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* B — the two proofs */}
        <section id="proof" className="mx-auto max-w-6xl scroll-mt-8 px-6 pb-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Two things worth attacking</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">check them yourself</span>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800/80 bg-[#0f121a] p-5">
              <h3 className="text-base font-semibold text-zinc-100">The claim hash is reproducible</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                The hash covers the verdict only — timestamps and durations stay out of it. Two runs of the same page,
                different clocks, identical 32 bytes.
              </p>

              <pre className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-[#0a0c11] p-3 font-mono text-[10.5px] leading-relaxed text-zinc-300">
{`{"checklist_hash":"6d7c30e5da435503…",
 "invoice_id":"inv-0062",
 "overall":"pass",
 "rules":[{"i":0,"p":true,"t":"http_status"},
          {"i":1,"p":true,"t":"console_errors"},
          {"i":2,"p":true,"t":"dom_selector"},
          {"i":3,"p":true,"t":"response_time_ms"}],
 "target_url":"https://speclock-nine.vercel.app/demo-target",
 "v":1}`}
              </pre>

              <div className="mt-3 space-y-1 font-mono text-[10.5px] text-zinc-400">
                <div className="flex justify-between gap-3">
                  <span>run 1 · 2046 ms</span>
                  <span className="text-zinc-300">1fadbb01adb687cb…</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>run 2 · 2096 ms</span>
                  <span className="text-[#00EC97]">1fadbb01adb687cb…</span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-800 bg-[#0a0c11] px-3 py-2 font-mono text-[10.5px] text-zinc-300">
                <div className="text-zinc-500">$ sha256sum evidence/inv-0062/claim.json</div>
                <div className="break-all text-[#00EC97]">1fadbb01adb687cb8efc60d14e719b077b25eff62b1b2d8d42d7e8e6bae7a814</div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800/80 bg-[#0f121a] p-5">
              <h3 className="text-base font-semibold text-zinc-100">The verifier cannot be aimed at the VPS</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                <span className="font-mono text-[11px]">target_url</span> is written by strangers, so the gate runs before a
                browser opens — and it re-resolves DNS, because a public name pointing inward is the same attack wearing a
                hat.
              </p>

              <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-[#0a0c11] p-3 font-mono text-[10.5px] leading-relaxed">
                {SSRF_CASES.map(([verdict, url, reason]) => (
                  <div key={url} className="flex gap-2 whitespace-nowrap">
                    <span className={verdict === "ALLOW" ? "text-[#00EC97]" : "text-red-400"}>{verdict}</span>
                    <span className="text-zinc-300">{url}</span>
                    <span className="text-zinc-600">→ {reason}</span>
                  </div>
                ))}
              </div>

              <ul className="mt-4 space-y-1.5 text-[12px] leading-relaxed text-zinc-400">
                <li>No listening socket: the worker polls the factory every 12 seconds and opens one browser when there is work.</li>
                <li>Only hosts on the allowlist, https only, standard port only, no credentials in the URL.</li>
                <li>
                  Try it: <span className="font-mono text-[11px] text-zinc-300">node -e &apos;require(&quot;./lib/security&quot;).vetUrl(&quot;https://169.254.169.254/&quot;).then(console.log)&apos;</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* C — on-chain evidence */}
        <section id="evidence" className="mx-auto max-w-6xl scroll-mt-8 px-6 pb-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">On-chain evidence</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              NEAR testnet · nearblocks
            </span>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800/80">
            {EVIDENCE.map((e, i) => (
              <a
                key={e.hash}
                href={e.href}
                target="_blank"
                rel="noreferrer"
                className={`group flex flex-col gap-1 px-5 py-4 transition-colors hover:bg-[#00EC97]/[0.05] sm:flex-row sm:items-center sm:gap-4 ${
                  i === 0 ? "" : "border-t border-zinc-800/80"
                }`}
              >
                <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[#00EC97]/80">
                  {e.step}
                </span>
                <span className="flex-1 text-[13px] text-zinc-300">{e.what}</span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-500">{e.note}</span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-200 group-hover:text-[#00EC97]">{e.hash} ↗</span>
              </a>
            ))}
          </div>
        </section>

        {/* close */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-[#0d1017] to-[#0a0c11] p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-sm font-medium text-zinc-200">Try the full loop live</p>
              <p className="mt-1 text-[13px] text-zinc-400">
                Mint an invoice, break the staging page, watch the verdict stay put, fix it, and see the account delete
                itself. Both ends are real testnet transactions.
              </p>
            </div>
            <div className="mt-4 flex shrink-0 flex-wrap gap-2 sm:mt-0">
              <a
                href="/app"
                className="inline-flex items-center gap-2 rounded-xl bg-[#00EC97] px-5 py-3 text-sm font-semibold text-[#06231a] transition-transform hover:scale-[1.02]"
              >
                Launch invoice dashboard →
              </a>
              <a
                href="/demo-target"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-3 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              >
                Open staging target ↗
              </a>
            </div>
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
