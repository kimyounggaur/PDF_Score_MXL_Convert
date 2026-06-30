import { getSupabaseAdmin } from "../../lib/supabase/server";
import type { ApiCostLogEntry } from "./cost";

export async function getPersistedJobCostUsd(jobId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin().from("jobs").select("cost_usd").eq("id", jobId).single();
  if (error) throw error;
  return Number(data?.cost_usd ?? 0);
}

export async function recordApiCost(entry: ApiCostLogEntry): Promise<void> {
  const { tokens } = entry.breakdown;
  const { error } = await getSupabaseAdmin().rpc("record_api_cost", {
    p_job_id: entry.jobId,
    p_page_num: entry.pageNum,
    p_model: entry.model,
    p_input_tokens: tokens.inputTokens,
    p_output_tokens: tokens.outputTokens,
    p_cache_creation_input_tokens_5m: tokens.cacheCreationInputTokens5m,
    p_cache_creation_input_tokens_1h: tokens.cacheCreationInputTokens1h,
    p_cache_read_input_tokens: tokens.cacheReadInputTokens,
    p_cost_usd: entry.costUsd
  });
  if (error) throw error;
}
