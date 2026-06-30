create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'failed')),
  stage text
    check (stage in ('detect', 'preprocess', 'audiveris', 'render', 'crop', 'vision', 'apply', 'validate', 'repack', 'eval')),
  source_path text not null,
  result_mxl_path text,
  pdf_kind text default 'unknown'
    check (pdf_kind in ('vector', 'raster', 'mixed', 'unknown')),
  page_count int,
  report jsonb default '{}'::jsonb,
  error text,
  cost_usd numeric(10, 4) default 0,
  preprocess jsonb,
  accuracy_score numeric(5, 4),
  needs_human_count int default 0,
  engine text default 'audiveris'
    check (engine in ('audiveris', 'pdftomusic', 'oemer', 'homr'))
);

alter table public.jobs enable row level security;

create index if not exists jobs_created_at_idx on public.jobs (created_at desc);
create index if not exists jobs_status_stage_idx on public.jobs (status, stage);

insert into storage.buckets (id, name, public)
values ('scores', 'scores', false)
on conflict (id) do nothing;
