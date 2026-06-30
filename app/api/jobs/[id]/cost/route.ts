import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { JobCostResponse } from "@/shared/types";

export const dynamic = "force-dynamic";

function numberOrZero(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jobCostLimitUsd(): number | null {
  const parsed = Number(process.env.JOB_COST_LIMIT_USD ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,cost_usd,cost_breakdown")
      .eq("id", id)
      .single();
    if (jobError) throw jobError;

    const { data: rows, error: logError } = await supabase
      .from("api_cost_log")
      .select(
        "id,created_at,page_num,model,input_tokens,output_tokens,cache_creation_input_tokens_5m,cache_creation_input_tokens_1h,cache_read_input_tokens,cost_usd"
      )
      .eq("job_id", id)
      .order("created_at", { ascending: false });
    if (logError) throw logError;

    const pageLog = (rows ?? []).map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      pageNum: row.page_num === null ? null : Number(row.page_num),
      model: String(row.model),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheCreationInputTokens5m: Number(row.cache_creation_input_tokens_5m ?? 0),
      cacheCreationInputTokens1h: Number(row.cache_creation_input_tokens_1h ?? 0),
      cacheReadInputTokens: Number(row.cache_read_input_tokens ?? 0),
      costUsd: numberOrZero(row.cost_usd)
    }));

    const byModel: Record<string, number> = {};
    for (const log of pageLog) {
      byModel[log.model] = (byModel[log.model] ?? 0) + log.costUsd;
    }
    const totalCost = numberOrZero(job.cost_usd);
    const limitUsd = jobCostLimitUsd();
    const response: JobCostResponse = {
      jobId: String(job.id),
      totalCost,
      limitUsd,
      limitRatio: limitUsd ? totalCost / limitUsd : null,
      breakdown: {
        sonnet: pageLog.filter((log) => log.model.includes("sonnet")).reduce((sum, log) => sum + log.costUsd, 0),
        opus: pageLog.filter((log) => log.model.includes("opus")).reduce((sum, log) => sum + log.costUsd, 0),
        byModel
      },
      pageLog
    };

    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
