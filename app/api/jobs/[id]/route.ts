import { NextResponse, type NextRequest } from "next/server";
import { storageBucket } from "@/lib/server/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("jobs").select("*").eq("id", id).single();
    if (error) throw error;

    let downloadUrl: string | null = null;
    if (data.result_mxl_path) {
      const signed = await supabase.storage.from(storageBucket()).createSignedUrl(String(data.result_mxl_path), 60 * 60);
      if (!signed.error) {
        downloadUrl = signed.data.signedUrl;
      }
    }

    return NextResponse.json(
      {
        id: data.id,
        status: data.status,
        stage: data.stage,
        pdfKind: data.pdf_kind,
        pageCount: data.page_count,
        report: data.report,
        downloadUrl,
        error: data.error,
        costUsd: Number(data.cost_usd ?? 0),
        accuracyScore: data.accuracy_score,
        needsHumanCount: data.needs_human_count,
        refineIterations: Array.isArray(data.report?.passes) ? data.report.passes.length : null,
        terminationReason: data.report?.stopReason ?? null
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
