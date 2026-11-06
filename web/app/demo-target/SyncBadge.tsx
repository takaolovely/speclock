"use client";

import { useEffect, useState } from "react";

/**
 * "Is the store caught up?" indicator.
 *
 * The page honours the mode the switch just wrote, so it flips instantly. The
 * *shared* store can lag a few seconds behind, and the verifier reads the page
 * without any query — if the next inspection started during that window it
 * would judge the old version. This badge makes that window visible instead of
 * leaving it as a race the camera could lose.
 */
export default function SyncBadge({ mode }: { mode: "broken" | "fixed" }) {
  const [state, setState] = useState<"checking" | "synced" | "lagging">("checking");

  useEffect(() => {
    let alive = true;
    const started = Date.now();

    async function poll() {
      try {
        const res = await fetch("/api/demo-target/toggle", { cache: "no-store" });
        const data = (await res.json()) as { mode?: string };
        if (!alive) return;
        if (data.mode === mode) {
          setState("synced");
          return;
        }
        setState(Date.now() - started > 20000 ? "lagging" : "checking");
      } catch {
        if (alive) setState("checking");
      }
      if (alive) setTimeout(poll, 600);
    }

    poll();
    return () => {
      alive = false;
    };
  }, [mode]);

  const color =
    state === "synced" ? "text-emerald-400" : state === "lagging" ? "text-red-300" : "text-amber-300";
  const label =
    state === "synced"
      ? "store synced — safe to request verification"
      : state === "lagging"
        ? "store is lagging — reload before requesting verification"
        : "propagating to the store…";

  return (
    <span className={`inline-flex items-center gap-1.5 ${color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${state === "synced" ? "bg-emerald-400" : state === "lagging" ? "bg-red-400" : "bg-amber-300"}`} />
      {label}
    </span>
  );
}
