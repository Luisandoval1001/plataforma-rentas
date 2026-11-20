-- Roles que Supabase provee de fábrica; aquí se crean para Postgres local.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_server') then
    create role app_server login password 'app_server';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

grant usage on schema public to app_server, authenticated, anon;
