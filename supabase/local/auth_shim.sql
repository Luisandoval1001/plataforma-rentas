-- Réplica local del esquema auth de Supabase. Igual que allá, app_server NO recibe acceso:
-- en Supabase el rol postgres no puede otorgar privilegios sobre auth a un rol propio, así que
-- la app usa app.uid() (0001_core.sql) y nunca auth.uid().
create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth to authenticated, anon;
revoke execute on function auth.uid(), auth.jwt() from public;
grant execute on function auth.uid() to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
