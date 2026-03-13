revoke all on table public.plugin_likes from anon, authenticated;
revoke all on table public.plugin_downloads from anon, authenticated;
revoke all on table public.plugin_stats_rollup from anon, authenticated;

grant select, insert, update, delete on table public.plugin_likes to service_role;
grant select, insert, update, delete on table public.plugin_downloads to service_role;
grant select on table public.plugin_stats_rollup to service_role;
