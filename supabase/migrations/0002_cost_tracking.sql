alter table public.jobs
  add column if not exists cost_breakdown jsonb not null default '{"sonnet":0,"opus":0,"total":0}'::jsonb;

create table if not exists public.api_cost_log (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  page_num int,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_creation_input_tokens_5m int not null default 0,
  cache_creation_input_tokens_1h int not null default 0,
  cache_read_input_tokens int not null default 0,
  cost_usd numeric(12, 8) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_cost_log_job on public.api_cost_log(job_id, created_at desc);
create index if not exists idx_cost_log_created_at on public.api_cost_log(created_at desc);

create table if not exists public.daily_cost_summary (
  date date primary key,
  total_jobs int not null default 0,
  total_cost_usd numeric(12, 8) not null default 0,
  sonnet_cost numeric(12, 8) not null default 0,
  opus_cost numeric(12, 8) not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.api_cost_log enable row level security;
alter table public.daily_cost_summary enable row level security;

create or replace function public.record_api_cost(
  p_job_id uuid,
  p_page_num int,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_cache_creation_input_tokens_5m int,
  p_cache_creation_input_tokens_1h int,
  p_cache_read_input_tokens int,
  p_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  model_key text := case when p_model ilike '%opus%' then 'opus' else 'sonnet' end;
begin
  insert into public.api_cost_log (
    job_id,
    page_num,
    model,
    input_tokens,
    output_tokens,
    cache_creation_input_tokens_5m,
    cache_creation_input_tokens_1h,
    cache_read_input_tokens,
    cost_usd
  )
  values (
    p_job_id,
    p_page_num,
    p_model,
    coalesce(p_input_tokens, 0),
    coalesce(p_output_tokens, 0),
    coalesce(p_cache_creation_input_tokens_5m, 0),
    coalesce(p_cache_creation_input_tokens_1h, 0),
    coalesce(p_cache_read_input_tokens, 0),
    coalesce(p_cost_usd, 0)
  );

  update public.jobs as j
  set
    cost_usd = coalesce(j.cost_usd, 0) + coalesce(p_cost_usd, 0),
    cost_breakdown = jsonb_set(
      jsonb_set(
        coalesce(j.cost_breakdown, '{"sonnet":0,"opus":0,"total":0}'::jsonb),
        '{total}',
        to_jsonb(coalesce(j.cost_usd, 0) + coalesce(p_cost_usd, 0)),
        true
      ),
      array[model_key],
      to_jsonb(coalesce((j.cost_breakdown ->> model_key)::numeric, 0) + coalesce(p_cost_usd, 0)),
      true
    )
  where j.id = p_job_id;
end;
$$;

create or replace function public.refresh_daily_cost_summary_for_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_date date := new.created_at::date;
  daily_total_jobs int;
  daily_total_cost numeric;
  daily_sonnet_cost numeric;
  daily_opus_cost numeric;
begin
  select
    count(distinct job_id),
    coalesce(sum(cost_usd), 0),
    coalesce(sum(cost_usd) filter (where model ilike '%sonnet%'), 0),
    coalesce(sum(cost_usd) filter (where model ilike '%opus%'), 0)
  into daily_total_jobs, daily_total_cost, daily_sonnet_cost, daily_opus_cost
  from public.api_cost_log
  where created_at::date = target_date;

  insert into public.daily_cost_summary(date, total_jobs, total_cost_usd, sonnet_cost, opus_cost, updated_at)
  values (target_date, daily_total_jobs, daily_total_cost, daily_sonnet_cost, daily_opus_cost, now())
  on conflict (date) do update
  set
    total_jobs = excluded.total_jobs,
    total_cost_usd = excluded.total_cost_usd,
    sonnet_cost = excluded.sonnet_cost,
    opus_cost = excluded.opus_cost,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists api_cost_log_daily_summary_trigger on public.api_cost_log;
create trigger api_cost_log_daily_summary_trigger
after insert on public.api_cost_log
for each row execute function public.refresh_daily_cost_summary_for_log();

revoke all on function public.record_api_cost(uuid, int, text, int, int, int, int, int, numeric) from public, anon, authenticated;
grant execute on function public.record_api_cost(uuid, int, text, int, int, int, int, int, numeric) to service_role;

revoke all on function public.refresh_daily_cost_summary_for_log() from public, anon, authenticated;
grant execute on function public.refresh_daily_cost_summary_for_log() to service_role;
