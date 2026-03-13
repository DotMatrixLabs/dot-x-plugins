create table if not exists public.plugin_likes (
  plugin_id text not null,
  device_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (plugin_id, device_id)
);

create table if not exists public.plugin_downloads (
  plugin_id text not null,
  plugin_version text not null,
  device_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (plugin_id, plugin_version, device_id)
);

alter table public.plugin_likes enable row level security;
alter table public.plugin_downloads enable row level security;

create or replace view public.plugin_stats_rollup as
with like_counts as (
  select
    plugin_id,
    count(*)::bigint as likes
  from public.plugin_likes
  group by plugin_id
),
download_counts as (
  select
    plugin_id,
    count(*)::bigint as downloads
  from public.plugin_downloads
  group by plugin_id
),
plugin_ids as (
  select plugin_id from like_counts
  union
  select plugin_id from download_counts
)
select
  plugin_ids.plugin_id,
  coalesce(like_counts.likes, 0)::bigint as likes,
  coalesce(download_counts.downloads, 0)::bigint as downloads
from plugin_ids
left join like_counts using (plugin_id)
left join download_counts using (plugin_id);
