"use client";

import { useCallback, useEffect, useState } from "react";

type Rule = { type: string; [k: string]: unknown };
type Invoice = {
  id: string;
  account: string;
  state: "live" | "settled" | "missing";
  status: string;
  amountYocto?: string | number;
  freelancer?: string;
  targetUrl?: string;
  deadlineMs?: number;
  checklistHash?: string;
  checklist?: { rules: Rule[] } | null;
  evidenceHash?: string;
  verdict?: string;
  rulesSummary?: string;
  settledAtMs?: number;
  inspectionRequested?: boolean;
};

const near = (y?: string | number) => (y ? Number(y) / 1e24 : 0).toFixed(2);

function rulesOf(inv: Invoice): { t: string; p: boolean }[] {
  if (!inv.rulesSummary) return [];
  try {
    return (JSON.parse(inv.rulesSummary) as { r: { t: string; p: boolean }[] }).r ?? [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [targetUrl, setTargetUrl] = useState("https://recallspend.vercel.app");
  const [amount, setAmount] = useState("1");
  const [selector, setSelector] = useState("#checkout-button");
  const [textContains, setTextContains] = useState("");
  const [splitBps, setSplitBps] = useState(1000);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/invoices", { cache: "no-store" });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setInvoices(data.invoices ?? []);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const r = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUrl,
          amountNear: Number(amount),
          splitBps,
          selector,
          textContains,
          maxConsoleErrors: 0,
          maxResponseMs: 2000,
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      await load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, action: "request" | "refund") {
    setBusy(id + action);
    setError(null);
    try {
      const r = await fetch(`/api/invoices/${id}/${action}`, { method: "POST" });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      await load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-400">SpecLock · NEAR testnet</div>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight text-zinc-50">
            Invoices that unlock on proof, not on mood.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Freelancers wait on a client&apos;s approval button — and a client who ghosts keeps the money stuck. Here the
            money unlocks when an independent agent attests the checklist both sides agreed to.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
            Each invoice is a keyless NEAR sub-account: an agent attests a deterministic checklist, splits the payout, and
            the account self-destructs to refund storage.
          </p>
        </div>
      </header>

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <section className="mt-10 grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 md:grid-cols-2">
        <label className="text-xs text-zinc-400">
          Delivery URL (https)
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Invoice amount (NEAR)
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-zinc-400">
          DOM selector that must be visible
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Text that must appear (optional)
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
            value={textContains}
            onChange={(e) => setTextContains(e.target.value)}
            placeholder="e.g. Checkout"
          />
        </label>

        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Split</span>
          {[0, 500, 1000, 2000].map((bps) => (
            <button
              key={bps}
              onClick={() => setSplitBps(bps)}
              className={`rounded-full border px-3 py-1 font-mono text-xs ${
                splitBps === bps
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {bps / 100}%
            </button>
          ))}
          <button
            onClick={create}
            disabled={busy === "create"}
            className="ml-auto rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"
          >
            {busy === "create" ? "Minting…" : "Create invoice"}
          </button>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Invoices</h2>
          <span className="font-mono text-[11px] text-zinc-600">{loading ? "reading chain…" : `${invoices.length} on chain`}</span>
        </div>

        <ul className="mt-4 space-y-3">
          {invoices.map((inv) => {
            const settled = inv.state === "settled";
            const rules = rulesOf(inv);
            const deadlinePassed = inv.deadlineMs ? Date.now() > inv.deadlineMs : false;
            return (
              <li key={inv.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-zinc-200">{inv.id}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                      settled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : inv.status === "Funded"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-zinc-700/40 text-zinc-300"
                    }`}
                  >
                    {settled ? "settled · self-destructed" : inv.status}
                  </span>
                  <span className="ml-auto font-mono text-xs text-zinc-400">{near(inv.amountYocto)} NEAR</span>
                </div>

                {inv.targetUrl && <div className="mt-2 truncate font-mono text-[11px] text-zinc-500">{inv.targetUrl}</div>}

                {settled && (
                  <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
                    Account deleted after payout — 100% of the storage stake returned to the freelancer.
                  </div>
                )}

                {rules.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {rules.map((r, i) => (
                      <span
                        key={i}
                        className={`rounded-md px-2 py-1 font-mono text-[10px] ${
                          r.p ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
                        }`}
                      >
                        {r.p ? "PASS" : "FAIL"} {r.t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {inv.evidenceHash && (
                    <a
                      className="font-mono text-[10px] text-zinc-500 underline decoration-zinc-700 hover:text-emerald-300"
                      href={`https://testnet.nearblocks.io/account/${inv.account}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      evidence {inv.evidenceHash.slice(0, 12)}…
                    </a>
                  )}
                  {!settled && inv.status === "Funded" && (
                    <button
                      onClick={() => act(inv.id, "request")}
                      disabled={busy === inv.id + "request"}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
                    >
                      {busy === inv.id + "request" ? "sending…" : inv.inspectionRequested ? "Requested — agent polling" : "Request verification"}
                    </button>
                  )}
                  {!settled && inv.status === "Funded" && (
                    <button
                      onClick={() => act(inv.id, "refund")}
                      disabled={!deadlinePassed || busy === inv.id + "refund"}
                      title={deadlinePassed ? "Refund the client" : "Available after the deadline"}
                      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 disabled:opacity-40 hover:border-red-500/50 hover:text-red-300"
                    >
                      Refund
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-12 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
        <a href="https://testnet.nearblocks.io/account/speclock.testnet" target="_blank" rel="noreferrer" className="hover:text-emerald-400">
          factory: speclock.testnet
        </a>
        <span>verifier: outbound only</span>
        <span>checklist hashed on chain</span>
      </footer>
    </main>
  );
}
