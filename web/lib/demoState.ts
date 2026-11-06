import { head, put } from "@vercel/blob";

/**
 * Demo target state.
 *
 * The video needs one stable URL whose behaviour flips in seconds, because a
 * rebuild would add a minute of dead air to a ninety second recording. Vercel
 * functions are not a good place for a mutable flag (instances come and go, and
 * a flip that lands in one instance but not another would make the recording
 * lie). A Blob is shared, durable and writable from the page itself.
 *
 * Blob reads are public and CDN-cached, so every read carries a cache-buster
 * and the write sets max-age to zero.
 */
export type DemoMode = "broken" | "fixed";

export type DemoState = {
  mode: DemoMode;
  updatedAt: string;
  note: string;
};

const PATH = "demo/target-state.json";

const DEFAULT_STATE: DemoState = {
  mode: "broken",
  updatedAt: new Date(0).toISOString(),
  note: "default: the checkout button was never shipped",
};

export async function readDemoState(): Promise<{ state: DemoState; source: "blob" | "default" }> {
  try {
    const meta = await head(PATH);
    const res = await fetch(`${meta.url}?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`blob read ${res.status}`);
    const parsed = (await res.json()) as Partial<DemoState>;
    return {
      state: {
        mode: parsed.mode === "fixed" ? "fixed" : "broken",
        updatedAt: parsed.updatedAt ?? DEFAULT_STATE.updatedAt,
        note: parsed.note ?? "",
      },
      source: "blob",
    };
  } catch {
    // A missing blob is not an error: the store starts empty, and "broken" is
    // the correct first state for the story.
    return { state: DEFAULT_STATE, source: "default" };
  }
}

export async function writeDemoState(mode: DemoMode, note: string): Promise<DemoState> {
  const state: DemoState = { mode, updatedAt: new Date().toISOString(), note };
  await put(PATH, JSON.stringify(state), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
  return state;
}
