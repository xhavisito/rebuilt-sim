-- Galería de robots de la comunidad (src/net/robotHub.ts). Pegar completo en
-- Supabase → SQL Editor → Run. Se puede volver a correr sin romper nada.
--
-- Permisos para la llave pública "anon" (la que va en la página):
--   · leer los robots (sin el hash del token) que tengan menos de 3 reportes
--   · publicar robots (con límites de tamaño) y subir su GLB al bucket público
--   · borrar un robot solo con el token que se guardó al publicarlo
--   · reportar y contar descargas
-- Moderación: Table Editor → robots (borra filas o sube/baja `reports`) y Storage → robots.

create table if not exists public.robots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 60),
  team int not null check (team between 1 and 99999),
  author text not null default '' check (char_length(author) <= 40),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) < 16000),
  cad_path text check (cad_path ~ '^[0-9a-f-]{36}\.(glb|gltf)$'),
  cad_bytes int not null default 0 check (cad_bytes between 0 and 52428800),
  downloads int not null default 0,
  reports int not null default 0,
  delete_hash text not null check (delete_hash ~ '^[0-9a-f]{64}$')
);

alter table public.robots enable row level security;

-- Columnas visibles y editables para la página (delete_hash, reports y downloads no se leen/escriben directo)
revoke all on public.robots from anon, authenticated;
grant select (id, created_at, name, team, author, spec, cad_path, cad_bytes, downloads) on public.robots to anon, authenticated;
grant insert (name, team, author, spec, cad_path, cad_bytes, delete_hash) on public.robots to anon, authenticated;

drop policy if exists "robots: leer" on public.robots;
create policy "robots: leer" on public.robots for select to anon, authenticated using (reports < 3);
drop policy if exists "robots: publicar" on public.robots;
create policy "robots: publicar" on public.robots for insert to anon, authenticated with check (true);

create or replace function public.delete_robot(rid uuid, token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  delete from public.robots where id = rid and delete_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.report_robot(rid uuid) returns void
language sql security definer set search_path = public as $$
  update public.robots set reports = reports + 1 where id = rid;
$$;

create or replace function public.count_download(rid uuid) returns void
language sql security definer set search_path = public as $$
  update public.robots set downloads = downloads + 1 where id = rid;
$$;

revoke all on function public.delete_robot(uuid, text), public.report_robot(uuid), public.count_download(uuid) from public;
grant execute on function public.delete_robot(uuid, text), public.report_robot(uuid), public.count_download(uuid) to anon, authenticated;

-- Bucket público para los GLB: hasta 50 MB (límite del plan gratuito), solo glTF
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('robots', 'robots', true, 52428800, array['model/gltf-binary', 'model/gltf+json'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "robots: subir CAD" on storage.objects;
create policy "robots: subir CAD" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'robots' and name ~ '^[0-9a-f-]{36}\.(glb|gltf)$');
