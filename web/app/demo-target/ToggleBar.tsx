"use client";

import { useState } from "react";

/**
 * Staging controls for the demo target.
 *
 * This is the freelancer's own preview, so a "what did I just deploy" switch
 * belongs here. It writes to shared storage, so the browser, a fresh tab and
 * the verifier all see the same state.
 */
export default function ToggleBar({ mode }: { mode: "broken" | "fixed" }) {
  const [busy, setBusy] = useState<"broken" | "fixed" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function set(next: "broken" | "fixed") {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch("/api/demo-target/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      /*
       * Navigate with the mode the write just confirmed.
       *
       * Public blob reads are CDN-cached and can answer with the previous value
       * for a few seconds. Waiting for that to settle costs five seconds of
       * dead air; reading a lagging replica instead of the write result would
       * show the wrong page. The query is the write's own receipt, and the
       * verifier — which never sends it — still reads the store.
       */
      window.location.replace(`/demo-target?state=${next}&deploy=${Date.now()}`);
      return;
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-[#0d1017] px-4 py-2 font-mono text-[11px]">
      <span className="text-zinc-500">staging</span>
      <span
        className={`rounded px-2 py-0.5 ${
          mode === "fixed" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
        }`}
      >
        {mode === "fixed" ? "FIXED DEPLOY" : "BROKEN DEPLOY"}
      </span>

      <div className="ml-auto flex gap-2">
        <button
          onClick={() => set("broken")}
          disabled={busy !== null || mode === "broken"}
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 disabled:opacity-40 hover:border-red-500/60 hover:text-red-300"
        >
          {busy === "broken" ? "deploying…" : "deploy broken"}
        </button>
        <button
          onClick={() => set("fixed")}
          disabled={busy !== null || mode === "fixed"}
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 disabled:opacity-40 hover:border-emerald-500/60 hover:text-emerald-300"
        >
          {busy === "fixed" ? "deploying…" : "ship the fix"}
        </button>
      </div>

      {error && <span className="w-full text-red-300">{error}</span>}
    </div>
  );
}
