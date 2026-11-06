import { NextResponse, connection } from "next/server";
import { readDemoState, writeDemoState, type DemoMode } from "@/lib/demoState";

export const maxDuration = 30;

/** Current staging state, read straight from the shared store. */
export async function GET() {
  await connection();
  const { state, source } = await readDemoState();
  return NextResponse.json(
    { ...state, source },
    { headers: { "cache-control": "no-store, max-age=0, must-revalidate" } },
  );
}

/**
 * The staging switch.
 *
 * The freelancer's dashboard is the only thing that calls this, so it needs no
 * auth beyond being same-origin in practice. It exists so the video can show a
 * real broken deploy turning into a real fixed one without waiting for a build.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: string; note?: string };
    const mode: DemoMode = body.mode === "fixed" ? "fixed" : "broken";
    const note =
      body.note?.trim() ||
      (mode === "fixed" ? "shipped: checkout button restored" : "regression: checkout button missing");
    const state = await writeDemoState(mode, note);
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
