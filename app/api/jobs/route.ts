import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getOmrQueue } from "@/worker/src/queue";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { sourcePath?: string; fileName?: string };
    if (!body.sourcePath || !body.fileName) {
      return NextResponse.json({ error: "sourcePath and fileName are required" }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("jobs")
      .insert({
        status: "queued",
        source_path: body.sourcePath,
        pdf_kind: "unknown",
        cost_usd: 0,
        report: { warnings: [], pages: [], summary: { chords_added: 0, lyrics_added: 0, notes_fixed: 0, skipped: 0 } }
      })
      .select("id")
      .single();
    if (error) throw error;

    await getOmrQueue().add("convert", { jobId: data.id }, { attempts: 2, backoff: { type: "exponential", delay: 5000 } });
    return NextResponse.json({ jobId: data.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
